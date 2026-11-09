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
const MAX_HISTORY = 500;
// 会话里直接改写工作区文件时用的名字：这类内容只存在于工作区，不是全局预设。
const CUSTOM_LABEL = "会话内自定义";
const CUSTOM_SUFFIX = "（会话内修改）";

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
  let normalized = path.resolve(workspacePath).replace(/\\/g, "/");
  // Windows/macOS 的文件名大小写不敏感，同一目录的不同写法要落到同一条历史里；
  // Linux 上 A 与 a 是两个目录，混用会互相串历史，所以只在大小写不敏感的平台上折叠。
  if (process.platform === "win32" || process.platform === "darwin") normalized = normalized.toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

const SHA1_PATTERN = /^[0-9a-f]{40}$/;

function stripLongPathPrefix(value) {
  return value.replace(/^\\\\\?\\/, "");
}

function samePath(a, b) {
  const left = stripLongPathPrefix(path.resolve(String(a))).replace(/\\/g, "/");
  const right = stripLongPathPrefix(path.resolve(String(b))).replace(/\\/g, "/");
  return process.platform === "win32" || process.platform === "darwin"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
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
      // 索引损坏：先把现场备份走再让用户重建；备份失败就报错，绝不静默返回空索引
      // （否则下一次写入会把原文件覆盖掉，预设全丢）。
      const backup = `${file}.corrupt-${Date.now()}`;
      try {
        await fs.rename(file, backup);
      } catch (error) {
        throw new PresetError(
          "index-corrupt",
          `预设索引已损坏且无法备份（${error.code ?? error.message}），已停止写入以免丢数据；请检查 ${file}`,
          500,
        );
      }
      this.corruptBackups = [...(this.corruptBackups ?? []), backup];
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
    // 索引文件是用户可编辑的：文件名只取 basename，挡住 ../ 目录穿越。
    const fallback = `${String(meta.id).replace(/[^a-zA-Z0-9._-]/g, "")}.md`;
    const name = path.basename(String(meta.file || fallback));
    const safe = name && name !== "." && name !== ".." && !name.includes("\\") ? name : fallback;
    return path.join(this.presetsDir, safe);
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
    const content = await this.#readPresetFile(meta);
    return { preset: { ...meta }, content };
  }

  async #readPresetFile(meta) {
    return fs.readFile(this.#presetFile(meta), "utf8").catch((error) => {
      if (error.code === "ENOENT") throw new PresetError("preset-not-found", "预设文件不存在", 404);
      throw error;
    });
  }

  async createPreset({ name, description = "", content = "" }) {
    const cleanName = this.#normalizeName(name);
    const cleanDescription = this.#normalizeDescription(description);
    const body = String(content ?? "");
    const bytes = Buffer.byteLength(body, "utf8");
    this.#assertSize(bytes);

    return this.#serializedIndex(async () => {
      const index = await this.#readIndex();
      this.#assertUniqueName(index, cleanName);
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
      if (patch.name !== undefined) {
        next.name = this.#normalizeName(patch.name);
        this.#assertUniqueName(index, next.name, id);
      }
      if (patch.description !== undefined) next.description = this.#normalizeDescription(patch.description);

      let body;
      if (patch.content !== undefined) {
        body = String(patch.content ?? "");
        const bytes = Buffer.byteLength(body, "utf8");
        this.#assertSize(bytes);
        next.bytes = bytes;
        next.sha1 = sha1Of(Buffer.from(body, "utf8"));
      } else {
        body = await this.#readPresetFile(meta);
        const bytes = Buffer.byteLength(body, "utf8");
        this.#assertSize(bytes);
        next.bytes = bytes;
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

  /** 预设正文文件的绝对路径（用本地编辑器打开时用）。 */
  async presetPath(id) {
    const { meta } = await this.#findPreset(id);
    return this.#presetFile(meta);
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

  /** 预设名称去重：大小写不敏感，改名时排除自己。 */
  #assertUniqueName(index, name, exceptId = null) {
    const key = name.toLocaleLowerCase();
    const clash = index.presets.find(
      (item) => item.id !== exceptId && String(item.name ?? "").trim().toLocaleLowerCase() === key,
    );
    if (clash) throw new PresetError("name-taken", `已存在同名预设：${clash.name}`, 409);
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

  #describeWorkspace(workspace, target, info = {}) {
    return {
      workspace: { path: workspace.path, key: workspace.key },
      current: {
        exists: target.exists,
        sha1: target.sha1,
        bytes: target.size,
        presetId: info.presetId ?? null,
        name: info.name ?? null,
        source: info.source ?? "workspace",
        entryId: info.entryId ?? null,
      },
    };
  }

  /**
   * 判断工作区文件现在是什么：某个预设（内容一致）、会话内自定义，还是用户自己的原文。
   * 历史里最后一条「落点等于当前内容」的记录决定它是怎么来的。
   */
  #currentInfo(target, index, entries) {
    const latest = target.sha1
      ? [...entries].reverse().find((item) => item.afterSha1 === target.sha1) ?? null
      : null;
    const newest = entries.length ? entries[entries.length - 1] : null;
    let preset = null;
    let source = "workspace";
    let name = null;
    if (latest?.presetId) preset = index.presets.find((item) => item.id === latest.presetId) ?? null;
    if (preset) {
      source = "preset";
      name = preset.name;
    } else if (latest && latest.action === "apply" && !latest.presetId) {
      source = "custom";
      name = latest.presetName ?? CUSTOM_LABEL;
    } else if (target.sha1) {
      // 没有历史（比如文件是手工拷进来的）时，按内容认预设。
      preset = index.presets.find((item) => item.sha1 === target.sha1) ?? null;
      if (preset) {
        source = "preset";
        name = preset.name;
      } else if (newest?.action === "apply" && (newest.presetId || newest.presetName)) {
        // 上次写入之后文件又被改过（典型是用「编辑」在编辑器里改了工作区文件）：
        // 标成会话内修改，让人知道它已经从哪个预设偏离了。
        const base = newest.presetId
          ? index.presets.find((item) => item.id === newest.presetId) ?? null
          : null;
        source = "custom";
        name = base ? `${base.name}${CUSTOM_SUFFIX}` : newest.presetName ?? CUSTOM_LABEL;
      }
    }
    return {
      preset,
      source,
      name,
      entryId: (latest ?? (source === "custom" ? newest : null))?.id ?? null,
      info: {
        presetId: preset?.id ?? null,
        name,
        source,
        entryId: (latest ?? (source === "custom" ? newest : null))?.id ?? null,
      },
    };
  }

  async currentState(workspacePath) {
    const workspace = await this.resolveWorkspace(workspacePath);
    const target = await this.#readTarget(workspace.file);
    const index = await this.#readIndex();
    const entries = await this.#readHistory(workspace.key);
    return this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, entries).info);
  }

  /** 读取工作区里实际生效的 AGENTS.md，供会话面板预览/编辑。 */
  async readWorkspace(workspacePath) {
    const workspace = await this.resolveWorkspace(workspacePath);
    const target = await this.#readTarget(workspace.file);
    return {
      workspace: { path: workspace.path, key: workspace.key },
      file: { exists: target.exists, sha1: target.sha1, bytes: target.size },
      content: target.exists ? target.bytes.toString("utf8") : "",
    };
  }

  // ---------------------------------------------------------------- 应用 / 回滚

  applyPreset({ workspacePath, presetId, sessionId = null }) {
    return this.#serialized(workspacePath, async () => {
      const workspace = await this.resolveWorkspace(workspacePath);
      const index = await this.#readIndex();
      const meta = index.presets.find((item) => item.id === presetId);
      if (!meta) throw new PresetError("preset-not-found", "预设不存在", 404);

      const presetBytes = await fs.readFile(this.#presetFile(meta)).catch((error) => {
        // 预设文件被手工删掉时给 404，而不是 500。
        if (error.code === "ENOENT") throw new PresetError("preset-not-found", "预设文件不存在", 404);
        throw error;
      });
      this.#assertSize(presetBytes.length);
      const presetSha = sha1Of(presetBytes);
      let target = await this.#readTarget(workspace.file);

      if (target.sha1 === presetSha) {
        const entries = await this.#readHistory(workspace.key);
        return {
          unchanged: true,
          record: null,
          preset: { ...meta },
          ...this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, entries).info),
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
      const entries = await this.#readHistory(workspace.key);
      return {
        unchanged: false,
        record,
        preset: { ...meta },
        ...this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, entries).info),
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
      // 历史文件是按工作区 key 存的；大小写折叠或路径写法不同（A 与 a）时，
      // 必须确认这条记录确实属于当前目录，否则会把别人的快照写进来。
      if (entry.workspacePath && !samePath(entry.workspacePath, workspace.path)) {
        throw new PresetError("history-workspace-mismatch", "这条历史记录属于另一个工作区，已拒绝回滚", 409);
      }
      if (entry.beforeSha1 !== null && !SHA1_PATTERN.test(String(entry.beforeSha1))) {
        throw new PresetError("history-corrupt", "历史记录里的快照标识不合法，已拒绝回滚", 409);
      }

      const target = await this.#readTarget(workspace.file);
      if (target.sha1 === entry.beforeSha1) {
        return {
          unchanged: true,
          record: null,
          ...this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, entries).info),
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
      const afterEntries = await this.#readHistory(workspace.key);
      return {
        unchanged: false,
        record,
        ...this.#describeWorkspace(workspace, after, this.#currentInfo(after, index, afterEntries).info),
      };
    });
  }

  /**
   * 会话内直接写工作区文件：不走预设，记录成 presetId=null 的自定义应用，
   * 因此同样进历史、同样可回滚，而全局预设一个字节都不改。
   */
  writeWorkspace({ workspacePath, content, sessionId = null, label = null }) {
    return this.#serialized(workspacePath, async () => {
      const workspace = await this.resolveWorkspace(workspacePath);
      const body = String(content ?? "");
      const payload = Buffer.from(body, "utf8");
      this.#assertSize(payload.length);
      const nextSha = sha1Of(payload);

      const index = await this.#readIndex();
      let target = await this.#readTarget(workspace.file);
      let entries = await this.#readHistory(workspace.key);
      const before = this.#currentInfo(target, index, entries);
      const customName =
        (typeof label === "string" && label.trim()) ||
        (before.source === "preset" ? `${before.name}${CUSTOM_SUFFIX}` : CUSTOM_LABEL);

      if (target.sha1 === nextSha) {
        return {
          unchanged: true,
          record: null,
          label: customName,
          ...this.#describeWorkspace(workspace, target, before.info),
        };
      }

      const snapshot = target.exists ? await this.#ensureSnapshot(target) : null;
      const record = this.#newRecord("apply", workspace, {
        presetId: null,
        presetName: customName,
        beforeSha1: target.sha1,
        afterSha1: nextSha,
        beforeBytes: target.size,
        afterBytes: payload.length,
        snapshot,
        sessionId,
        revertedEntryId: null,
      });

      await writeAtomic(workspace.file, payload);
      await this.#appendHistory(workspace.key, record);

      target = await this.#readTarget(workspace.file);
      entries = await this.#readHistory(workspace.key);
      return {
        unchanged: false,
        record,
        label: customName,
        ...this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, entries).info),
      };
    });
  }

  /**
   * 用外部编辑器改过预设文件后，把索引里的 sha1 / 字节数重新对齐。
   * 只修正元数据，不改文件名、不改内容；文件被删掉时标 missing。
   */
  syncPresets() {
    return this.#serializedIndex(async () => {
      const index = await this.#readIndex();
      let changed = false;
      for (const meta of index.presets) {
        try {
          const bytes = await fs.readFile(this.#presetFile(meta));
          const sha1 = sha1Of(bytes);
          if (meta.sha1 !== sha1 || meta.bytes !== bytes.length) {
            meta.sha1 = sha1;
            meta.bytes = bytes.length;
            meta.updatedAt = now();
            changed = true;
          }
          if (meta.missing) {
            delete meta.missing;
            changed = true;
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          if (!meta.missing) {
            meta.missing = true;
            changed = true;
          }
        }
      }
      if (changed) await this.#writeIndex(index);
      return index.presets.map((meta) => ({ ...meta }));
    });
  }

  async history(workspacePath, limit = 50) {
    const key = workspaceKeyOf(workspacePath);
    const entries = await this.#readHistory(key);
    const ordered = entries.slice().reverse();
    if (limit === Number.POSITIVE_INFINITY) return ordered;
    const requested = Number(limit);
    const size = Number.isFinite(requested) ? Math.max(0, Math.min(Math.trunc(requested), MAX_HISTORY)) : 50;
    return size === 0 ? [] : ordered.slice(0, size);
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
      const existing = await fs.readFile(snapshotPath);
      // 内容寻址：同名文件理应同内容。读回校验，坏了就重写成正确字节。
      if (sha1Of(existing) === target.sha1) return name;
      await writeAtomic(snapshotPath, target.bytes);
      return name;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await writeAtomic(snapshotPath, target.bytes);
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
