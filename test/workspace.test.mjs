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

test("writeWorkspace 直接写文件、记历史，来源标成会话内自定义", async () => {
  const t = await freshStore();
  try {
    await fs.writeFile(t.file, "# 原文\n");

    const result = await t.store.writeWorkspace({
      workspacePath: t.workspace,
      content: "# 会话内改的\n",
      sessionId: "sess-1",
    });
    assert.equal(result.unchanged, false);
    assert.equal(result.current.exists, true);
    assert.equal(result.current.source, "custom");
    assert.equal(result.current.name, "会话内自定义");
    assert.equal(result.current.presetId, null);
    assert.equal(result.current.bytes, Buffer.byteLength("# 会话内改的\n"));
    assert.equal(await readFileOrNull(t.file), "# 会话内改的\n");

    assert.equal(result.record.action, "apply");
    assert.equal(result.record.presetId, null);
    assert.equal(result.record.sessionId, "sess-1");
    const entries = await t.store.history(t.workspace, Infinity);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].afterSha1, sha1Of(Buffer.from("# 会话内改的\n")));

    const again = await t.store.writeWorkspace({ workspacePath: t.workspace, content: "# 会话内改的\n" });
    assert.equal(again.unchanged, true);
    assert.equal(again.record, null);
  } finally {
    await t.cleanup();
  }
});

test("先应用预设再会话内修改：label 继承预设名，回滚回到预设内容", async () => {
  const t = await freshStore();
  try {
    const preset = await t.store.createPreset({ name: "代码审查", content: "# 审查\n" });
    await t.store.applyPreset({ workspacePath: t.workspace, presetId: preset.id, sessionId: "sess-1" });

    const edited = await t.store.writeWorkspace({
      workspacePath: t.workspace,
      content: "# 审查（我改了这条）\n",
      sessionId: "sess-1",
    });
    assert.equal(edited.current.source, "custom");
    assert.equal(edited.current.name, "代码审查（会话内修改）");
    assert.equal(edited.current.presetId, null);

    const applied = await t.store.currentState(t.workspace);
    assert.equal(applied.current.source, "custom");

    const back = await t.store.rollback({
      workspacePath: t.workspace,
      entryId: edited.record.id,
      sessionId: "sess-1",
    });
    assert.equal(await readFileOrNull(t.file), "# 审查\n");
    assert.equal(back.current.source, "preset");
    assert.equal(back.current.presetId, preset.id);
  } finally {
    await t.cleanup();
  }
});

test("工作区原本没有 AGENTS.md：写入可回滚，回滚后文件被删除", async () => {
  const t = await freshStore();
  try {
    const read = await t.store.readWorkspace(t.workspace);
    assert.equal(read.file.exists, false);
    assert.equal(read.content, "");

    const written = await t.store.writeWorkspace({
      workspacePath: t.workspace,
      content: "# 新建\n",
    });
    assert.equal(written.current.exists, true);
    assert.equal(written.record.beforeSha1, null);
    assert.equal(written.record.snapshot, null);

    const rolled = await t.store.rollback({ workspacePath: t.workspace, entryId: written.record.id });
    assert.equal(await readFileOrNull(t.file), null);
    assert.equal(rolled.current.exists, false);
    assert.equal(rolled.current.source, "workspace");
  } finally {
    await t.cleanup();
  }
});

test("writeWorkspace 同样受 maxBytes 限制", async () => {
  const t = await freshStore({ maxBytes: 24 });
  try {
    await assert.rejects(
      t.store.writeWorkspace({ workspacePath: t.workspace, content: "x".repeat(64) }),
      (error) => error.code === "preset-too-large",
    );
    assert.equal(await readFileOrNull(t.file), null);
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

test("没有历史时按内容认预设（手工把预设内容拷进工作区）", async () => {
  const t = await freshStore();
  try {
    const preset = await t.store.createPreset({ name: "拷进来的", content: "# 拷进来的全文\n" });
    await fs.writeFile(t.file, "# 拷进来的全文\n");

    const state = await t.store.currentState(t.workspace);
    assert.equal(state.current.exists, true);
    assert.equal(state.current.source, "preset");
    assert.equal(state.current.presetId, preset.id);
    assert.equal(state.current.name, "拷进来的");
    assert.equal(state.current.entryId, null);

    // 内容与任何预设都不同 → 用户自己的原文。
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
    const preset = await t.store.createPreset({ name: "外部改", content: "# 预设正文\n" });
    await t.store.applyPreset({ workspacePath: t.workspace, presetId: preset.id });

    // 模拟「编辑」在编辑器里打开工作区 AGENTS.md 后追加内容并保存。
    await fs.writeFile(t.file, "# 预设正文\n- 编辑器里加的\n");
    const state = await t.store.currentState(t.workspace);
    assert.equal(state.current.source, "custom");
    assert.equal(state.current.presetId, null);
    assert.equal(state.current.name, "外部改（会话内修改）");
    assert.ok(state.current.entryId);

    // 改回预设原文，历史里那条 apply 又能对上，恢复成预设来源。
    await fs.writeFile(t.file, "# 预设正文\n");
    const back = await t.store.currentState(t.workspace);
    assert.equal(back.current.source, "preset");
    assert.equal(back.current.presetId, preset.id);
    assert.equal(back.current.name, "外部改");
  } finally {
    await t.cleanup();
  }
});
