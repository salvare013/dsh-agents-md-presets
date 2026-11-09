import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { API_PREFIX, createRoutes, makeHandler } from "../lib/http.js";
import { PresetStore } from "../lib/store.js";

let root;
let workspace;
let store;
let routes;
let ready;

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
  routes = createRoutes({ ctx, store, ready });
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
  assert.equal(applied.json.value.history.length, 1);
  assert.equal(await readTarget(), "# alpha\n");

  const again = await call("apply", { presetId, sessionId: "sess-1" });
  assert.equal(again.json.value.unchanged, true);
  assert.equal(again.json.value.history.length, 1);
});

test("rollback 恢复原文件并可重复回滚", async () => {
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# 原来的规则\n");
  const preset = (await call("preset/create", { name: "beta", content: "# beta\n" })).json.value.preset;

  const applied = await call("apply", { presetId: preset.id, sessionId: "sess-1" });
  const entryId = applied.json.value.record.id;

  const rolled = await call("rollback", { entryId, sessionId: "sess-1" });
  assert.equal(rolled.status, 200);
  assert.equal(await readTarget(), "# 原来的规则\n");
  assert.equal(rolled.json.value.history[0].action, "rollback");
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
