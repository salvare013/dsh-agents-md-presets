import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { API_PREFIX, createRoutes, makeHandler, resolveWorkspacePath } from "../lib/http.js";
import { PresetStore } from "../lib/store.js";

let root;
let workspace;
let store;
let routes;
let ready;
const openedFiles = [];

const fakeOpen = (file, options = {}) => {
  if (options.requireFile !== false && !existsSync(file)) {
    const error = new Error(`file not found: ${file}`);
    error.code = "file-not-found";
    throw error;
  }
  openedFiles.push(file);
  return { openedWith: "vscode" };
};

const ctx = {
  get(key) {
    if (key !== "sessions") return undefined;
    return {
      get(id) {
        return id === "sess-1" ? { id, header: { cwd: workspace } } : undefined;
      },
    };
  },
};

function fakeRequest(method, payload) {
  const text =
    payload === undefined ? "" : typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (text) yield Buffer.from(text, "utf8");
    },
  };
}

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    text: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(text) {
      this.text = text;
    },
  };
}

async function call(name, payload, options = {}) {
  const handler = makeHandler({ handler: routes[`${API_PREFIX}/${name}`], ready, log: () => {} });
  const response = fakeResponse();
  await handler(fakeRequest(options.method ?? "POST", payload), response);
  return { status: response.status, headers: response.headers, json: response.text ? JSON.parse(response.text) : null };
}

async function readTarget() {
  try {
    return await fs.readFile(path.join(workspace, "AGENTS.md"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

before(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-prompt-presets-http-"));
  root = path.join(base, "data");
  workspace = path.join(base, "ws");
  await fs.mkdir(workspace, { recursive: true });
  store = new PresetStore({ root, maxBytes: 4096 });
  ready = () => store.init();
  routes = createRoutes({ ctx, store, ready, open: fakeOpen });
});

after(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

test("state：没有工作区时只返回预设清单", async () => {
  const { status, headers, json } = await call("state", {});
  assert.equal(status, 200);
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(json.ok, true);
  assert.deepEqual(json.value.presets, []);
  assert.equal(json.value.workspace, null);
  assert.equal(json.value.limits.maxBytes, 4096);
});

test("state：传入的目录不存在时降级为 workspace=null，而不是 400", async () => {
  const vanished = path.join(workspace, "vanished-dir");
  const { status, json } = await call("state", { workspacePath: vanished });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.value.workspace, null);
  assert.equal(json.value.current, null);
  assert.deepEqual(json.value.presets, []);
});

test("connection.admit 校验：拒绝时用内置网关同样的 401/403 纯文本", async () => {
  const routes401 = makeHandler({
    handler: routes[`${API_PREFIX}/state`],
    ready,
    log: () => {},
    connection: { admit: () => ({ rejection: 401 }) },
  });
  const denied401 = fakeResponse();
  await routes401(fakeRequest("POST", {}), denied401);
  assert.equal(denied401.status, 401);
  assert.equal(denied401.text, "unauthorized");
  assert.equal(denied401.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(denied401.headers["cache-control"], "no-store");
  assert.equal(denied401.headers["x-content-type-options"], "nosniff");

  const routes403 = makeHandler({
    handler: routes[`${API_PREFIX}/state`],
    ready,
    log: () => {},
    connection: { admit: () => ({ rejection: 403 }) },
  });
  const denied403 = fakeResponse();
  await routes403(fakeRequest("POST", {}), denied403);
  assert.equal(denied403.status, 403);
  assert.equal(denied403.text, "forbidden");

  // admit 抛异常：按网关语义宁可拒绝，也不放行。
  const routesBoom = makeHandler({
    handler: routes[`${API_PREFIX}/state`],
    ready,
    log: () => {},
    connection: {
      admit: () => {
        throw new Error("admit crashed");
      },
    },
  });
  const boom = fakeResponse();
  await routesBoom(fakeRequest("POST", {}), boom);
  assert.equal(boom.status, 403);
  assert.equal(boom.text, "forbidden");

  // 放行时返回 admission 原值，handler 正常执行。
  const peer = { id: "peer-1" };
  const routesOpen = makeHandler({
    handler: routes[`${API_PREFIX}/state`],
    ready,
    log: () => {},
    connection: { admit: () => ({ peer }) },
  });
  const allowed = fakeResponse();
  await routesOpen(fakeRequest("POST", {}), allowed);
  assert.equal(allowed.status, 200);
  assert.equal(JSON.parse(allowed.text).ok, true);
});

test("create / read / update / delete 走完整链路", async () => {
  const created = await call("preset/create", { name: "前端", description: "ui", content: "# ui rules\n" });
  assert.equal(created.status, 200);
  const id = created.json.value.preset.id;
  assert.match(id, /^[a-z0-9-]+-[0-9a-f]{6}$/);

  const read = await call("preset/read", { id });
  assert.equal(read.json.value.content, "# ui rules\n");

  const updated = await call("preset/update", { id, name: "前端 v2", content: "# ui rules v2\n" });
  assert.equal(updated.json.value.preset.name, "前端 v2");

  const listed = await call("state", { workspacePath: workspace });
  assert.equal(listed.json.value.presets.length, 1);
  assert.equal(listed.json.value.current.exists, false);
  assert.equal(listed.json.value.current.presetId, null);

  const deleted = await call("preset/delete", { id });
  assert.equal(deleted.json.value.deleted, true);
});

test("apply 用 sessionId 定位工作区，重复应用为 unchanged", async () => {
  const created = await call("preset/create", { name: "alpha", content: "# alpha\n" });
  const presetId = created.json.value.preset.id;

  const applied = await call("apply", { presetId, sessionId: "sess-1" });
  assert.equal(applied.status, 200);
  assert.equal(applied.json.value.unchanged, false);
  assert.equal(applied.json.value.current.presetId, presetId);
  assert.equal(applied.json.value.current.source, "preset");
  assert.equal(await readTarget(), "# alpha\n");

  const again = await call("apply", { presetId, sessionId: "sess-1" });
  assert.equal(again.json.value.unchanged, true);
  assert.equal(await readTarget(), "# alpha\n");
});

test("state 带工作区时返回 current（没有文件时 exists=false）", async () => {
  await fs.rm(path.join(workspace, "AGENTS.md"), { force: true });
  const { json } = await call("state", { sessionId: "sess-1" });
  assert.equal(json.ok, true);
  assert.equal(json.value.workspace.key.length, 16);
  assert.equal(json.value.current.exists, false);
  assert.equal(json.value.current.source, "workspace");
  assert.equal(json.value.history, undefined);
});

test("错误契约：405 / 404 / 400 / 413 / 大小限制", async () => {
  const getResult = await call("state", {}, { method: "GET" });
  assert.equal(getResult.status, 405);
  assert.equal(getResult.json.error.code, "method-not-allowed");

  const notFound = await call("preset/read", { id: "nope" });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.error.code, "preset-not-found");

  const badJson = await call("preset/read", "{oops");
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.error.code, "bad-request");

  const tooLarge = await call("preset/create", { name: "big", content: "x".repeat(5000) });
  assert.equal(tooLarge.status, 400);
  assert.equal(tooLarge.json.error.code, "preset-too-large");

  const noWorkspace = await call("apply", { presetId: "whatever" });
  assert.equal(noWorkspace.status, 400);
  assert.equal(noWorkspace.json.error.code, "workspace-unresolved");

  const missingId = await call("apply", { sessionId: "sess-1" });
  assert.equal(missingId.status, 400);
  assert.equal(missingId.json.error.code, "id-required");
});

test("workspace/read 读取工作区实际文件", async () => {
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# 会话前\n");

  const before = await call("workspace/read", { sessionId: "sess-1" });
  assert.equal(before.status, 200);
  assert.equal(before.json.value.content, "# 会话前\n");
  assert.equal(before.json.value.file.exists, true);

  await fs.rm(path.join(workspace, "AGENTS.md"));
  const missing = await call("workspace/read", { sessionId: "sess-1" });
  assert.equal(missing.status, 200);
  assert.equal(missing.json.value.file.exists, false);
  assert.equal(missing.json.value.content, "");
});

test("preset/sync 对齐外部编辑后的 sha1，文件缺失标 missing", async () => {
  const preset = (await call("preset/create", { name: "sync-me", content: "# v1\n" })).json.value.preset;
  const file = path.join(root, "presets", `${preset.id}.md`);
  await fs.writeFile(file, "# v1 手工加长\n");

  const synced = await call("preset/sync", {});
  assert.equal(synced.status, 200);
  const found = synced.json.value.presets.find((item) => item.id === preset.id);
  assert.equal(found.bytes, Buffer.byteLength("# v1 手工加长\n"));
  assert.equal(found.missing, undefined);

  const read = await call("preset/read", { id: preset.id });
  assert.equal(read.json.value.content, "# v1 手工加长\n");

  await fs.rm(file);
  const missing = await call("preset/sync", {});
  assert.equal(missing.json.value.presets.find((item) => item.id === preset.id).missing, true);

  const gone = await call("preset/read", { id: preset.id });
  assert.equal(gone.status, 404);
});

test("preset/open 调本机编辑器；文件缺失是 404", async () => {
  const preset = (await call("preset/create", { name: "open-me", content: "# open\n" })).json.value.preset;
  const opened = await call("preset/open", { id: preset.id });
  assert.equal(opened.status, 200);
  assert.equal(opened.json.value.openedWith, "vscode");
  assert.equal(opened.json.value.id, preset.id);
  assert.ok(openedFiles.some((file) => file === opened.json.value.file));

  await fs.rm(path.join(root, "presets", `${preset.id}.md`));
  const missing = await call("preset/open", { id: preset.id });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "preset-not-found");
});

test("workspace/open 用编辑器打开工作区 AGENTS.md（文件不存在也能先打开）", async () => {
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# 编辑中\n");
  const existing = await call("workspace/open", { sessionId: "sess-1" });
  assert.equal(existing.status, 200);
  assert.equal(existing.json.value.openedWith, "vscode");
  assert.equal(existing.json.value.exists, true);
  assert.ok(openedFiles.some((file) => file === existing.json.value.file));

  await fs.rm(path.join(workspace, "AGENTS.md"));
  const missing = await call("workspace/open", { sessionId: "sess-1" });
  assert.equal(missing.status, 200);
  assert.equal(missing.json.value.exists, false);
  assert.ok(openedFiles.some((file) => file === missing.json.value.file));
});

test("同名预设：新建与改名都返回 409 name-taken", async () => {
  const created = await call("preset/create", { name: "唯一名字", content: "# a\n" });
  assert.equal(created.status, 200);

  const duplicate = await call("preset/create", { name: "唯一名字", content: "# b\n" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error.code, "name-taken");

  const other = (await call("preset/create", { name: "另一个", content: "# c\n" })).json.value.preset;
  const rename = await call("preset/update", { id: other.id, name: " 唯一名字 " });
  assert.equal(rename.status, 409);
  assert.equal(rename.json.error.code, "name-taken");

  // 不带正文的新建（编辑器里再写）可以成功。
  const empty = await call("preset/create", { name: "空白草稿", description: "待写" });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.value.preset.bytes, 0);
});

test("老会话不在内存里时用 sessionPersistence.stat 的 header.cwd 定位工作区", async () => {
  const seen = [];
  const persistence = {
    async stat(id) {
      seen.push(id);
      if (id === "sess-old") return { header: { cwd: workspace } };
      if (id === "sess-flat") return { cwd: workspace };
      throw new Error("boom");
    },
  };
  const offline = {
    get(key) {
      if (key === "sessions") return { get: () => undefined };
      if (key === "sessionPersistence") return persistence;
      return undefined;
    },
  };

  assert.equal(await resolveWorkspacePath(offline, { sessionId: "sess-old" }), workspace);
  assert.equal(await resolveWorkspacePath(offline, { sessionId: "sess-flat" }), workspace);
  await assert.rejects(
    () => resolveWorkspacePath(offline, { sessionId: "sess-broken" }),
    (error) => error.code === "workspace-unresolved",
  );
  assert.deepEqual(seen, ["sess-old", "sess-flat", "sess-broken"]);
});

test("state 对老会话也能返回工作区与 current", async () => {
  const offline = {
    get(key) {
      if (key === "sessions") return { get: () => undefined };
      if (key === "sessionPersistence") return { stat: async () => ({ header: { cwd: workspace } }) };
      return undefined;
    },
  };
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# 老会话内容\n", "utf8");
  const offlineRoutes = createRoutes({ ctx: offline, store, ready });
  const handler = makeHandler({ handler: offlineRoutes[`${API_PREFIX}/state`], ready, log: () => {} });
  const response = fakeResponse();
  await handler(fakeRequest("POST", { sessionId: "sess-old" }), response);
  assert.equal(response.status, 200);
  const body = JSON.parse(response.text);
  assert.equal(body.value.workspace.path, path.resolve(workspace));
  assert.equal(body.value.current.exists, true);
});
