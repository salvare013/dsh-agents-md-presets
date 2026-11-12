import z from "@deepseek-ai/schemastery";

import { createRoutes, makeHandler, API_PREFIX } from "./http.js";
import { PresetStore, resolveDefaultRoot } from "./store.js";

/**
 * Host 半边：把 $DSH_HOME/prompt-presets（目录名沿用旧版，改名后不动）里的预设暴露成同源 HTTP 接口，
 * 供 client.js 的设置页（settings.section）与会话预设条（conversation.input.dock）调用。
 * 路由注册方式与桌面端已装第三方插件一致：webCtx.webServer.register({ kind: "exact", path, handler })。
 */

export const name = "agents-md-presets";

export { API_PREFIX };

export const Config = z.object({
  root: z.string().default(""),
  maxBytes: z.number().default(65536),
});

export function resolveConfig(config = {}) {
  const root = String(config.root ?? "").trim() || resolveDefaultRoot();
  const maxBytes = Number(config.maxBytes);
  // 上限跟内置 agent-instructions 的 maxBytes 对齐：超过它的正文会被加载器忽略。
  const resolved = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, 65536) : 65536;
  return { root, maxBytes: resolved };
}

export function apply(ctx, config) {
  const { root, maxBytes } = resolveConfig(config);
  const store = new PresetStore({ root, maxBytes });
  let initPromise;
  const ready = () => {
    if (!initPromise) {
      // 失败不缓存：修好目录权限后下一次请求还能重试。
      initPromise = store.init().catch((error) => {
        initPromise = undefined;
        throw error;
      });
    }
    return initPromise;
  };
  const log = (message) => {
    const line = `agents-md-presets: ${message}`;
    try {
      ctx.logger?.warn?.(line);
    } catch {
      // 日志服务不可用时退回进程 console（web 里会落到启动日志 web-run.log）。
      try {
        console.warn(line);
      } catch {
        // 一切 Log 手段都不可用时保持静默。
      }
    }
  };

  ready().catch((error) => log(`数据目录初始化失败：${error?.message ?? error}`));

  // client-connection 提供的 HostConnectionService 负责浏览器鉴权（admit）。
  // 在 cordis 里它住在 client-connection 自己的作用域：单独 inject(["webServer"])
  // 的回调里 get("connection") 是 undefined（webServer 先就绪时 reference 还没把
  // connection 塞进来）。所以把两个服务一起声明依赖，等两者都就绪再注册路由；
  // 真缺失 connection 的 profile（如无 HTTP 层的裸配置）里这个合并 inject 永远
  // 不会执行，路由保持未注册（插件对 web 之外的 profile 本就没意义）。
  ctx.inject(["webServer", "connection"], (webCtx) => {
    let connection;
    try {
      connection = webCtx.get("connection");
    } catch {
      connection = undefined;
    }
    if (!connection) {
      log("connection 服务不可用：本插件的 HTTP 路由不会做浏览器鉴权");
    }
    const routes = createRoutes({ ctx, store, ready });
    for (const [routePath, handler] of Object.entries(routes)) {
      const wrapped = makeHandler({ handler, ready, log, connection });
      webCtx.effect(
        () => webCtx.webServer.register({ kind: "exact", path: routePath, handler: wrapped }),
        `agents-md-presets: ${routePath}`,
      );
    }
  });
}
