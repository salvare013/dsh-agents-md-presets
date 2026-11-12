import { openInEditor } from "./editor.js";
import { PresetError } from "./store.js";

/**
 * HTTP 面：把预设存储包装成同源 JSON 接口。
 * 与 Cordis 解耦，便于用假的 req/res 直接测试。
 */

export const API_PREFIX = "/api/dsh-agents-md-presets";

export function createRoutes({ ctx, store, ready, open = openInEditor }) {
  return {
    [`${API_PREFIX}/state`]: (body) => state({ ctx, store, body }),    [`${API_PREFIX}/preset/read`]: (body) => readPreset({ store, body }),
    [`${API_PREFIX}/preset/create`]: (body) => createPreset({ store, body }),
    [`${API_PREFIX}/preset/update`]: (body) => updatePreset({ store, body }),
    [`${API_PREFIX}/preset/delete`]: (body) => deletePreset({ store, body }),
    [`${API_PREFIX}/preset/sync`]: () => syncPresets({ store }),
    [`${API_PREFIX}/preset/open`]: (body) => openPreset({ store, body, open }),
    [`${API_PREFIX}/apply`]: (body) => applyPreset({ ctx, store, body }),
    [`${API_PREFIX}/workspace/read`]: (body) => readWorkspace({ ctx, store, body }),
    [`${API_PREFIX}/workspace/open`]: (body) => openWorkspace({ ctx, store, body, open }),
  };
}

// ------------------------------------------------------------------ 管道

/**
 * 路由管道。connection 是 client-connection 提供的宿主服务：
 * exact 路由命中时会绕过内置 /api 网关（webServer.match() exact 优先），
 * 所以这里要自己复用 connection.admit() 做 Host/Origin + 浏览器会话检查，
 * 语义与内置网关完全一致（403 = 信任围栏拒绝，401 = 未认证）。
 */
export function makeHandler({ handler, ready, log = () => {}, connection }) {
  return async function handle(request, response) {
    if (connection) {
      let admission;
      try {
        admission = connection.admit(request);
      } catch (error) {
        log(`connection.admit failed: ${error instanceof Error ? error.message : String(error)}`);
        admission = { rejection: 403 };
      }
      if ("rejection" in admission) {
        response.writeHead(admission.rejection, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(admission.rejection === 401 ? "unauthorized" : "forbidden");
        return;
      }
    }
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
    return { presets, limits, root, workspace: null, current: null };
  }
  try {
    const current = await store.currentState(workspacePath);
    return { presets, limits, root, ...current };
  } catch (error) {
    // optionalWorkspacePath 只兜住了「拿不到路径」；目录在取到路径之后被删掉
    // 也要按「当前没有工作区」处理，而不是让整个面板 400。
    if (error instanceof PresetError && error.code === "workspace-missing") {
      return { presets, limits, root, workspace: null, current: null };
    }
    throw error;
  }
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

async function syncPresets({ store }) {
  return { presets: await store.syncPresets() };
}

/** 用本机编辑器打开预设正文（优先 VS Code，退回系统默认程序）。 */
async function openPreset({ store, body, open }) {
  const id = requireId(body.id, "id");
  const file = await store.presetPath(id);
  let result;
  try {
    result = open(file);
  } catch (error) {
    if (error?.code === "file-not-found") throw new PresetError("preset-not-found", "预设文件不存在", 404);
    throw error;
  }
  return { id, file, openedWith: result.openedWith };
}

async function readWorkspace({ ctx, store, body }) {
  const workspacePath = await resolveWorkspacePath(ctx, body);
  return store.readWorkspace(workspacePath);
}

/** 会话内编辑改成「用编辑器打开工作区 AGENTS.md」：文件还不存在时也能先打开空 buffer。 */
async function openWorkspace({ ctx, store, body, open }) {
  const workspacePath = await resolveWorkspacePath(ctx, body);
  const workspace = await store.resolveWorkspace(workspacePath);
  const target = await store.readWorkspace(workspacePath);
  let result;
  try {
    result = open(workspace.file, { requireFile: false });
  } catch (error) {
    if (error?.code === "file-not-found") throw new PresetError("workspace-missing", "工作区文件不存在", 404);
    throw error;
  }
  return {
    workspace: { path: workspace.path, key: workspace.key },
    file: workspace.file,
    exists: target.file.exists,
    openedWith: result.openedWith,
  };
}

async function applyPreset({ ctx, store, body }) {
  const workspacePath = await resolveWorkspacePath(ctx, body);
  return store.applyPreset({
    workspacePath,
    presetId: requireId(body.presetId, "presetId"),
  });
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
 * 工作区目录优先级：显式 workspacePath → 会话 header.cwd → 持久层 header → workingDirectory。
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

  // 老会话不一定还在内存里（sessions.get 只给 live session），
  // 但持久层存着它的 header，切会话后仍然要能读出工作区。
  const persisted = await persistedSessionCwd(ctx, sessionId);
  if (persisted) return persisted;

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

/**
 * 从会话持久层取工作目录。sessionPersistence.stat() 的返回形状随版本变过，
 * 这里按常见层级逐个探测，取不到就返回 undefined 交给调用方兜底。
 */
async function persistedSessionCwd(ctx, sessionId) {
  const persistence = safeGet(ctx, "sessionPersistence");
  if (typeof persistence?.stat !== "function") return undefined;
  let snapshot;
  try {
    snapshot = await persistence.stat(sessionId);
  } catch {
    return undefined;
  }
  if (!snapshot) return undefined;

  const candidates = [
    snapshot.header?.cwd,
    snapshot.cwd,
    snapshot.session?.header?.cwd,
    snapshot.value?.header?.cwd,
    snapshot.snapshot?.header?.cwd,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}
