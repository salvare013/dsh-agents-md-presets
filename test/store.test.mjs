import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PresetError, PresetStore, sha1Of, workspaceKeyOf } from "../lib/store.js";

let root;
let workspace;
let store;

async function readTarget() {
  try {
    return await fs.readFile(path.join(workspace, "AGENTS.md"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

before(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-prompt-presets-"));
  root = path.join(base, "data");
  workspace = path.join(base, "ws");
  await fs.mkdir(workspace, { recursive: true });
  store = new PresetStore({ root, maxBytes: 4096 });
  await store.init();
});

after(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

test("预设 CRUD 与索引持久化", async () => {
  const created = await store.createPreset({ name: "代码审查", description: "review rules", content: "# 审查\n- 只看 diff\n" });
  assert.equal(created.name, "代码审查");
  assert.match(created.id, /^preset-[0-9a-f]{6}$/);
  assert.equal(created.bytes, Buffer.byteLength("# 审查\n- 只看 diff\n", "utf8"));

  const listed = await store.listPresets();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);

  const read = await store.readPreset(created.id);
  assert.equal(read.content, "# 审查\n- 只看 diff\n");

  const updated = await store.updatePreset(created.id, { name: "代码审查 v2", content: "# 审查\n- 看完整文件\n" });
  assert.equal(updated.name, "代码审查 v2");
  assert.equal((await store.readPreset(created.id)).content, "# 审查\n- 看完整文件\n");

  const fresh = new PresetStore({ root, maxBytes: 4096 });
  assert.equal((await fresh.listPresets())[0].name, "代码审查 v2");

  await store.deletePreset(created.id);
  assert.deepEqual(await store.listPresets(), []);
  await assert.rejects(store.readPreset(created.id), (error) => error.code === "preset-not-found");
});

test("应用写入文件、快照与历史；重复应用为 unchanged", async () => {
  const preset = await store.createPreset({ name: "alpha", content: "# alpha rules\n" });
  const original = "# 原始规则\n第二条\n";
  await fs.writeFile(path.join(workspace, "AGENTS.md"), original);

  const applied = await store.applyPreset({ workspacePath: workspace, presetId: preset.id, sessionId: "s-1" });
  assert.equal(applied.unchanged, false);
  assert.equal(applied.current.presetId, preset.id);
  assert.equal((await readTarget()).toString("utf8"), "# alpha rules\n");
  assert.equal(applied.record.beforeSha1, sha1Of(Buffer.from(original, "utf8")));
  assert.equal(applied.record.sessionId, "s-1");

  const snapshot = await fs.readFile(path.join(root, "snapshots", `${applied.record.beforeSha1}.md`), "utf8");
  assert.equal(snapshot, original);

  const historyFile = path.join(root, "history", `${workspaceKeyOf(workspace)}.jsonl`);
  const lines = (await fs.readFile(historyFile, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).action, "apply");

  const again = await store.applyPreset({ workspacePath: workspace, presetId: preset.id });
  assert.equal(again.unchanged, true);
  assert.equal((await fs.readFile(historyFile, "utf8")).trim().split("\n").length, 1);
});

test("回滚恢复应用前字节；回滚本身也可再回滚", async () => {
  const original = "# 原始内容\r\n带 CRLF\r\n";
  await fs.writeFile(path.join(workspace, "AGENTS.md"), original);

  const preset = (await store.listPresets())[0];
  const applied = await store.applyPreset({ workspacePath: workspace, presetId: preset.id });
  assert.equal(applied.unchanged, false);

  const rolled = await store.rollback({ workspacePath: workspace, entryId: applied.record.id, sessionId: "s-2" });
  assert.equal(rolled.unchanged, false);
  assert.equal((await readTarget()).toString("utf8"), original);
  assert.equal(rolled.record.revertedEntryId, applied.record.id);

  const history = await store.history(workspace, 10);
  assert.equal(history[0].action, "rollback");
  assert.equal(history[0].beforeSha1, sha1Of(Buffer.from("# alpha rules\n", "utf8")));

  // 回滚到本条 rollback 之前 → 文件又变回预设内容
  const second = await store.rollback({ workspacePath: workspace, entryId: rolled.record.id });
  assert.equal(second.unchanged, false);
  assert.equal((await readTarget()).toString("utf8"), "# alpha rules\n");

  const third = await store.rollback({ workspacePath: workspace, entryId: rolled.record.id });
  assert.equal(third.unchanged, true);
});

test("原本不存在的 AGENTS.md：应用后创建，回滚后删除", async () => {
  await fs.rm(path.join(workspace, "AGENTS.md"), { force: true });
  const preset = (await store.listPresets())[0];

  const applied = await store.applyPreset({ workspacePath: workspace, presetId: preset.id });
  assert.equal(applied.record.beforeSha1, null);
  assert.equal((await readTarget()) !== null, true);

  const rolled = await store.rollback({ workspacePath: workspace, entryId: applied.record.id });
  assert.equal(rolled.unchanged, false);
  assert.equal((await readTarget()) === null, true);
});

test("超过 maxBytes 的预设被拒绝", async () => {
  await assert.rejects(
    store.createPreset({ name: "too big", content: "x".repeat(5000) }),
    (error) => error instanceof PresetError && error.code === "preset-too-large",
  );
  await assert.rejects(store.createPreset({ name: "  " }), (error) => error.code === "name-required");
});

test("并发写入按工作区串行，两条历史都在", async () => {
  await fs.rm(path.join(workspace, "AGENTS.md"), { force: true });
  const a = await store.createPreset({ name: "a", content: "A\n" });
  const b = await store.createPreset({ name: "b", content: "B\n" });

  const [first, second] = await Promise.all([
    store.applyPreset({ workspacePath: workspace, presetId: a.id }),
    store.applyPreset({ workspacePath: workspace, presetId: b.id }),
  ]);
  assert.equal(first.record.presetId, a.id);
  assert.equal(second.record.presetId, b.id);
  assert.equal((await readTarget()).toString("utf8"), "B\n");

  const history = await store.history(workspace, 10);
  assert.deepEqual(
    history.slice(0, 2).map((item) => item.presetId),
    [b.id, a.id],
  );
});

test("并发创建不再丢预设（索引读改写全局串行）", async () => {
  const before = await store.listPresets();
  const created = await Promise.all(
    Array.from({ length: 12 }, (_, index) => store.createPreset({ name: `并发 ${index}`, content: `并发正文 ${index}\n` })),
  );
  assert.equal(new Set(created.map((item) => item.id)).size, 12);

  const listed = await store.listPresets();
  assert.equal(listed.length, before.length + 12);
  for (const meta of created) {
    assert.ok(listed.some((item) => item.id === meta.id), `索引里缺 ${meta.name}`);
    assert.equal((await store.readPreset(meta.id)).content, `并发正文 ${meta.name.split(" ")[1]}\n`);
  }

  await Promise.all(created.map((meta) => store.deletePreset(meta.id)));
  assert.equal((await store.listPresets()).length, before.length);
});

test("历史坏行被跳过，快照缺失时报错", async () => {
  const key = workspaceKeyOf(workspace);
  await fs.appendFile(path.join(root, "history", `${key}.jsonl`), "{ broken json\n");

  const entries = await store.history(workspace, 50);
  assert.equal(entries.every((item) => typeof item.id === "string"), true);

  await fs.rm(path.join(workspace, "AGENTS.md"), { force: true });
  const preset = await store.createPreset({ name: "c", content: "C\n" });
  const applied = await store.applyPreset({ workspacePath: workspace, presetId: preset.id });
  const fake = { ...applied.record, id: "h-fake", beforeSha1: "0".repeat(40) };
  await fs.appendFile(
    path.join(root, "history", `${key}.jsonl`),
    `${JSON.stringify(fake)}\n`,
  );
  await assert.rejects(
    store.rollback({ workspacePath: workspace, entryId: "h-fake" }),
    (error) => error.code === "snapshot-missing",
  );
});

test("工作区不存在时拒绝", async () => {
  await assert.rejects(
    store.applyPreset({ workspacePath: path.join(workspace, "missing"), presetId: "x" }),
    (error) => error.code === "workspace-missing",
  );
});

// ---------------------------------------------------------------- 隔离用例
// 每条用例用独立数据目录，避免互相依赖执行顺序。

async function freshStore({ maxBytes = 4096 } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-preset-fresh-"));
  const dataRoot = path.join(base, "data");
  const ws = path.join(base, "ws");
  await fs.mkdir(ws, { recursive: true });
  const instance = new PresetStore({ root: dataRoot, maxBytes });
  await instance.init();
  return { base, dataRoot, ws, instance };
}

test("索引损坏时先备份，再从空索引继续", async () => {
  const { base, dataRoot, instance } = await freshStore();
  const indexFile = path.join(dataRoot, "presets.json");
  await fs.writeFile(indexFile, "{ not json", "utf8");

  assert.deepEqual(await instance.listPresets(), []);
  const files = await fs.readdir(dataRoot);
  assert.equal(
    files.some((name) => name.startsWith("presets.json.corrupt-")),
    true,
    "损坏的索引应被改名备份",
  );
  assert.equal(files.includes("presets.json"), false);

  // 备份之后还能正常写入。
  await instance.createPreset({ name: "重建", content: "ok\n" });
  assert.equal((await instance.listPresets()).length, 1);
  await fs.rm(base, { recursive: true, force: true });
});

test("history 的 limit 语义：0 为空、Infinity 为全部", async () => {
  const { base, ws, instance } = await freshStore();
  for (const name of ["一", "二", "三"]) {
    const preset = await instance.createPreset({ name, content: `${name}\n` });
    await instance.applyPreset({ workspacePath: ws, presetId: preset.id });
  }
  assert.deepEqual(await instance.history(ws, 0), []);
  assert.equal((await instance.history(ws, 2)).length, 2);
  assert.equal((await instance.history(ws, Number.POSITIVE_INFINITY)).length, 3);
  await fs.rm(base, { recursive: true, force: true });
});

test("应用时也校验 maxBytes（预设文件被手工改大后拒绝）", async () => {
  const { base, ws, instance } = await freshStore({ maxBytes: 64 });
  const preset = await instance.createPreset({ name: "小", content: "small\n" });
  await fs.writeFile(path.join(base, "data", "presets", `${preset.id}.md`), "x".repeat(200), "utf8");
  await assert.rejects(
    instance.applyPreset({ workspacePath: ws, presetId: preset.id }),
    (error) => error.code === "preset-too-large",
  );
  await fs.rm(base, { recursive: true, force: true });
});

test("回滚拒绝其它工作区的历史记录", async () => {
  const { base, ws, instance } = await freshStore();
  const preset = await instance.createPreset({ name: "甲", content: "甲\n" });
  await instance.applyPreset({ workspacePath: ws, presetId: preset.id });

  const key = workspaceKeyOf(ws);
  const foreign = {
    id: "h-foreign",
    at: new Date().toISOString(),
    action: "apply",
    workspaceKey: key,
    workspacePath: path.join(base, "another-ws"),
    presetId: null,
    presetName: null,
    beforeSha1: null,
    afterSha1: null,
    beforeBytes: 0,
    afterBytes: 0,
    snapshot: null,
    sessionId: null,
    revertedEntryId: null,
  };
  await fs.appendFile(path.join(base, "data", "history", `${key}.jsonl`), `${JSON.stringify(foreign)}\n`);
  await assert.rejects(
    instance.rollback({ workspacePath: ws, entryId: "h-foreign" }),
    (error) => error.code === "history-workspace-mismatch",
  );
  await fs.rm(base, { recursive: true, force: true });
});

test("预设名称不允许重复（忽略大小写与首尾空格，改名时排除自己）", async () => {
  const { base, instance } = await freshStore();
  const first = await instance.createPreset({ name: "Frontend", content: "a\n" });
  await assert.rejects(
    instance.createPreset({ name: "  frontend  ", content: "b\n" }),
    (error) => error instanceof PresetError && error.code === "name-taken" && error.status === 409,
  );
  const second = await instance.createPreset({ name: "Backend", content: "c\n" });
  await assert.rejects(
    instance.updatePreset(second.id, { name: "FRONTEND" }),
    (error) => error.code === "name-taken",
  );
  // 只把自己改成不同大小写不算重名。
  const renamed = await instance.updatePreset(first.id, { name: "frontend" });
  assert.equal(renamed.name, "frontend");
  await fs.rm(base, { recursive: true, force: true });
});

test("新建预设可以先不写正文，等编辑器来填", async () => {
  const { base, instance } = await freshStore();
  const draft = await instance.createPreset({ name: "草稿", description: "刚建好" });
  assert.equal(draft.bytes, 0);
  assert.equal((await instance.readPreset(draft.id)).content, "");
  await fs.rm(base, { recursive: true, force: true });
});
