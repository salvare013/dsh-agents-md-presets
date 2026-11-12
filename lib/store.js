import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 数据层：预设、工作区状态，以及对工作区 AGENTS.md 的原子应用。
 * 不依赖 Cordis，纯 Node 实现，便于单独测试。
 */

const INDEX_FILE = "presets.json";
const TARGET_NAME = "AGENTS.md";
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
// 工作区文件偏离了最后一次应用的预设时，用这个后缀说明它来自哪个预设。
const CUSTOM_SUFFIX = "（会话内修改）";
const CUSTOM_LABEL = "会话内自定义";

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
  return path.join(home, "agents-md-presets");
}

export function sha1Of(data) {
  return crypto.createHash("sha1").update(data).digest("hex");
}

export function workspaceKeyOf(workspacePath) {
  let normalized = path.resolve(workspacePath).replace(/\\/g, "/");
  // Windows/macOS 的文件名大小写不敏感，同一目录的不同写法要落到同一份状态里；
  // Linux 上 A 与 a 是两个目录，混用会互相串状态，所以只在大小写不敏感的平台上折叠。
  if (process.platform === "win32" || process.platform === "darwin") normalized = normalized.toLowerCase();
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function stripLongPathPrefix(value) {
  return value.replace(/^\\\\\?\\/, "");
}

function now() {
  return new Date().toISOString();
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
    this.stateDir = path.join(this.root, "state");
    this.backupDir = path.join(this.root, "backup");
  }

  limits() {
    return { maxBytes: this.maxBytes, maxName: MAX_NAME, maxDescription: MAX_DESCRIPTION };
  }

  async init() {
    for (const dir of [this.root, this.presetsDir, this.stateDir, this.backupDir]) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        throw new PresetError(
          "root-unavailable",
          `数据目录不可用：${dir}（${error.code ?? error.message}）。请检查插件配置的 root 或目录权限。`,
          500,
        );
      }
    }
    // 进程被硬杀会留下 writeAtomic 的临时文件；超过 24 小时的就清掉。
    // 只扫自己管理的四个目录（都是平铺目录，不做递归）。
    const deadline = Date.now() - 24 * 60 * 60 * 1000;
    for (const dir of [this.root, this.presetsDir, this.stateDir, this.backupDir]) {
      let names;
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!/\.tmp-[0-9a-f]+$/.test(name)) continue;
        try {
          const stat = await fs.stat(path.join(dir, name));
          if (stat.mtimeMs < deadline) await fs.rm(path.join(dir, name), { force: true });
        } catch {
          // 删不掉就留给下一次 init。
        }
      }
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
      const valid = [];
      const invalid = [];
      for (const item of parsed.presets) {
        if (item && typeof item.id === "string" && typeof item.name === "string") valid.push(item);
        else invalid.push(item);
      }
      if (invalid.length > 0) {
        // 畸形条目（缺 id/name）如果不落备份，下一次写入索引就会把它们永久吞掉。
        // 同一批畸形条目只备份一次。
        const signature = JSON.stringify(invalid);
        this.droppedSignatures = this.droppedSignatures ?? new Set();
        if (!this.droppedSignatures.has(signature)) {
          this.droppedSignatures.add(signature);
          const backup = `${file}.dropped-${Date.now()}`;
          try {
            await fs.writeFile(
              backup,
              `${JSON.stringify({ droppedAt: now(), reason: "缺少 id 或 name 字段", entries: invalid }, null, 2)}\n`,
            );
            this.corruptBackups = [...(this.corruptBackups ?? []), backup];
          } catch (backupError) {
            console.warn(`agents-md-presets: 畸形索引条目备份失败（${backupError.code ?? backupError.message}），这些条目将在下次写入时丢失`);
          }
        }
      }
      return { version: 1, presets: valid };
    } catch {
      // 索引损坏：先把现场备份走再让用户重建；备份失败就报错，绝不静默返回空索引
      // （否则下一次写入会把原文件覆盖掉，预设全丢）。
      const backup = `${file}.corrupt-${Date.now()}`;
      try {
        await fs.rename(file, backup);
      } catch (error) {
        if (error.code === "ENOENT") {
          // 另一个并发读已经抢先把坏文件改名备份了：安全起见从空索引继续。
          return { version: 1, presets: [] };
        }
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
    // 按创建时间倒序：改名只更新 updatedAt，不该把条目顶到最前面。
    // 同一毫秒创建的条目按索引先后倒序，保证新加的排在新加的前面。
    const order = new Map(index.presets.map((meta, at) => [meta.id, at]));
    return index.presets
      .slice()
      .sort((a, b) => {
        const byCreated = String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
        if (byCreated !== 0) return byCreated;
        return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
      })
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

      const targetFile = this.#presetFile(next);
      let body;
      let oldBytes = null;
      if (patch.content !== undefined) {
        body = String(patch.content ?? "");
        // 先留一份旧正文，索引写失败时把它恢复回去，避免「旧元数据指向新正文」的漂移。
        oldBytes = await fs.readFile(targetFile).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (next.missing) delete next.missing;
      } else {
        body = await this.#readPresetFile(meta);
      }
      const bytes = Buffer.byteLength(body, "utf8");
      this.#assertSize(bytes);
      next.bytes = bytes;
      next.sha1 = sha1Of(Buffer.from(body, "utf8"));
      next.updatedAt = now();

      const payload = Buffer.from(body, "utf8");
      await writeAtomic(targetFile, payload);
      index.presets = index.presets.map((item) => (item.id === id ? next : item));
      try {
        await this.#writeIndex(index);
      } catch (error) {
        // 索引没写成功：正文回滚，或者干脆删掉刚写的新文件（原来就没有正文时）。
        if (oldBytes !== null) await writeAtomic(targetFile, oldBytes).catch(() => {});
        else await fs.rm(targetFile, { force: true }).catch(() => {});
        throw error;
      }
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
        description: info.description ?? null,
        source: info.source ?? "workspace",
      },
    };
  }

  /**
   * 判断工作区文件现在是什么：某个预设（内容一致）、偏离了最后应用的预设，
   * 还是用户自己的原文。状态文件只记录「最后应用的是哪个预设」，不做历史。
   */
  #currentInfo(target, index, state) {
    if (!target.sha1) {
      return { preset: null, info: { presetId: null, name: null, description: null, source: "workspace" } };
    }
    // 两个预设内容相同时，「最后应用的」优先归属，不然归属会随索引顺序漂移。
    const appliedId = state && typeof state.presetId === "string" ? state.presetId : null;
    const applied = appliedId ? index.presets.find((item) => item.id === appliedId) ?? null : null;
    if (applied && applied.sha1 === target.sha1) {
      return {
        preset: applied,
        info: {
          presetId: applied.id,
          name: applied.name,
          description: applied.description ?? null,
          source: "preset",
        },
      };
    }
    const matched = index.presets.find((item) => item.sha1 === target.sha1) ?? null;
    if (matched) {
      return {
        preset: matched,
        info: {
          presetId: matched.id,
          name: matched.name,
          description: matched.description ?? null,
          source: "preset",
        },
      };
    }
    if (appliedId) {
      const baseName = applied?.name ?? state.presetName ?? CUSTOM_LABEL;
      if (!applied && state.sha1 && state.sha1 === target.sha1) {
        // 文件内容还停在应用时的样子，但那个预设已经删掉了：老实说它是「预设已删除」，
        // 不要冒充「会话内修改」。
        return {
          preset: null,
          info: { presetId: null, name: state.presetName ?? null, description: null, source: "deleted" },
        };
      }
      // 最后应用过预设，但文件内容已经变了（典型是用「编辑」在编辑器里改过）：
      // 标成「<预设名>（会话内修改）」，让人知道它从哪个预设偏离。
      return {
        preset: null,
        info: {
          presetId: null,
          name: `${baseName}${CUSTOM_SUFFIX}`,
          description: applied?.description ?? null,
          source: "custom",
        },
      };
    }
    return { preset: null, info: { presetId: null, name: null, description: null, source: "workspace" } };
  }

  async #readState(key) {
    const file = path.join(this.stateDir, `${key}.json`);
    let raw;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      // 状态文件只是一份提示，损坏就当没有，不影响文件本身。
      return null;
    }
  }

  async #writeState(key, value) {
    await writeAtomic(path.join(this.stateDir, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`);
  }

  async currentState(workspacePath) {
    const workspace = await this.resolveWorkspace(workspacePath);
    const target = await this.#readTarget(workspace.file);
    const index = await this.#readIndex();
    const state = await this.#readState(workspace.key);
    return this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, state).info);
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

  // ---------------------------------------------------------------- 应用

  /**
   * 把预设写到工作区 AGENTS.md。写入前把原文件留一份最近备份
   * （data/backup/<workspaceKey>.md，只是一个兜底，不提供界面回滚）。
   */
  applyPreset({ workspacePath, presetId }) {
    // workspaceKeyOf(undefined) 会爆 TypeError 变 500；在这里先给语义正确的 400，
    // 与 currentState/readWorkspace 对缺参的处理保持一致。
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new PresetError("workspace-unresolved", "缺少工作区路径");
    }
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

      const state = {
        workspacePath: workspace.path,
        presetId: meta.id,
        presetName: meta.name,
        sha1: presetSha,
        bytes: presetBytes.length,
        appliedAt: now(),
      };

      if (target.sha1 === presetSha) {
        await this.#writeState(workspace.key, state);
        return {
          unchanged: true,
          preset: { ...meta },
          ...this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, state).info),
        };
      }

      if (target.exists) {
        // 覆盖前先留一份最近备份；备份失败就不要动用户文件。
        await writeAtomic(path.join(this.backupDir, `${workspace.key}.md`), target.bytes);
      }

      await writeAtomic(workspace.file, presetBytes);
      await this.#writeState(workspace.key, state);

      target = await this.#readTarget(workspace.file);
      return {
        unchanged: false,
        preset: { ...meta },
        ...this.#describeWorkspace(workspace, target, this.#currentInfo(target, index, state).info),
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

  // ---------------------------------------------------------------- 内部工具

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
