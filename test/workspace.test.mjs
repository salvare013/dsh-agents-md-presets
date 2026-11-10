import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PresetStore, sha1Of } from "../lib/store.js";

/** 每个用例一个独立数据目录 + 工作区，避免互相污染。 */
async function freshStore({ maxBytes = 4096, withWorkspace = true } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-prompt-presets-ws-"));
  const root = path.join(base, "data");
  const workspace = path.join(base, "ws");
  if (withWorkspace) await fs.mkdir(workspace, { recursive: true });
  const store = new PresetStore({ root, maxBytes });
  await store.init();
  const file = path.join(workspace, "AGENTS.md");
  return {
    base,
    root,
    workspace,
    store,
    file,
    async cleanup() {
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}

async function readFileOrNull(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

test("readWorkspace 返回工作区实际文件；文件不存在时是空内容", async () => {
  const t = await freshStore();
  try {
    const empty = await t.store.readWorkspace(t.workspace);
    assert.equal(empty.file.exists, false);
    assert.equal(empty.file.sha1, null);
    assert.equal(empty.content, "");

    await fs.writeFile(t.file, "# 原文\n");
    const read = await t.store.readWorkspace(t.workspace);
    assert.equal(read.file.exists, true);
    assert.equal(read.file.sha1, sha1Of(Buffer.from("# 原文\n")));
    assert.equal(read.content, "# 原文\n");
  } finally {
    await t.cleanup();
  }
});

test("syncPresets 对齐外部编辑、标记缺失、恢复后清除 missing", async () => {
  const t = await freshStore();
  try {
    const preset = await t.store.createPreset({ name: "外部编辑", content: "# v1\n" });
    const file = path.join(t.root, "presets", `${preset.id}.md`);

    await fs.writeFile(file, "# v1 被外部改长\n");
    const synced = await t.store.syncPresets();
    const found = synced.find((item) => item.id === preset.id);
    assert.equal(found.bytes, Buffer.byteLength("# v1 被外部改长\n"));
    assert.equal(found.sha1, sha1Of(Buffer.from("# v1 被外部改长\n")));
    assert.equal(found.missing, undefined);
    assert.equal((await t.store.readPreset(preset.id)).content, "# v1 被外部改长\n");

    await fs.rm(file);
    const missing = (await t.store.syncPresets()).find((item) => item.id === preset.id);
    assert.equal(missing.missing, true);
    await assert.rejects(t.store.readPreset(preset.id), (error) => error.code === "preset-not-found");

    await fs.writeFile(file, "# 回来了\n");
    const restored = (await t.store.syncPresets()).find((item) => item.id === preset.id);
    assert.equal(restored.missing, undefined);
    assert.equal((await t.store.readPreset(preset.id)).content, "# 回来了\n");
  } finally {
    await t.cleanup();
  }
});

test("没有应用记录时按内容认预设（手工把预设内容拷进工作区）", async () => {
  const t = await freshStore();
  try {
    const preset = await t.store.createPreset({ name: "拷进来的", content: "# 拷进来的全文\n" });
    await fs.writeFile(t.file, "# 拷进来的全文\n");

    const state = await t.store.currentState(t.workspace);
    assert.equal(state.current.exists, true);
    assert.equal(state.current.source, "preset");
    assert.equal(state.current.presetId, preset.id);
    assert.equal(state.current.name, "拷进来的");
    assert.equal(state.current.description, "");

    // 内容与任何预设都不同，且没有应用记录 → 用户自己的原文。
    await fs.writeFile(t.file, "# 用户自己写的\n");
    const own = await t.store.currentState(t.workspace);
    assert.equal(own.current.source, "workspace");
    assert.equal(own.current.presetId, null);
    assert.equal(own.current.name, null);
  } finally {
    await t.cleanup();
  }
});

test("工作区目录不存在时 readWorkspace 明确报错", async () => {
  const t = await freshStore({ withWorkspace: false });
  try {
    await assert.rejects(t.store.readWorkspace(t.workspace), (error) => error.code === "workspace-missing");
  } finally {
    await t.cleanup();
  }
});

test("应用后用编辑器外部改动：刷新时标成「<预设名>（会话内修改）」", async () => {
  const t = await freshStore();
  try {
    await fs.writeFile(t.file, "# 原文\n");
    const preset = await t.store.createPreset({ name: "外部改", content: "# 预设正文\n", description: "说明文字" });
    await t.store.applyPreset({ workspacePath: t.workspace, presetId: preset.id });

    // 模拟「编辑」在编辑器里打开工作区 AGENTS.md 后追加内容并保存。
    await fs.writeFile(t.file, "# 预设正文\n- 编辑器里加的\n");
    const state = await t.store.currentState(t.workspace);
    assert.equal(state.current.source, "custom");
    assert.equal(state.current.presetId, null);
    assert.equal(state.current.name, "外部改（会话内修改）");
    assert.equal(state.current.description, "说明文字");

    // 改回预设原文，内容 sha1 又能对上预设。
    await fs.writeFile(t.file, "# 预设正文\n");
    const back = await t.store.currentState(t.workspace);
    assert.equal(back.current.source, "preset");
    assert.equal(back.current.presetId, preset.id);
    assert.equal(back.current.name, "外部改");
  } finally {
    await t.cleanup();
  }
});

test("应用预设会创建不存在的 AGENTS.md，并记录状态", async () => {
  const t = await freshStore();
  try {
    const preset = await t.store.createPreset({ name: "生成", content: "# 生成的文件\n" });
    const applied = await t.store.applyPreset({ workspacePath: t.workspace, presetId: preset.id });
    assert.equal(applied.unchanged, false);
    assert.equal(applied.current.exists, true);
    assert.equal(await readFileOrNull(t.file), "# 生成的文件\n");
    assert.equal(applied.current.source, "preset");
  } finally {
    await t.cleanup();
  }
});
