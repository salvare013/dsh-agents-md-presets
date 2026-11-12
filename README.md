# AGENTS.md 预设（@local/dsh-agents-md-presets）

给 DSH 加一套「预设 → 工作区 AGENTS.md」：维护多套具名预设，每个会话选一套应用到它所在工作区的 `AGENTS.md`。

## 功能

- **设置 → AGENTS.md 预设**：新建、重命名、删除预设。正文用本机编辑器打开修改，保存后点「刷新」重新读取。
- **会话输入框上方**：选一个预设点「应用」，写进该会话工作区的 `AGENTS.md`（没有这个文件就创建）。
- **「当前：…」**：查看当前生效的内容来源与大小，在右侧栏预览正文，或用编辑器打开；也能把当前内容存成新预设。
- 当前文件不是该预设原文（工作区自带或已被改过）时，应用前先确认覆盖。

预设正文上限 64 KiB，名称不可重复。设置与会话面板都不提供内嵌编辑框，正文统一在外部编辑器里改。

## 覆盖与备份

- 应用即改写 `<工作区>/AGENTS.md`；同一工作区只有一份该文件，后应用的预设覆盖前一个。
- 覆盖前会把原文留一份到 `backup/<workspaceKey>.md`，**只保留最近一份**，界面里没有历史与回滚。
- 内置的 `agent-instructions` 会发现文件变化并更新正在跑的会话；用户级 `$DSH_HOME/AGENTS.md` 和子目录里的 `AGENTS.md` 不归本插件管。

## 数据布局

```
$DSH_HOME/agents-md-presets/         # 旧版的 prompt-presets/ 不再读取
├── presets.json                     # 索引：id / 名称 / 说明 / 字节数 / sha1 / 时间
├── presets/<id>.md                  # 预设正文
├── state/<workspaceKey>.json        # 该工作区最后应用了哪个预设
└── backup/<workspaceKey>.md         # 覆盖前的最近一份原文
```

`workspaceKey` 是工作区绝对路径的 sha256 前 16 位（Windows/macOS 折叠大小写，Linux 保留），移动工作区会得到新的状态文件。状态文件只记「最后应用了哪个预设」，用来判断当前内容是否已偏离预设。

## 安装

插件发布在 GitHub：`salvare013/dsh-agents-md-presets`。0.7.0 起包名与仓库名从 `dsh-prompt-presets` 改过来，旧地址会自动重定向。0.7.1 起数据目录也换成 `$DSH_HOME/agents-md-presets/`，旧目录不做迁移。

```powershell
# 最新 main
dsh plugin --profile <name> add https://github.com/salvare013/dsh-agents-md-presets.git

# 锁到某个版本
dsh plugin --profile <name> add "github:salvare013/dsh-agents-md-presets#v1.0.0"
```

`--profile` 必填。自建 profile 没有 web 载体时，先从内置 web 配置派生：

```powershell
dsh --profile myweb --from-default-profile web --dump-config
dsh plugin --profile myweb add "github:salvare013/dsh-agents-md-presets#v1.0.0"
dsh --profile myweb --port 39123 --no-open
```

本地开发用目录安装（改 `lib/` 即时生效）：`dsh plugin --profile <name> add D:\code\dsh-plugins\dsh-agents-md-presets`。`link:` 安装会打印 `peerDependencies` 警告，不影响运行。装好后重启 DSH。

## HTTP 接口

同源 `POST`，响应 `{ ok, value }` 或 `{ ok: false, error: { code, message } }`。所有路由复用内置网关的浏览器身份检查：不可信来源 `403`，可信但未认证 `401`；浏览器打开过带 token 的实例地址后，同源 fetch 自动带 cookie。

| 路径 | 作用 |
| --- | --- |
| `/api/dsh-agents-md-presets/state` | 预设清单 + 工作区当前状态（`workspacePath` 或 `sessionId`） |
| `/api/dsh-agents-md-presets/preset/read` | 读取预设正文 |
| `/api/dsh-agents-md-presets/preset/create` | 新建 |
| `/api/dsh-agents-md-presets/preset/update` | 修改名称/说明/正文 |
| `/api/dsh-agents-md-presets/preset/delete` | 删除 |
| `/api/dsh-agents-md-presets/preset/sync` | 按磁盘文件重算索引 |
| `/api/dsh-agents-md-presets/preset/open` | 用本机编辑器打开预设文件 |
| `/api/dsh-agents-md-presets/apply` | 应用到工作区 |
| `/api/dsh-agents-md-presets/workspace/read` | 读取工作区当前 `AGENTS.md` |
| `/api/dsh-agents-md-presets/workspace/open` | 用本机编辑器打开工作区 `AGENTS.md` |

工作区解析顺序：显式 `workspacePath` → `sessions.get(sessionId).header.cwd` → `sessionPersistence.stat(sessionId)`（不在内存里的老会话）→ `workingDirectory`。

未注册的 `/api/*` 会先被宿主网关拦成 `401`（纯文本），所以调试时 401 不一定来自本插件；本插件的未认证响应是 `unauthorized`，方法不对是 `405`。

## 开发

```powershell
npm test          # store / workspace / editor / host / integration / client 六组，纯 Node，无需浏览器（58 个用例）
npm run check     # 语法检查
```

DSH 沙箱里 `node --test` 会因管道 spawn 报 `EPERM`，测试用 `node <file>` 直接跑。端到端验证用隔离的 `dsh web` 实例（见 `dsh-plugin-web-test` 技能）。

## 局限

- 正文只能在外部编辑器里改（前端没有可用的内嵌编辑框）。
- 覆盖前的原文只留最近一份，没有多版本历史；需要多个版本就把内容另存为预设。
- 不带工作区的会话无法应用；工作区还没有 `AGENTS.md` 时「存为全局预设」不可用。
- 已应用的预设被删除后文件保持不变，面板会标注「预设已删除」。
- 会话跑完后才应用的新内容，要重新进入会话才能看到。
- 「用编辑器打开」优先 VS Code，找不到则用系统默认程序；从 Electron 启动时会摘掉 `ELECTRON_RUN_AS_NODE`，否则 VS Code 会按 Node 运行。
- 验证在隔离 web 实例里完成，没有登录模型账号，所以不覆盖「模型是否照做」——那是内置 `agent-instructions` 的行为。

## 健壮性

- 索引读改写全局串行，同一工作区的写入也串行，并发请求不会互相覆盖。
- 索引损坏或含畸形条目时先备份成 `presets.json.corrupt-*` / `.dropped-*` 再继续，不静默丢数据；连备份都失败就停写报错。
- 覆盖前先写备份，备份失败就不动用户文件；数据目录不可用报 `root-unavailable`。
- 常见错误归一成 400 级：`workspace-unresolved`、`preset-too-large`、`preset-not-found`、`name-taken`。
