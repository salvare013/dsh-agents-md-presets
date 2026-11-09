import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 数据层：预设、快照、历史，以及对工作区 AGENTS.md 的原子应用/回滚。
 * 不依赖 Cordis，纯 Node 实现，便于单独测试。
 */

const INDEX_FILE = "presets.json";
const TARGET_NAME = "AGENTS.md";
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

export class PresetError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PresetError";
    this.code = code;
    this.status = status;
  }
}

export function resolveDefaultRoot() {
  const configured = (process.env.DSH_HOME ?? "").trim();
  const home = configured || path.join(os.homedir(), ".dsh");
  return path.join(home, "prompt-presets");
}

export function sha1Of(data) {
  return crypto.createHash("sha1").update(data).digest("hex");
}

export function workspaceKeyOf(workspacePath) {
  const normalized = path.resolve(workspacePath).replace(/\\/g, "/").toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function stripLongPathPrefix(value) {
  return value.replace(/^\\\\\?\\/, "");
}

function now() {
  return new Date().toISOString();
}

function newRecordId() {
  return `h-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function slugOf(name) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "preset";
}

async function writeAtomic(target, data) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${crypto.randomBytes(6).toString("hex")}`);
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export class PresetStore {
  #queues = new Map();

  constructor({ root, maxBytes = 65536 } = {}) {
    this.root = path.resolve(root || resolveDefaultRoot());
    this.maxBytes = Number.isFinite(Number(maxBytes)) && Number(maxBytes) > 0 ? Number(maxBytes) : 65536;
    this.presetsDir = path.join(this.root, "presets");
    this.historyDir = path.join(this.root, "history");
    this.snapshotsDir = path.join(this.root, "snapshots");
  }

  limits() {
    return { maxBytes: this.maxBytes, maxName: MAX_NAME, maxDescription: MAX_DESCRIPTION };
  }

  async init() {
    for (const dir of [this.root, this.presetsDir, this.historyDir, this.snapshotsDir]) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------- 索引

  async #readIndex() {
    const file = path.join(this.root, INDEX_FILE);
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, presets: [] };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.presets)) throw new Error("bad shape");
      const presets = parsed.presets.filter(
        (item) => item && typeof item.id === "string" && typeof item.name === "string",
      );
      return { version: 1, presets };
    } catch {
      // 索引损坏：保留现场后从空索引开始，避免整个功能不可用。
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      return { version: 1, presets: [] };
    }
  }

  async #writeIndex(index) {
    await writeAtomic(path.join(this.root, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  }

  async #findPreset(id) {
    const index = await this.#readIndex();
    const meta = index.presets.find((item) => item.id === id);
    if (!meta) throw new PresetError("preset-not-found", "预设不存在", 404);
    return { index, meta };
  }

  #presetFile(meta) {
    return path.join(this.presetsDir, meta.file || `${meta.id}.md`);
  }

  // ---------------------------------------------------------------- 预设 CRUD

  async listPresets() {
    const index = await this.#readIndex();
    return index.presets
      .slice()
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .map((meta) => ({ ...meta }));
  }

  async readPreset(id) {
    const { meta } = await this.#findPreset(id);
    const content = await fs.readFile(this.#presetFile(meta), "utf8");
    return { preset: { ...meta }, content };
  }

  async createPreset({ name, description = "", content = "" }) {
    const cleanName = this.#normalizeName(name);
    const cleanDescription = this.#normalizeDescription(description);
    const body = String(content ?? "");
    const bytes = Buffer.byteLength(body, "utf8");
    this.#assertSize(bytes);

    return this.#serializedIndex(async () => {
      const index = await this.#readIndex();
      let id;
      do {
        id = `${slugOf(cleanName)}-${crypto.randomBytes(3).toString("hex")}`;
      } while (index.presets.some((item) => item.id === id));

      const meta = {
        id,
        name: cleanName,
        description: cleanDescription,
        file: `${id}.md`,
        createdAt: now(),
        updatedAt: now(),
        bytes,
        sha1: sha1Of(Buffer.from(body, "utf8")),
      };
      await writeAtomic(this.#presetFile(meta), Buffer.from(body, "utf8"));
      index.presets.push(meta);
      try {
        await this.#writeIndex(index);
      } catch (error) {
        // 索引没写成功就别留下孤儿文件。
        await fs.rm(this.#presetFile(meta), { force: true }).catch(() => {});
        throw error;
      }
      return { ...meta };
    });
  }

  async updatePreset(id, patch = {}) {
    return this.#serializedIndex(async () => {
      const { index, meta } = await this.#findPreset(id);
      const next = { ...meta };
      if (patch.name !== undefined) next.name = this.#normalizeName(patch.name);
      if (patch.description !== undefined) next.description = this.#normalizeDescription(patch.description);

      let body;
      if (patch.content !== undefined) {
        body = String(patch.content ?? "");
        const bytes = Buffer.byteLength(body, "utf8");
        this.#assertSize(bytes);
        next.bytes = bytes;
        next.sha1 = sha1Of(Buffer.from(body, "utf8"));
      } else {
        body = await fs.readFile(this.#presetFile(meta), "utf8");
        next.bytes = Buffer.byteLength(body, "utf8");
        next.sha1 = sha1Of(Buffer.from(body, "utf8"));
      }
      next.updatedAt = now();

      const payload = Buffer.from(body, "utf8");
      await writeAtomic(this.#presetFile(next), payload);
      index.presets = index.presets.map((item) => (item.id === id ? next : item));
      await this.#writeIndex(index);
      return { ...next };
    });
  }

  async deletePreset(id) {
    return this.#serializedIndex(async () => {
      const { index, meta } = await this.#findPreset(id);
      await fs.rm(this.#presetFile(meta), { force: true });
      index.presets = index.presets.filter((item) => item.id !== id);
      await this.#writeIndex(index);
      return { deleted: true, id };
    });
  }

  #normalizeName(value) {
    const name = String(value ?? "").trim();
    if (!name) throw new PresetError("name-required", "预设名称不能为空");
    if (name.length > MAX_NAME) throw new PresetError("name-too-long", `预设名称最多 ${MAX_NAME} 个字符`);
    return name;
  }

  #normalizeDescription(value) {
    const description = String(value ?? "").trim();
    if (description.length > MAX_DESCRIPTION) {
      throw new PresetError("description-too-long", `说明最多 ${MAX_DESCRIPTION} 个字符`);
    }
    return description;
  }

  #assertSize(bytes) {
    if (bytes > this.maxBytes) {
      throw new PresetError(
        "preset-too-large",
        `预设正文 ${bytes} 字节，超过上限 ${this.maxBytes} 字节（内置 AGENTS.md 加载器上限）`,
      );
    }
  }

  // ---------------------------------------------------------------- 工作区

  async resolveWorkspace(workspacePath) {
    if (!workspacePath) throw new PresetError("workspace-unresolved", "缺少工作区路径");
    const abs = path.resolve(String(workspacePath));
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new PresetError("workspace-missing", `工作区目录不存在：${abs}`);
    }
    let real = abs;
    try {
      real = stripLongPathPrefix(await fs.realpath(abs));
    } catch {
      real = abs;
    }
    return { path: abs, real, key: workspaceKeyOf(abs), file: path.join(real, TARGET_NAME) };
  }

  async #readTarget(file) {
    let bytes = null;
    try {
      bytes = await fs.readFile(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return {
      exists: bytes !== null,
      bytes,
      sha1: bytes === null ? null : sha1Of(bytes),
      size: bytes === null ? 0 : bytes.length,
    };
  }

  #describeWorkspace(workspace, target, presetId = null) {
    return {
      workspace: { path: workspace.path, key: workspace.key },
      current: {
        exists: target.exists,
        sha1: target.sha1,
        bytes: target.size,
        presetId,
      },
    };
  }

  async currentState(workspacePath) {
    const workspace = await this.resolveWorkspace(workspacePath);
    const target = await this.#readTarget(workspace.file);
    const index = await this.#readIndex();
    const matched = target.sha1 ? index.presets.find((item) => item.sha1 === target.sha1) ?? null : null;
    return this.#describeWorkspace(workspace, target, matched ? matched.id : null);
  }

  // ---------------------------------------------------------------- 应用 / 回滚

  applyPreset({ workspacePath, presetId, sessionId = null }) {
    return this.#serialized(workspacePath, async () => {
      const workspace = await this.resolveWorkspace(workspacePath);
      const index = await this.#readIndex();
      const meta = index.presets.find((item) => item.id === presetId);
      if (!meta) throw new PresetError("preset-not-found", "预设不存在", 404);

      const presetBytes = await fs.readFile(this.#presetFile(meta));
      const presetSha = sha1Of(presetBytes);
      let target = await this.#readTarget(workspace.file);

      if (target.sha1 === presetSha) {
        return {
          unchanged: true,
          record: null,
          preset: { ...meta },
          ...this.#describeWorkspace(workspace, target, meta.id),
        };
      }

      const snapshot = target.exists ? await this.#ensureSnapshot(target) : null;
      const record = this.#newRecord("apply", workspace, {
        presetId: meta.id,
        presetName: meta.name,
        beforeSha1: target.sha1,
        afterSha1: presetSha,
        beforeBytes: target.size,
        afterBytes: presetBytes.length,
        snapshot,
        sessionId,
        revertedEntryId: null,
      });

      await writeAtomic(workspace.file, presetBytes);
      await this.#appendHistory(workspace.key, record);

      target = await this.#readTarget(workspace.file);
      return {
        unchanged: false,
        record,
        preset: { ...meta },
        ...this.#describeWorkspace(workspace, target, meta.id),
      };
    });
  }

  rollback({ workspacePath, entryId, sessionId = null }) {
    return this.#serialized(workspacePath, async () => {
      const workspace = await this.resolveWorkspace(workspacePath);
      const index = await this.#readIndex();
      const entries = await this.#readHistory(workspace.key);
      const entry = entries.find((item) => item.id === entryId);
      if (!entry) throw new PresetError("history-not-found", "找不到这条历史记录", 404);

      const target = await this.#readTarget(workspace.file);
      if (target.sha1 === entry.beforeSha1) {
        const matched = target.sha1 ? index.presets.find((item) => item.sha1 === target.sha1) ?? null : null;
        return {
          unchanged: true,
          record: null,
          ...this.#describeWorkspace(workspace, target, matched ? matched.id : null),
        };
      }

      let restoreBytes = null;
      if (entry.beforeSha1 !== null) {
        const snapshotPath = path.join(this.snapshotsDir, `${entry.beforeSha1}.md`);
        try {
          restoreBytes = await fs.readFile(snapshotPath);
        } catch {
          throw new PresetError("snapshot-missing", `快照缺失（${entry.beforeSha1}），无法回滚`, 409);
        }
        if (sha1Of(restoreBytes) !== entry.beforeSha1) {
          throw new PresetError("snapshot-corrupt", `快照内容与记录不一致（${entry.beforeSha1}），已中止回滚`, 409);
        }
      }

      const snapshot = target.exists ? await this.#ensureSnapshot(target) : null;
      const record = this.#newRecord("rollback", workspace, {
        presetId: null,
        presetName: entry.presetName ?? null,
        beforeSha1: target.sha1,
        afterSha1: entry.beforeSha1,
        beforeBytes: target.size,
        afterBytes: restoreBytes ? restoreBytes.length : 0,
        snapshot,
        sessionId,
        revertedEntryId: entry.id,
      });

      if (restoreBytes === null) {
        await fs.rm(workspace.file, { force: true });
      } else {
        await writeAtomic(workspace.file, restoreBytes);
      }
      await this.#appendHistory(workspace.key, record);

      const after = await this.#readTarget(workspace.file);
      const matched = after.sha1 ? index.presets.find((item) => item.sha1 === after.sha1) ?? null : null;
      return {
        unchanged: false,
        record,
        ...this.#describeWorkspace(workspace, after, matched ? matched.id : null),
      };
    });
  }

  async history(workspacePath, limit = 50) {
    const key = workspaceKeyOf(workspacePath);
    const entries = await this.#readHistory(key);
    const size = Math.max(0, Math.min(Number(limit) || 50, 500));
    return entries.slice(-size).reverse();
  }

  // ---------------------------------------------------------------- 内部工具

  #newRecord(action, workspace, fields) {
    return {
      id: newRecordId(),
      at: now(),
      action,
      workspaceKey: workspace.key,
      workspacePath: workspace.path,
      ...fields,
    };
  }

  async #ensureSnapshot(target) {
    const name = `${target.sha1}.md`;
    const snapshotPath = path.join(this.snapshotsDir, name);
    try {
      await fs.access(snapshotPath);
    } catch {
      await writeAtomic(snapshotPath, target.bytes);
    }
    return name;
  }

  async #appendHistory(key, record) {
    await fs.mkdir(this.historyDir, { recursive: true });
    await fs.appendFile(path.join(this.historyDir, `${key}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
  }

  async #readHistory(key) {
    const file = path.join(this.historyDir, `${key}.jsonl`);
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const entries = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        if (record && typeof record.id === "string" && typeof record.action === "string") entries.push(record);
      } catch {
        // 单行损坏不影响其余记录。
      }
    }
    return entries;
  }

  #serialized(workspacePath, task) {
    return this.#serializedKey(`ws:${workspaceKeyOf(workspacePath)}`, task);
  }

  // 索引的读-改-写必须全局串行，否则两个并发请求会互相覆盖 last-writer-wins。
  #serializedIndex(task) {
    return this.#serializedKey("index", task);
  }

  #serializedKey(key, task) {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const run = previous.then(
      () => task(),
      () => task(),
    );
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(key, settled);
    settled.then(() => {
      if (this.#queues.get(key) === settled) this.#queues.delete(key);
    });
    return run;
  }
}
