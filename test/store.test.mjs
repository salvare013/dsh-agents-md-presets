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

async function readState() {
  const file = path.join(root, "state", `${workspaceKeyOf(workspace)}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

before(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-agents-md-presets-"));
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

test("应用写入文件并记录最后预设；覆盖前保留一份备份；重复应用 unchanged", async () => {
  const preset = await store.createPreset({ name: "alpha", content: "# alpha rules\n" });
  const original = "# 原始规则\n第二条\n";
  await fs.writeFile(path.join(workspace, "AGENTS.md"), original);

  const applied = await store.applyPreset({ workspacePath: workspace, presetId: preset.id });
  assert.equal(applied.unchanged, false);
  assert.equal(applied.current.presetId, preset.id);
  assert.equal(applied.current.source, "preset");
  assert.equal((await readTarget()).toString("utf8"), "# alpha rules\n");

  // 状态文件只记「最后应用了哪个预设」，没有历史列表。
  const state = await readState();
  assert.equal(state.presetId, preset.id);
  assert.equal(state.sha1, preset.sha1);

  // 原文件在被覆盖前留了最近一份备份。
  const backup = await fs.readFile(path.join(root, "backup", `${workspaceKeyOf(workspace)}.md`), "utf8");
  assert.equal(backup, original);

  const again = await store.applyPreset({ workspacePath: workspace, presetId: preset.id });
  assert.equal(again.unchanged, true);
  assert.equal((await readTarget()).toString("utf8"), "# alpha rules\n");
});

test("换一个预设时备份的是上一个预设写入的内容", async () => {
  const next = await store.createPreset({ name: "beta", content: "# beta rules\n" });
  const applied = await store.applyPreset({ workspacePath: workspace, presetId: next.id });
  assert.equal(applied.unchanged, false);

  const backup = await fs.readFile(path.join(root, "backup", `${workspaceKeyOf(workspace)}.md`), "utf8");
  assert.equal(backup, "# alpha rules\n");
  assert.equal((await readState()).presetId, next.id);
});

test("外部改动后 current 标成「（会话内修改）」，改回预设内容又认作预设", async () => {
  const preset = (await store.listPresets()).find((item) => item.name === "beta");
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# beta rules\n- 手工补一条\n");

  const custom = await store.currentState(workspace);
  assert.equal(custom.current.source, "custom");
  assert.equal(custom.current.presetId, null);
  assert.equal(custom.current.name, "beta（会话内修改）");
  assert.notEqual(custom.current.sha1, preset.sha1);

  await fs.writeFile(path.join(workspace, "AGENTS.md"), "# beta rules\n");
  const back = await store.currentState(workspace);
  assert.equal(back.current.source, "preset");
  assert.equal(back.current.presetId, preset.id);
});

test("原本不存在的 AGENTS.md：应用后创建，不产生备份", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-preset-empty-"));
  const ws = path.join(base, "ws");
  await fs.mkdir(ws, { recursive: true });
  const instance = new PresetStore({ root: path.join(base, "data") });
  await instance.init();
  const preset = await instance.createPreset({ name: "新建", content: "# created\n" });

  const applied = await instance.applyPreset({ workspacePath: ws, presetId: preset.id });
  assert.equal(applied.unchanged, false);
  assert.equal(applied.current.exists, true);
  assert.equal(await fs.readFile(path.join(ws, "AGENTS.md"), "utf8"), "# created\n");
  assert.deepEqual(await fs.readdir(path.join(base, "data", "backup")), []);

  await fs.rm(base, { recursive: true, force: true });
});

test("超过 maxBytes 的预设被拒绝", async () => {
  await assert.rejects(
    store.createPreset({ name: "too big", content: "x".repeat(5000) }),
    (error) => error instanceof PresetError && error.code === "preset-too-large",
  );
  await assert.rejects(store.createPreset({ name: "  " }), (error) => error.code === "name-required");
});

test("并发写入按工作区串行，最终是后一次的内容", async () => {
  await fs.rm(path.join(workspace, "AGENTS.md"), { force: true });
  const a = await store.createPreset({ name: "a", content: "A\n" });
  const b = await store.createPreset({ name: "b", content: "B\n" });

  const [first, second] = await Promise.all([
    store.applyPreset({ workspacePath: workspace, presetId: a.id }),
    store.applyPreset({ workspacePath: workspace, presetId: b.id }),
  ]);
  assert.equal(first.preset.id, a.id);
  assert.equal(second.preset.id, b.id);
  assert.equal((await readTarget()).toString("utf8"), "B\n");
  assert.equal((await readState()).presetId, b.id);
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

test("列表按创建时间排序，改名不会把条目顶到最前面", async () => {
  const { base, instance } = await freshStore();
  const a = await instance.createPreset({ name: "A", content: "a\n" });
  const b = await instance.createPreset({ name: "B", content: "b\n" });
  const c = await instance.createPreset({ name: "C", content: "c\n" });
  assert.deepEqual((await instance.listPresets()).map((meta) => meta.id), [c.id, b.id, a.id]);
  await instance.updatePreset(a.id, { name: "A2", description: "改过" });
  assert.deepEqual((await instance.listPresets()).map((meta) => meta.id), [c.id, b.id, a.id]);
  await fs.rm(base, { recursive: true, force: true });
});

test("currentState 在文件不存在时给出 exists=false、source=workspace", async () => {
  const { base, ws, instance } = await freshStore();
  const state = await instance.currentState(ws);
  assert.equal(state.current.exists, false);
  assert.equal(state.current.sha1, null);
  assert.equal(state.current.bytes, 0);
  assert.equal(state.current.source, "workspace");
  await fs.rm(base, { recursive: true, force: true });
});

test("applyPreset 缺 workspacePath 是 400 workspace-unresolved，而不是 TypeError 500", async () => {
  const { base, instance } = await freshStore();
  const preset = await instance.createPreset({ name: "守卫", content: "x\n" });
  await assert.rejects(
    async () => instance.applyPreset({ presetId: preset.id }),
    (error) => error instanceof PresetError && error.code === "workspace-unresolved" && error.status === 400,
  );
  await assert.rejects(
    async () => instance.applyPreset({ workspacePath: "   ", presetId: preset.id }),
    (error) => error.code === "workspace-unresolved",
  );
  await fs.rm(base, { recursive: true, force: true });
});

test("预设删除后：文件没动过 → source=deleted；被人改过 → custom", async () => {
  const { base, ws, instance } = await freshStore();
  const preset = await instance.createPreset({ name: "会消失", content: "# gone\n" });
  await instance.applyPreset({ workspacePath: ws, presetId: preset.id });
  await instance.deletePreset(preset.id);

  const untouched = await instance.currentState(ws);
  assert.equal(untouched.current.source, "deleted");
  assert.equal(untouched.current.presetId, null);
  assert.equal(untouched.current.name, "会消失");
  assert.equal(untouched.current.description, null);

  await instance.createPreset({ name: "别的", content: "other\n" });
  const edited = await instance.currentState(ws);
  assert.equal(edited.current.source, "deleted", "内容仍等于 state.sha1 时即使有新预设也保持 deleted");

  await fs.writeFile(path.join(ws, "AGENTS.md"), "# gone\n- 手工补一条\n");
  const changed = await instance.currentState(ws);
  assert.equal(changed.current.source, "custom");
  assert.equal(changed.current.name, "会消失（会话内修改）");
  await fs.rm(base, { recursive: true, force: true });
});

test("同内容两个预设：归属跟随最后应用的预设", async () => {
  const { base, ws, instance } = await freshStore();
  const a = await instance.createPreset({ name: "tie-a", content: "SAME\n" });
  const b = await instance.createPreset({ name: "tie-b", content: "SAME\n" });
  // 没 apply 过：按索引顺序归到先创建的那个。
  const before = await instance.currentState(ws);
  await fs.writeFile(path.join(ws, "AGENTS.md"), "SAME\n");
  const neutral = await instance.currentState(ws);
  assert.equal(neutral.current.source, "preset");
  assert.equal(neutral.current.presetId, a.id);
  assert.notEqual(before.current.presetId, undefined);

  await instance.applyPreset({ workspacePath: ws, presetId: b.id });
  const after = await instance.currentState(ws);
  assert.equal(after.current.source, "preset");
  assert.equal(after.current.presetId, b.id, "内容相同时应归属 state 里最后应用的预设");
  await fs.rm(base, { recursive: true, force: true });
});

test("updatePreset 补正文会清掉 missing 标记", async () => {
  const { base, instance } = await freshStore();
  const draft = await instance.createPreset({ name: "草稿2", content: "" });
  await fs.rm(path.join(base, "data", "presets", `${draft.id}.md`));
  const synced = await instance.syncPresets();
  assert.equal(synced.find((item) => item.id === draft.id).missing, true);

  const updated = await instance.updatePreset(draft.id, { content: "# 有正文了\n" });
  assert.equal(updated.missing, undefined);
  const listed = await instance.syncPresets();
  assert.equal(listed.find((item) => item.id === draft.id).missing, undefined);
  await fs.rm(base, { recursive: true, force: true });
});

test("畸形索引条目被备份成 .dropped-*，且同一批只备份一次", async () => {
  const { base, dataRoot, instance } = await freshStore();
  const indexFile = path.join(dataRoot, "presets.json");
  await fs.writeFile(
    indexFile,
    JSON.stringify({ version: 1, presets: [
      { id: "good", name: "good", file: "good.md", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", bytes: 0, sha1: "x" },
      { id: 123, name: "数字 id" },
      null,
    ] }),
    "utf8",
  );
  const listed = await instance.listPresets();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "good");

  let dropped = (await fs.readdir(dataRoot)).filter((name) => name.startsWith("presets.json.dropped-"));
  assert.equal(dropped.length, 1, "畸形条目应生成一份备份");

  // 第二次读不再追加备份。
  await instance.listPresets();
  dropped = (await fs.readdir(dataRoot)).filter((name) => name.startsWith("presets.json.dropped-"));
  assert.equal(dropped.length, 1);

  // 正常写入后索引不再包含畸形条目，备份仍在。
  await instance.createPreset({ name: "good-2", content: "" });
  assert.equal((await instance.listPresets()).length, 2);
  dropped = (await fs.readdir(dataRoot)).filter((name) => name.startsWith("presets.json.dropped-"));
  assert.equal(dropped.length, 1);
  await fs.rm(base, { recursive: true, force: true });
});

test("init 清理超过 24 小时的 .tmp- 残留，新的保留", async () => {
  const { base, dataRoot } = await freshStore();
  const stale = path.join(dataRoot, ".presets.json.tmp-" + "a".repeat(12));
  const fresh = path.join(dataRoot, ".presets.json.tmp-" + "b".repeat(12));
  await fs.writeFile(stale, "stale");
  await fs.writeFile(fresh, "fresh");
  const old = new Date(Date.now() - 26 * 60 * 60 * 1000);
  await fs.utimes(stale, old, old);

  const instance = new PresetStore({ root: dataRoot });
  await instance.init();
  assert.equal(await fs.stat(stale).then(() => true, () => false), false, "过期 tmp 应被清理");
  assert.equal(await fs.stat(fresh).then(() => true, () => false), true, "新 tmp 应保留");
  await fs.rm(base, { recursive: true, force: true });
});
