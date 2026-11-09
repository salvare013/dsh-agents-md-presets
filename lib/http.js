import { PresetError } from "./store.js";

/**
 * HTTP 面：把预设存储包装成同源 JSON 接口。
 * 与 Cordis 解耦，便于用假的 req/res 直接测试。
 */

export const API_PREFIX = "/api/dsh-prompt-presets";

export function createRoutes({ ctx, store, ready }) {
  return {
    [`${API_PREFIX}/state`]: (body) => state({ ctx, store, body }),
    [`${API_PREFIX}/preset/read`]: (body) => readPreset({ store, body }),
    [`${API_PREFIX}/preset/create`]: (body) => createPreset({ store, body }),
    [`${API_PREFIX}/preset/update`]: (body) => updatePreset({ store, body }),
    [`${API_PREFIX}/preset/delete`]: (body) => deletePreset({ store, body }),
    [`${API_PREFIX}/apply`]: (body) => applyPreset({ ctx, store, body }),
    [`${API_PREFIX}/rollback`]: (body) => rollbackPreset({ ctx, store, body }),
  };
}

// ------------------------------------------------------------------ 管道

export function makeHandler({ handler, ready, log = () => {} }) {
  return async function handle(request, response) {
    if ((request.method ?? "GET").toUpperCase() !== "POST") {
      send(
        response,
        405,
        { ok: false, error: { code: "method-not-allowed", message: "只接受 POST" } },
        { allow: "POST" },
      );
      return;
    }
    try {
      const body = await readJson(request);
      await ready();
      const value = await handler(body);
      send(response, 200, { ok: true, value });
    } catch (error) {
      const known = error instanceof PresetError;
      const status = known ? error.status : 500;
      const code = known ? error.code : "internal-error";
      if (!known) {
        // 未预期的异常只进日志，不把内部细节回给浏览器。
        log(`internal-error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      }
      const message = known ? error.message : "服务内部错误，请查看宿主日志";
      send(response, status, { ok: false, error: { code, message } });
    }
  };
}

function send(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(payload);
}

async function readJson(request, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new PresetError("body-too-large", "请求体过大", 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PresetError("bad-request", "请求体不是合法 JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PresetError("bad-request", "请求体必须是 JSON 对象", 400);
  }
  return parsed;
}

// ------------------------------------------------------------------ 业务

async function state({ ctx, store, body }) {
  const presets = await store.listPresets();
  const limits = store.limits();
  const root = store.root;
  const workspacePath = await optionalWorkspacePath(ctx, body);
  if (!workspacePath) {
    return { presets, limits, root, workspace: null, current: null, history: [] };
  }
  const [current, history, allHistory] = await Promise.all([
    store.currentState(workspacePath),
    store.history(workspacePath, body.historyLimit ?? 20),
    store.history(workspacePath, Number.POSITIVE_INFINITY),
  ]);
  return { presets, limits, root, ...current, history, historyTotal: allHistory.length };
}

async function readPreset({ store, body }) {
  const { preset, content } = await store.readPreset(requireId(body.id, "id"));
  return { preset, content };
}

async function createPreset({ store, body }) {
  const preset = await store.createPreset({
    name: body.name,
    description: body.description,
    content: body.content,
  });
  return { preset };
}

async function updatePreset({ store, body }) {
  const preset = await store.updatePreset(requireId(body.id, "id"), {
    name: body.name,
    description: body.description,
    content: body.content,
  });
  return { preset };
}

async function deletePreset({ store, body }) {
  return store.deletePreset(requireId(body.id, "id"));
}

async function applyPreset({ ctx, store, body }) {
  const workspacePath = await resolveWorkspacePath(ctx, body);
  const result = await store.applyPreset({
    workspacePath,
    presetId: requireId(body.presetId, "presetId"),
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
  });
  const [history, allHistory] = await Promise.all([
    store.history(workspacePath, 20),
    store.history(workspacePath, Number.POSITIVE_INFINITY),
  ]);
  return { ...result, history, historyTotal: allHistory.length };
}

async function rollbackPreset({ ctx, store, body }) {
  const workspacePath = await resolveWorkspacePath(ctx, body);
  const result = await store.rollback({
    workspacePath,
    entryId: requireId(body.entryId, "entryId"),
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
  });
  const [history, allHistory] = await Promise.all([
    store.history(workspacePath, 20),
    store.history(workspacePath, Number.POSITIVE_INFINITY),
  ]);
  return { ...result, history, historyTotal: allHistory.length };
}

// ------------------------------------------------------------------ 工作区

function requireId(value, field) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) throw new PresetError("id-required", `${field} 不能为空`);
  return id;
}

async function optionalWorkspacePath(ctx, body) {
  try {
    return await resolveWorkspacePath(ctx, body);
  } catch (error) {
    // 设置页/无会话面板打开时本来就没有工作区；目录被删也只是「当前没有工作区」，
    // 不该让整个面板报 500。
    if (
      error instanceof PresetError &&
      (error.code === "workspace-unresolved" || error.code === "workspace-missing")
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * 工作区目录优先级：显式 workspacePath → 会话 header.cwd → workingDirectory。
 * 设置页没有会话，只认显式路径；会话面板只带 sessionId。
 */
export async function resolveWorkspacePath(ctx, body) {
  const explicit = typeof body.workspacePath === "string" ? body.workspacePath.trim() : "";
  if (explicit) return explicit;

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) throw new PresetError("workspace-unresolved", "缺少工作区：请传入 workspacePath 或 sessionId");

  const sessions = safeGet(ctx, "sessions");
  const session = sessions?.get?.(sessionId);
  const cwd = session?.header?.cwd;
  if (typeof cwd === "string" && cwd.trim()) return cwd;

  const workingDirectory = safeGet(ctx, "workingDirectory");
  if (session && typeof workingDirectory?.get === "function") {
    try {
      const dir = workingDirectory.get(session);
      if (typeof dir === "string" && dir.trim()) return dir;
    } catch {
      // 继续走下面的报错。
    }
  }
  throw new PresetError("workspace-unresolved", `无法确定会话 ${sessionId} 的工作区目录`);
}

function safeGet(ctx, key) {
  try {
    return ctx.get(key);
  } catch {
    return undefined;
  }
}
