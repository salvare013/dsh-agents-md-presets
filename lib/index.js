import z from "@deepseek-ai/schemastery";

import { createRoutes, makeHandler, API_PREFIX } from "./http.js";
import { PresetStore, resolveDefaultRoot } from "./store.js";

/**
 * Host 半边：把 $DSH_HOME/prompt-presets 里的预设暴露成同源 HTTP 接口，
 * 供 client.js 的设置页（settings.section）与会话预设条（conversation.input.dock）调用。
 * 路由注册方式与桌面端已装第三方插件一致：webCtx.webServer.register({ kind: "exact", path, handler })。
 */

export const name = "prompt-presets";

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
    try {
      ctx.logger?.warn?.(`prompt-presets: ${message}`);
    } catch {
      // 日志服务不可用时保持静默。
    }
  };

  ready().catch((error) => log(`数据目录初始化失败：${error?.message ?? error}`));

  ctx.inject(["webServer"], (webCtx) => {
    const routes = createRoutes({ ctx, store, ready });
    for (const [routePath, handler] of Object.entries(routes)) {
      const wrapped = makeHandler({ handler, ready, log });
      webCtx.effect(
        () => webCtx.webServer.register({ kind: "exact", path: routePath, handler: wrapped }),
        `prompt-presets: ${routePath}`,
      );
    }
  });
}
