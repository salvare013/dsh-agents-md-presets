# AGENTS.md 预设（@local/dsh-prompt-presets）

给 DSH 加一套「预设 → 工作区 AGENTS.md」的管理与切换能力：

- **设置 → AGENTS.md 预设**：新建、重命名、删除多个具名预设（Markdown 正文，上限 64 KiB）。正文**只用本机编辑器改**：新建时填完名称和说明点「创建并打开编辑器」，插件会用本机 VS Code（没有则退回系统默认程序）打开预设文件，写完保存、点「刷新」即可；卡片上的「重命名 / 说明」只改元数据。名称不允许重复（忽略大小写与首尾空格）。
- **会话输入框上方**：每个会话选一个预设并「应用」，把它写进该会话工作区的 `AGENTS.md`。
- **点「当前：…」预览与编辑**：预览的是工作区里**实际生效**的 `AGENTS.md`；点「编辑」用本机编辑器打开这个文件，保存后回到面板点「刷新」看预览。改的是工作区文件，全局预设不动；也能把当前内容「存为全局预设」。
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

`workspaceKey` 是工作区绝对路径的 sha256 前 16 位（统一斜杠；Windows/macOS 上再折叠大小写，Linux 上保留大小写），因此移动工作区会得到新的历史线。

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
- 用「编辑」在外部编辑器里改完工作区文件后，面板点「刷新」会把当前内容标成「<预设名>（会话内修改）」，提醒它已经偏离了预设。
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
| `/api/dsh-prompt-presets/preset/sync` | 按磁盘上的预设文件重算索引（外部编辑器改完后用） |
| `/api/dsh-prompt-presets/preset/open` | 用本机编辑器打开预设文件（VS Code 优先，否则系统默认程序） |
| `/api/dsh-prompt-presets/workspace/read` | 读取工作区当前生效的 `AGENTS.md` |
| `/api/dsh-prompt-presets/workspace/write` | 直接写入工作区 `AGENTS.md`（会话内编辑；`presetId` 为空） |
| `/api/dsh-prompt-presets/workspace/open` | 用本机编辑器打开工作区 `AGENTS.md`（文件还不存在也能先打开，保存时创建） |

工作区解析顺序：显式 `workspacePath` → `sessions.get(sessionId).header.cwd` → `workingDirectory`。

未注册的 `/api/*` 路径会先被宿主 API 网关拦成 `401 unauthorized`（纯文本），所以调试时看到 401 不代表路由写错了；已注册路由用错方法才是 `405`。

## 开发

```powershell
npm test          # store / workspace / editor / host / integration / client 六组测试，纯 Node，无需浏览器（当前 52 个用例）
npm run check     # 语法检查
```

> 注意：DSH 沙箱里 `node --test` 会因管道 spawn 报 `EPERM`，所以测试用 `node <file>` 直接跑。

用隔离的 `dsh web` 实例做端到端验证的流程见 `.web-test/`（不入库）与 `dsh-plugin-web-test` 技能。

## 局限

- 预设正文上限 64 KiB（与 `agent-instructions` 的 `maxBytes` 一致）。
- 正文只能在外部编辑器里改：设置页与会话面板都不再提供内嵌文本框（收起面板会丢草稿），改完记得点「刷新」。
- 预设名称唯一：新建或改名撞名时返回 `409 name-taken`，界面直接显示已存在的名字。
- 「用编辑器打开」优先找本机 VS Code（`%LOCALAPPDATA%\Programs\Microsoft VS Code`、Insiders、`Program Files`、PATH），找不到就退回系统默认程序；DSH 从 Electron 启动时会继承 `ELECTRON_RUN_AS_NODE=1`，插件在 spawn 前会摘掉它，否则 VS Code 会按 Node 运行并报 `bad option: -n`。
- 「应用」直接写工作区文件，属于有意为之：这样内置加载器的 reconcile 与本地工具链都看到同一份内容。
- 不带工作区的会话（如纯聊天草稿）无法应用，面板会给出提示。
- 同一工作区同一时刻只可能有一个预设生效——文件只有一份；换预设就是覆盖，历史里的每条记录都能回滚。
- 回滚恢复的是「那一步之前的字节」，不会合并后来的编辑：如果应用后你手改过 AGENTS.md，回滚会把那些手改一并覆盖（快照仍在，可再回滚回来）。
- 会话中途切换预设后，内置加载器会把新内容作为增量指令重新注入；但若该会话已经跑完、只是历史记录，重新进入会话才会看到新内容。
- 本次端到端验证用的是隔离的 web 实例，没有登录模型账号，所以**没有观测到真实模型调用**；「注入后模型是否真的照做」属于 DSH 内置 `agent-instructions` 的行为，本插件只保证把文件写对。

## 健壮性

- 索引与历史都是「读改写」操作，进程内按工作区 / 全局两条串行队列排队，两个请求同时改不会互相覆盖。
- 索引 JSON 损坏时会先改名成 `presets.json.corrupt-<时间戳>` 再继续；连改名都失败则直接报错停写，不会静默清空。
