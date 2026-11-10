# AGENTS.md 预设（@local/dsh-prompt-presets）

给 DSH 加一套「预设 → 工作区 AGENTS.md」的管理与切换能力：

- **设置 → AGENTS.md 预设**：新建、重命名、删除多个具名预设（Markdown 正文，上限 64 KiB）。删除会先弹出确认框（「取消」/「确认删除」），不会在卡片上直接生效；列表按创建时间从新到旧排列，改名或改说明都不会让条目跳到首行。正文**只用本机编辑器改**：新建时填完名称和说明点「创建并打开编辑器」，插件会用本机 VS Code（没有则退回系统默认程序）打开预设文件，写完保存、点「刷新」即可；卡片上的「重命名 / 说明」只改元数据，点开后**在原卡片里就地编辑**。名称不允许重复（忽略大小写与首尾空格）。
- **会话输入框上方**：每个会话选一个预设并「应用」，把它写进该会话工作区的 `AGENTS.md`；工作区里还没有这个文件时会直接创建。预设下拉用的是浏览器原生 `<select>`，列表随系统滚动，不会顶出屏幕。
- **点「当前：…」看名称与说明**：面板只显示当前生效文件的名称、说明、来源与字节数，不内嵌正文；正文用「在侧栏预览」交给 DSH 内置的右侧栏 markdown 预览打开（`dsh-resource://file/session/<会话>/AGENTS.md`，由 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 渲染）。「编辑」用本机编辑器打开这个文件，保存后回到面板点「刷新」；改的是工作区文件，全局预设不动，也能把当前内容「存为全局预设」（工作区还没有文件时该按钮不可用）。
- **最近一份备份**：每次覆盖前把原文件留一份到数据目录，覆盖属于兜底，不是界面上的回滚功能。

预设存在 DSH 数据目录（`$DSH_HOME/prompt-presets/`，默认 `~/.dsh/prompt-presets/`），跨工作区共享；只有真正「应用」时才碰工作区文件，不往仓库里塞任何东西。

编辑一律走外部编辑器，是因为当前的 DSH 前端没有可用的原生文件编辑框：bundle 里没有 Monaco / CodeMirror，`workspaceFiles` 只有读接口，右侧栏文档预览只读。VS Code 用 `-r -g <file>:1` 复用已打开的窗口，冷启动比新开窗口快。

## 数据布局

```
$DSH_HOME/prompt-presets/
├── presets.json                  # 预设索引：id / 名称 / 说明 / 字节数 / sha1 / 时间
├── presets/<id>.md               # 预设正文
├── state/<workspaceKey>.json     # 该工作区最后应用了哪个预设
└── backup/<workspaceKey>.md      # 覆盖前的最近一份原文（兜底，没有界面入口）
```

`workspaceKey` 是工作区绝对路径的 sha256 前 16 位（统一斜杠；Windows/macOS 上再折叠大小写，Linux 上保留大小写），因此移动工作区会得到新的状态文件。

状态文件字段：

```json
{
  "workspacePath": "D:\\code\\demo",
  "presetId": "frontend-1a2b3c",
  "presetName": "前端",
  "sha1": "…",
  "bytes": 1024,
  "appliedAt": "2026-11-10T09:30:00.000Z"
}
```

它只回答「最后应用的是哪个预设」，用来在文件被手工改过之后把来源标成「<预设名>（会话内修改）」；不做历史、不支持回滚。

## 覆盖语义

- 应用 = 用预设正文**改写** `<工作区>/AGENTS.md`（文件不存在则创建），同时按内置加载器的 64 KiB 上限校验。
- 同一工作区同一时刻只有一份 `AGENTS.md`，所以后应用的预设会覆盖前一个；被覆盖前的内容留在 `backup/<workspaceKey>.md`。
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
| `/api/dsh-prompt-presets/state` | 预设清单 + 工作区当前状态（`workspacePath` 或 `sessionId` 二选一） |
| `/api/dsh-prompt-presets/preset/read` | 读取预设正文 |
| `/api/dsh-prompt-presets/preset/create` | 新建 |
| `/api/dsh-prompt-presets/preset/update` | 修改名称/说明/正文 |
| `/api/dsh-prompt-presets/preset/delete` | 删除 |
| `/api/dsh-prompt-presets/apply` | 应用预设到工作区 |
| `/api/dsh-prompt-presets/preset/sync` | 按磁盘上的预设文件重算索引（外部编辑器改完后用） |
| `/api/dsh-prompt-presets/preset/open` | 用本机编辑器打开预设文件（VS Code 优先，否则系统默认程序） |
| `/api/dsh-prompt-presets/workspace/read` | 读取工作区当前生效的 `AGENTS.md` |
| `/api/dsh-prompt-presets/workspace/open` | 用本机编辑器打开工作区 `AGENTS.md`（文件还不存在也能先打开，保存时创建） |

工作区解析顺序：显式 `workspacePath` → `sessions.get(sessionId).header.cwd` → `workingDirectory`。

未注册的 `/api/*` 路径会先被宿主 API 网关拦成 `401 unauthorized`（纯文本），所以调试时看到 401 不代表路由写错了；已注册路由用错方法才是 `405`。

## 开发

```powershell
npm test          # store / workspace / editor / host / integration / client 六组测试，纯 Node，无需浏览器（当前 48 个用例）
npm run check     # 语法检查
```

> 注意：DSH 沙箱里 `node --test` 会因管道 spawn 报 `EPERM`，所以测试用 `node <file>` 直接跑。

用隔离的 `dsh web` 实例做端到端验证的流程见 `.web-test/`（不入库）与 `dsh-plugin-web-test` 技能。

## 局限

- 预设正文上限 64 KiB（与 `agent-instructions` 的 `maxBytes` 一致）。
- 正文只能在外部编辑器里改：设置页与会话面板都不提供内嵌文本框（收起面板会丢草稿），改完记得点「刷新」。
- 「在侧栏预览」调用 web 端的 `sidebarRight` 服务（`ctx.get("sidebarRight").openResource`）；宿主没提供右侧栏时面板会提示「右侧栏预览不可用」，此时仍可用「编辑」在外部编辑器里看全文。
- 预设名称唯一：新建或改名撞名时返回 `409 name-taken`，界面直接显示已存在的名字。
- 「用编辑器打开」优先找本机 VS Code（`%LOCALAPPDATA%\Programs\Microsoft VS Code`、Insiders、`Program Files`、PATH），找不到就退回系统默认程序。启动参数是 `-r -g <file>:1`（复用最近窗口）；DSH 从 Electron 启动时会继承 `ELECTRON_RUN_AS_NODE=1`，插件在 spawn 前会摘掉它，否则 VS Code 会按 Node 运行。
- 「应用」直接写工作区文件，属于有意为之：这样内置加载器的 reconcile 与本地工具链都看到同一份内容。
- 不带工作区的会话（如纯聊天草稿）无法应用，面板会给出提示。
- 工作区还没有 `AGENTS.md` 时，面板的「存为全局预设」不可用（避免把空内容存成 0 字节预设）；先应用预设或点「编辑」写入内容。
- 覆盖前的原文只保留**最近一份**（`backup/<workspaceKey>.md`），没有历史列表与一键回滚；需要多个版本请把内容另存为预设。
- 会话中途切换预设后，内置加载器会把新内容作为增量指令重新注入；但若该会话已经跑完、只是历史记录，重新进入会话才会看到新内容。
- 本次端到端验证用的是隔离的 web 实例，没有登录模型账号，所以**没有观测到真实模型调用**；「注入后模型是否真的照做」属于 DSH 内置 `agent-instructions` 的行为，本插件只保证把文件写对。

## 健壮性

- 索引是「读改写」操作，进程内全局串行排队；同一工作区的写入也按工作区串行，两个请求同时改不会互相覆盖。
- 索引 JSON 损坏时会先改名成 `presets.json.corrupt-<时间戳>` 再继续；连改名都失败则直接报错停写，不会静默清空。
- 覆盖前先写备份：备份失败就不动用户文件。
