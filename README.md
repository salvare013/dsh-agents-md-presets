# AGENTS.md 预设（@local/dsh-prompt-presets）

给 DSH 加一套「预设 → 工作区 AGENTS.md」的管理与切换能力：

- **设置 → AGENTS.md 预设**：新建、编辑、删除多个具名预设（Markdown 正文，上限 64 KiB）。
- **会话输入框上方**：每个会话选一个预设并「应用」，把它写进该会话工作区的 `AGENTS.md`。
- **快照 + 历史 + 一键回滚**：每次写入前把原文存成内容寻址快照，操作记录追加到 JSONL；任何一条记录都能撤销，撤销本身也可再撤销。

预设存在 DSH 数据目录（`$DSH_HOME/prompt-presets/`，默认 `~/.dsh/prompt-presets/`），跨工作区共享；只有真正「应用」时才碰工作区文件，不往仓库里塞任何东西。

## 数据布局

```
$DSH_HOME/prompt-presets/
├── presets.json              # 预设索引：id / 名称 / 说明 / 字节数 / sha1 / 时间
├── presets/<id>.md           # 预设正文
├── snapshots/<sha1>.md       # 写入前的原文快照（按内容去重）
└── history/<workspaceKey>.jsonl  # 每个工作区一条追加式操作流
```

`workspaceKey` 是工作区绝对路径（统一斜杠、小写）的 sha256 前 16 位，因此移动工作区会得到新的历史线。

历史记录字段：

```json
{
  "id": "h-…",
  "at": "2026-11-09T13:30:00.000Z",
  "action": "apply",
  "workspaceKey": "…",
  "workspacePath": "D:\\code\\demo",
  "presetId": "frontend-1a2b3c",
  "presetName": "前端",
  "beforeSha1": "…",
  "afterSha1": "…",
  "beforeBytes": 1024,
  "afterBytes": 2048,
  "snapshot": "…md",
  "sessionId": "…",
  "revertedEntryId": null
}
```

## 覆盖语义

- 应用 = 用预设正文**改写** `<工作区>/AGENTS.md`（文件不存在则创建），同时按内置加载器的 64 KiB 上限校验。
- 同一工作区同一时刻只有一份 `AGENTS.md`，所以后应用的预设会覆盖前一个；被覆盖前的内容已进快照，可回滚。
- DSH 内置的 `@deepseek-ai/dsh-agent-instructions` 会动态比对磁盘文件，正在跑的会话也能收到「instructions 已更新」的增量上下文，不需要重启。
- 用户级 `$DSH_HOME/AGENTS.md` 与子目录里的 `AGENTS.md` 不在本插件管理范围内。

## 安装

```powershell
dsh plugin add D:\code\dsh-plugins\dsh-prompt-presets
```

或在插件市场/本地 bundle 里安装这个目录。装好后重启 DSH，打开「设置 → AGENTS.md 预设」。

## HTTP 接口（Host 半边）

全部为同源 `POST`，JSON 响应 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`：

| 路径 | 作用 |
| --- | --- |
| `/api/dsh-prompt-presets/state` | 预设清单 + 工作区当前状态 + 历史（`workspacePath` 或 `sessionId` 二选一） |
| `/api/dsh-prompt-presets/preset/read` | 读取预设正文 |
| `/api/dsh-prompt-presets/preset/create` | 新建 |
| `/api/dsh-prompt-presets/preset/update` | 修改名称/说明/正文 |
| `/api/dsh-prompt-presets/preset/delete` | 删除 |
| `/api/dsh-prompt-presets/apply` | 应用预设到工作区 |
| `/api/dsh-prompt-presets/rollback` | 回滚某条历史记录 |

工作区解析顺序：显式 `workspacePath` → `sessions.get(sessionId).header.cwd` → `workingDirectory`。

## 开发

```powershell
npm test          # store / http / client 三组测试，纯 Node，无需浏览器
npm run check     # 语法检查
```

> 注意：DSH 沙箱里 `node --test` 会因管道 spawn 报 `EPERM`，所以测试用 `node <file>` 直接跑。

用隔离的 `dsh web` 实例做端到端验证的流程见 `.web-test/`（不入库）与 `dsh-plugin-web-test` 技能。

## 局限

- 预设正文上限 64 KiB（与 `agent-instructions` 的 `maxBytes` 一致）。
- 「应用」直接写工作区文件，属于有意为之：这样内置加载器的 reconcile 与本地工具链都看到同一份内容。
- 不带工作区的会话（如纯聊天草稿）无法应用，面板会给出提示。
