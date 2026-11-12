# AGENTS.md 预设（@local/dsh-agents-md-presets）

给 DSH 加一套「预设 → 工作区 AGENTS.md」的管理与切换能力：

- **设置 → AGENTS.md 预设**：新建、重命名、删除多个具名预设（Markdown 正文，上限 64 KiB）。删除会先弹出确认框（「取消」/「确认删除」），不会在卡片上直接生效；列表按创建时间从新到旧排列，改名或改说明都不会让条目跳到首行。正文**只用本机编辑器改**：新建时填完名称和说明点「创建并打开编辑器」，插件会用本机 VS Code（没有则退回系统默认程序）打开预设文件，写完保存、点「刷新」即可；卡片上的「重命名 / 说明」只改元数据，点开后**在原卡片里就地编辑**。名称不允许重复（忽略大小写与首尾空格）。
- **会话输入框上方**：每个会话选一个预设并「应用」，把它写进该会话工作区的 `AGENTS.md`；工作区里还没有这个文件时会直接创建。预设下拉用的是浏览器原生 `<select>`，列表随系统滚动，不会顶出屏幕。
- **点「当前：…」看名称与说明**：面板只显示当前生效文件的名称、说明、来源与字节数，不内嵌正文；正文用「在侧栏预览」交给 DSH 内置的右侧栏 markdown 预览打开（`dsh-resource://file/session/<会话>/AGENTS.md`，由 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 渲染）。「编辑」用本机编辑器打开这个文件，保存后回到面板点「刷新」；改的是工作区文件，全局预设不动，也能把当前内容「存为全局预设」（工作区还没有文件时该按钮不可用）。**面板打开期间会自动跟进外部改动**：窗口重新获得焦点、标签页切回可见、或每 5 秒静默轮询（仅页面可见时），不点亮按钮、失败不弹错；面板关着时不做任何后台检测，点「应用」时再强制重读一次（判定基于点击瞬间的文件状态）。
- **覆盖确认**：当前文件不是「正在生效的预设原文」时（工作区自带 / 会话内修改 / 预设已删除），点「应用」先弹确认框（「取消」/「确认覆盖」），提示覆盖后界面里无法找回（只有数据目录 `backup/` 下一份最近原文）、需要留档请先复制；同一预设重复应用、工作区还没有文件时不弹。
- **最近一份备份**：每次覆盖前把原文件留一份到数据目录，覆盖属于兜底，不是界面上的回滚功能。

预设存在 DSH 数据目录（`$DSH_HOME/prompt-presets/`，默认 `~/.dsh/prompt-presets/`；目录名沿用插件旧名，改名后保持不变，已有预设不会丢），跨工作区共享；只有真正「应用」时才碰工作区文件，不往仓库里塞任何东西。

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

插件已发布在 GitHub：`salvare013/dsh-agents-md-presets`（公开仓库，`v0.x.x` tag 对应每个版本）。0.7.0 起包名与仓库名从 `dsh-prompt-presets` 改成现在这个，GitHub 旧地址会自动重定向；数据目录 `$DSH_HOME/prompt-presets/` 与本地开发目录名保持不变，已有预设不受影响。插件命令必须带 `--profile`（不带的报错是 `error required option '--profile <name>' not specified`）。

```powershell
# 从 GitHub 安装最新 main（推荐；pnpm 会把依赖记成 github:salvare013/dsh-agents-md-presets）
dsh plugin --profile <name> add https://github.com/salvare013/dsh-agents-md-presets.git

# 或锁到某个版本（tag 名即版本）
dsh plugin --profile <name> add "github:salvare013/dsh-agents-md-presets#v0.7.0"
```

自己新建的 profile 没有 web 载体时，先从内置 web 配置派生一份再装：

```powershell
dsh --profile myweb --from-default-profile web --dump-config
dsh plugin --profile myweb add "github:salvare013/dsh-agents-md-presets#v0.7.0"
dsh --profile myweb --port 39123 --no-open
```

本地开发仍可用目录安装（改 `lib/` 即时生效）：`dsh plugin --profile <name> add D:\code\dsh-plugins\dsh-prompt-presets`（这个目录名仍是插件旧名，没跟着改）。

用 `pnpm` 安装本地目录（`link:` 协议）时会打印 `peerDependencies` 警告（我们的 peer 依赖全部 optional），不影响安装与运行。装好后重启 DSH，打开「设置 → AGENTS.md 预设」。

## HTTP 接口（Host 半边）

全部为同源 `POST`，JSON 响应 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`。**所有路由都要求浏览器身份**：与内置 `/api` 网关一致，每次请求先过 `connection.admit(request)`——非可信来源（跨站 origin、异域 Host）返回 `403 forbidden`；可信但未认证（没有 HttpOnly 会话 cookie，比如 curl 直调）返回 `401 unauthorized`。浏览器访问过带 token 的实例地址后，同源 fetch 自动带上 cookie，无需额外处理。

| 路径 | 作用 |
| --- | --- |
| `/api/dsh-agents-md-presets/state` | 预设清单 + 工作区当前状态（`workspacePath` 或 `sessionId` 二选一） |
| `/api/dsh-agents-md-presets/preset/read` | 读取预设正文 |
| `/api/dsh-agents-md-presets/preset/create` | 新建 |
| `/api/dsh-agents-md-presets/preset/update` | 修改名称/说明/正文 |
| `/api/dsh-agents-md-presets/preset/delete` | 删除 |
| `/api/dsh-agents-md-presets/apply` | 应用预设到工作区 |
| `/api/dsh-agents-md-presets/preset/sync` | 按磁盘上的预设文件重算索引（外部编辑器改完后用） |
| `/api/dsh-agents-md-presets/preset/open` | 用本机编辑器打开预设文件（VS Code 优先，否则系统默认程序） |
| `/api/dsh-agents-md-presets/workspace/read` | 读取工作区当前生效的 `AGENTS.md` |
| `/api/dsh-agents-md-presets/workspace/open` | 用本机编辑器打开工作区 `AGENTS.md`（文件还不存在也能先打开，保存时创建） |

工作区解析顺序：显式 `workspacePath` → `sessions.get(sessionId).header.cwd` → `sessionPersistence.stat(sessionId)` 的持久化 header（老会话不在内存里时用）→ `workingDirectory`。

未注册的 `/api/*` 路径会先被宿主 API 网关拦成 `401`（纯文本，内容是「dsh web authentication required; reopen the URL printed by dsh web.」），所以调试时看到 401 不一定是本插件；本插件已注册路由返回的 `401` 是 `unauthorized`，`403` 是 `forbidden`，用错方法才是 `405`。

## 开发

```powershell
npm test          # store / workspace / editor / host / integration / client 六组测试，纯 Node，无需浏览器（当前 58 个用例）
npm run check     # 语法检查
```

> 注意：DSH 沙箱里 `node --test` 会因管道 spawn 报 `EPERM`，所以测试用 `node <file>` 直接跑。

用隔离的 `dsh web` 实例做端到端验证的流程见 `.web-test/`（不入库）与 `dsh-plugin-web-test` 技能。

## 局限

- 预设正文上限 64 KiB（与 `agent-instructions` 的 `maxBytes` 一致）。名称/说明的长度按 JS `length`（UTF-16 code units，含 emoji 的字符串会数得偏多）计算，正文按 UTF-8 字节计算。
- 正文只能在外部编辑器里改：设置页与会话面板都不提供内嵌文本框（收起面板会丢草稿），改完记得点「刷新」。
- 「在侧栏预览」调用 web 端的 `sidebarRight` 服务（`ctx.get("sidebarRight").openResource`）；宿主没提供右侧栏时面板会提示「右侧栏预览不可用」，此时仍可用「编辑」在外部编辑器里看全文。
- 预设名称唯一：新建或改名撞名时返回 `409 name-taken`，界面直接显示已存在的名字。
- 「用编辑器打开」优先找本机 VS Code（`%LOCALAPPDATA%\Programs\Microsoft VS Code`、Insiders、`Program Files`、PATH），找不到就退回系统默认程序。启动参数是 `-r -g <file>:1`（复用最近窗口）；DSH 从 Electron 启动时会继承 `ELECTRON_RUN_AS_NODE=1`，插件在 spawn 前会摘掉它，否则 VS Code 会按 Node 运行。
- 「应用」直接写工作区文件，属于有意为之：这样内置加载器的 reconcile 与本地工具链都看到同一份内容。
- 不带工作区的会话（如纯聊天草稿）无法应用，面板会给出提示。
- 工作区还没有 `AGENTS.md` 时，面板的「存为全局预设」不可用（避免把空内容存成 0 字节预设）；先应用预设或点「编辑」写入内容。
- 覆盖前的原文只保留**最近一份**（`backup/<workspaceKey>.md`），没有历史列表与一键回滚；需要多个版本请把内容另存为预设。
- 已应用的预设被删除后，工作区文件保持不变，面板会标成「<预设名>（预设已删除）」；此时把文件「存为全局预设」即可重建同名条目。
- 会话中途切换预设后，内置加载器会把新内容作为增量指令重新注入；但若该会话已经跑完、只是历史记录，重新进入会话才会看到新内容。
- 本次端到端验证用的是隔离的 web 实例，没有登录模型账号，所以**没有观测到真实模型调用**；「注入后模型是否真的照做」属于 DSH 内置 `agent-instructions` 的行为，本插件只保证把文件写对。

## 健壮性

- 索引是「读改写」操作，进程内全局串行排队；同一工作区的写入也按工作区串行，两个请求同时改不会互相覆盖。
- 索引 JSON 损坏时会先改名成 `presets.json.corrupt-<时间戳>` 再继续；连改名都失败则直接报错停写，不会静默清空。索引里缺 id/名称的畸形条目会被剔除并另存 `presets.json.dropped-<时间戳>` 备份，不会无声丢数据。
- 覆盖前先写备份：备份失败就不动用户文件。
- 数据目录不可用时 `init()` 报 `root-unavailable`（带目录路径），而不是裸的文件系统错误；init 时会顺带清理 24 小时以前的 `.tmp-` 写临时文件。
- 「应用」缺工作区参数、预设正文被外部改大等错误都会归一成 400 级的 `PresetError`（`workspace-unresolved` / `preset-too-large` / `preset-not-found`），不会 500。
- 「修改预设」写完正文但写索引失败时，会先把正文回滚成旧内容再抛错，避免「旧索引指向新正文」的漂移窗口。
