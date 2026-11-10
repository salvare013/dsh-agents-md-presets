import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { API_PREFIX, createRoutes, makeHandler } from "../lib/http.js";
import { PresetStore } from "../lib/store.js";

/**
 * 真实 HTTP 集成测试：node:http 监听 127.0.0.1:0，按 pathname 分发 createRoutes 的路由，
 * handler 统一走 makeHandler，用全局 fetch 验证响应头、包络、CRUD、apply 与错误契约。
 */

const SESSION_ID = "sess-integration";
const ORIGINAL = "# 原始规则\n\n- 第一条\n- 第二条\n";

let base;
let root;
let workspace;
let store;
let ready;
let server;
let origin;

const ctx = {
  get(key) {
    if (key !== "sessions") return undefined;
    return {
      get(id) {
        return id === SESSION_ID ? { id, header: { cwd: workspace } } : undefined;
      },
    };
  },
};

/** 当前工作区 AGENTS.md 的文本；不存在时返回 null。 */
async function readTarget() {
  try {
    return await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** 按 pathname 找到 makeHandler 包装后的路由，返回 405/404/400 等真实 HTTP 响应。 */
async function call(name, payload, options = {}) {
  const method = options.method ?? "POST";
  const body = payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload);
  const response = await fetch(`${origin}${API_PREFIX}/${name}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json; charset=utf-8" },
    body,
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    json: text ? JSON.parse(text) : null,
  };
}

function assertSuccessEnvelope(result, label) {
  assert.equal(result.status, 200, `${label}：HTTP 状态应为 200`);
  assert.equal(result.contentType, "application/json; charset=utf-8", `${label}：content-type 应为 JSON UTF-8`);
  assert.equal(result.cacheControl, "no-store", `${label}：cache-control 应为 no-store`);
  assert.equal(result.json?.ok, true, `${label}：包络 ok 应为 true`);
  assert.equal(Object.hasOwn(result.json ?? {}, "value"), true, `${label}：成功包络应包含 value`);
  assert.equal(Object.hasOwn(result.json ?? {}, "error"), false, `${label}：成功包络不应包含 error`);
}

function assertErrorEnvelope(result, label, status, code) {
  assert.equal(result.status, status, `${label}：HTTP 状态应为 ${status}`);
  assert.equal(result.contentType, "application/json; charset=utf-8", `${label}：content-type 应为 JSON UTF-8`);
  assert.equal(result.cacheControl, "no-store", `${label}：cache-control 应为 no-store`);
  assert.equal(result.json?.ok, false, `${label}：包络 ok 应为 false`);
  assert.equal(result.json?.error?.code, code, `${label}：错误码应为 ${code}`);
  assert.equal(typeof result.json?.error?.message, "string", `${label}：错误包络应包含 message`);
  assert.equal(result.json?.error?.message.length > 0, true, `${label}：错误 message 不应为空`);
}

before(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-prompt-presets-integration-"));
  root = path.join(base, "data");
  workspace = path.join(base, "ws");
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, "AGENTS.md"), ORIGINAL);

  store = new PresetStore({ root, maxBytes: 4096 });
  ready = () => store.init();

  const handlers = Object.fromEntries(
    Object.entries(createRoutes({ ctx, store, ready })).map(([routePath, handler]) => [
      routePath,
      makeHandler({ handler, ready, log: () => {} }),
    ]),
  );

  server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const handler = handlers[pathname];
    if (!handler) {
      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: false, error: { code: "route-not-found", message: "接口不存在" } }));
      return;
    }
    handler(request, response).catch((error) => {
      // makeHandler 自己兜住业务错误；这里只兜服务器适配层自身的异常，避免测试进程崩溃。
      if (!response.headersSent) {
        response.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
      }
      response.end(JSON.stringify({ ok: false, error: { code: "internal-error", message: String(error?.message ?? error) } }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
  await fs.rm(base, { recursive: true, force: true });
});

test("state：无工作区时返回预设清单，响应头与成功包络符合契约", async () => {
  const result = await call("state", {});
  assertSuccessEnvelope(result, "state");
  assert.deepEqual(result.json.value.presets, [], "初始预设列表应为空");
  assert.equal(result.json.value.workspace, null, "没有 workspacePath/sessionId 时 workspace 应为 null");
  assert.equal(result.json.value.current, null, "没有工作区时 current 应为 null");
  assert.equal(Object.hasOwn(result.json.value, "history"), false, "state 不再返回历史");
  assert.equal(result.json.value.limits.maxBytes, 4096, "limits.maxBytes 应与构造参数一致");
});

test("preset/create → read → update → delete 走完整 CRUD", async () => {
  const created = await call("preset/create", {
    name: "集成测试预设",
    description: "integration",
    content: "# v1\n",
  });
  assertSuccessEnvelope(created, "preset/create");
  const preset = created.json.value.preset;
  assert.match(preset.id, /^[a-z0-9-]+-[0-9a-f]{6}$/, "预设 id 应为 slug-六位十六进制");
  assert.equal(preset.name, "集成测试预设", "预设名称应被保存");
  assert.equal(preset.bytes, Buffer.byteLength("# v1\n", "utf8"), "预设 bytes 应为正文 UTF-8 字节数");

  const read = await call("preset/read", { id: preset.id });
  assertSuccessEnvelope(read, "preset/read");
  assert.equal(read.json.value.preset.id, preset.id, "读取结果应回显预设 id");
  assert.equal(read.json.value.content, "# v1\n", "读取内容应与创建时一致");

  const updated = await call("preset/update", { id: preset.id, name: "集成测试预设 v2", content: "# v2\n" });
  assertSuccessEnvelope(updated, "preset/update");
  assert.equal(updated.json.value.preset.name, "集成测试预设 v2", "更新后名称应改变");
  assert.equal((await call("preset/read", { id: preset.id })).json.value.content, "# v2\n", "更新后正文应改变");

  const listed = await call("state", {});
  assertSuccessEnvelope(listed, "state（列表）");
  assert.equal(listed.json.value.presets.length, 1, "预设清单应包含刚创建的预设");
  assert.equal(listed.json.value.presets[0].name, "集成测试预设 v2", "预设清单应反映更新后的名称");

  const deleted = await call("preset/delete", { id: preset.id });
  assertSuccessEnvelope(deleted, "preset/delete");
  assert.deepEqual(deleted.json.value, { deleted: true, id: preset.id }, "删除结果应回显 id");

  const missing = await call("preset/read", { id: preset.id });
  assertErrorEnvelope(missing, "删除后读取", 404, "preset-not-found");
});

test("preset/create → state（workspacePath）→ apply（sessionId）定位工作区；重复 apply 为 unchanged", async () => {
  const created = await call("preset/create", { name: "工作流预设", content: "# 预设内容\n" });
  assertSuccessEnvelope(created, "preset/create（工作流）");
  const presetId = created.json.value.preset.id;

  const state = await call("state", { workspacePath: workspace });
  assertSuccessEnvelope(state, "state（带 workspacePath）");
  assert.equal(state.json.value.workspace.path, path.resolve(workspace), "state 应回显解析后的工作区路径");
  assert.equal(state.json.value.current.exists, true, "目标 AGENTS.md 应已存在");
  assert.equal(state.json.value.current.presetId, null, "原文不应匹配任何预设");
  assert.equal(await readTarget(), ORIGINAL, "应用前文件应为原文");

  const applied = await call("apply", { presetId, sessionId: SESSION_ID });
  assertSuccessEnvelope(applied, "apply");
  assert.equal(applied.json.value.unchanged, false, "首次应用应写入文件");
  assert.equal(applied.json.value.current.presetId, presetId, "应用后 current.presetId 应为该预设");
  assert.equal(applied.json.value.current.source, "preset", "应用后来源应为预设");
  assert.equal(Object.hasOwn(applied.json.value, "record"), false, "apply 不再返回历史记录");
  assert.equal(await readTarget(), "# 预设内容\n", "应用后文件应为预设内容");

  const again = await call("apply", { presetId, sessionId: SESSION_ID });
  assertSuccessEnvelope(again, "apply（重复）");
  assert.equal(again.json.value.unchanged, true, "内容一致时 apply 应为 unchanged");
  assert.equal(await readTarget(), "# 预设内容\n", "重复应用后文件仍是预设内容");
});

test("错误契约：GET 打 POST 路由 405、读不存在 404、坏 JSON 400、超大请求体 413", async () => {
  const wrongMethod = await call("state", undefined, { method: "GET" });
  assertErrorEnvelope(wrongMethod, "GET /state", 405, "method-not-allowed");

  const notFound = await call("preset/read", { id: "no-such-preset" });
  assertErrorEnvelope(notFound, "读取不存在的预设", 404, "preset-not-found");

  const badJson = await call("preset/read", "{not json");
  assertErrorEnvelope(badJson, "坏 JSON 请求体", 400, "bad-request");

  // 约 1.1MiB 的字符串请求体：超过 readJson 的 1MiB 限制，应在解析前被拒。
  const tooLarge = await call("preset/create", { name: "big", content: "x".repeat(1_100_000) });
  assertErrorEnvelope(tooLarge, "超过 1MiB 的请求体", 413, "body-too-large");
});
