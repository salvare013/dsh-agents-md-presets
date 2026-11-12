window.__ModuleLoader__.load({
  id: "@local/dsh-agents-md-presets",
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require("react");
    const { createElement: h, useCallback, useEffect, useRef, useState } = react;

    const API = "/api/dsh-agents-md-presets";
    const ENTRY_ID = "agents-md-presets";
    const DOCK_ID = "agents-md-presets.session";
    const inject = ["slots"];

    // 设置页增删改预设后，通知同一页面里的会话面板立刻重新读取，省掉手动点刷新。
    const presetListeners = new Set();
    function onPresetsChanged(listener) {
      presetListeners.add(listener);
      return () => presetListeners.delete(listener);
    }
    function notifyPresetsChanged() {
      for (const listener of [...presetListeners]) {
        try {
          listener();
        } catch {
          /* 单个监听者出错不影响其他面板 */
        }
      }
    }

    const T = {
      settingsLabel: "AGENTS.md 预设",
      title: "AGENTS.md 预设",
      intro:
        "预设保存在 DSH 数据目录中，任意工作区都能使用。会话面板里选中预设并应用后，会改写该会话工作区的 AGENTS.md；应用前会把原文留一份到数据目录的 backup/ 下，作为兜底备份。",
      create: "新建预设",
      edit: "编辑",
      remove: "删除",
      cancel: "取消",
      save: "保存",
      saving: "保存中…",
      empty: "还没有预设。新建一个，然后在会话面板里应用它。",
      namePlaceholder: "预设名称，例如：代码审查",
      descriptionPlaceholder: "可选说明，例如：只看 diff、必须给出测试建议",
      createAndOpen: "创建并打开编辑器",
      createdAndOpened: "已创建并用 VS Code 打开正文，写完保存后点「刷新」重新读取。",
      createdAndOpenedSystem: "已创建并用系统默认程序打开正文，写完保存后点「刷新」重新读取。",
      createHint: "先填名称和说明；创建后会直接用编辑器打开正文文件，写完保存，再点「刷新」。",
      editMeta: "重命名 / 改说明",
      rename: "重命名 / 说明",
      metaHint: "这里只改名称和说明；正文请在编辑器里改，保存后点「刷新」。",
      bytes: "字节",
      overLimit: "超过内置加载器上限，保存会被拒绝",
      nameRequired: "请填写预设名称",
      dataDir: "数据目录",
      dataDirHint: "（只读：这里是插件自己的数据，可用文本编辑器直接改文件，改完点「刷新」重新读取。）",
      confirmDelete: "确认删除",
      deleteTitle: "删除预设",
      deleteHint: (name) => `将删除「${name}」和它的正文文件，无法撤销。`,
      dockLabel: "AGENTS.md 预设",
      apply: "应用",
      applying: "应用中…",
      refresh: "刷新",
      noPreset: "还没有预设，先到「设置 → AGENTS.md 预设」里创建。",
      currentPreset: (name) => `当前：${name}`,
      currentCustom: "当前：工作区自带内容（非预设）",
      currentMissing: "当前：工作区没有 AGENTS.md",
      noWorkspace: "当前会话没有可用工作区，无法应用预设。",
      applied: (name) => `已应用「${name}」到 AGENTS.md`,
      unchanged: "文件已经是这个预设的内容，无需重复写入",
      overwriteTitle: (name) => `覆盖工作区 AGENTS.md 为「${name}」？`,
      overwriteBody: "当前文件不是这个预设的内容（工作区自带或会话内修改）。覆盖后界面里无法找回；数据目录 backup/ 下只保留一份最近原文，需要留档请先自行复制。",
      overwriteConfirm: "确认覆盖",
      overwriteCancel: "取消",
      openExternal: "用编辑器打开",
      openedWithVscode: "已用 VS Code 打开。改完点「刷新」重新读取。",
      openedWithSystem: "已用系统默认程序打开。改完点「刷新」重新读取。",
      synced: "已重新读取预设文件",
      missingFile: "正文文件已丢失，请删除后重建",
      previewButton: "预览 / 编辑",
      previewTitle: "当前生效的 AGENTS.md",
      previewClose: "收起",
      previewOpen: "在侧栏预览",
      previewOpened: "已在右侧栏打开内置预览",
      previewOpenHint: "正文不在会话里展开：点「在侧栏预览」会用 DSH 内置的 markdown 预览打开工作区的 AGENTS.md。",
      previewUnavailable: "右侧栏预览不可用：当前页面没有提供 sidebarRight 服务，请刷新后重试。",
      previewMissing: "工作区还没有 AGENTS.md，先应用预设或用编辑器写入后再预览。",
      descriptionLabel: "说明",
      noDescription: "（没有填写说明）",
      editWorkspace: "编辑",
      openedWorkspaceVscode: "已用 VS Code 打开工作区的 AGENTS.md，保存后点「刷新」看预览。",
      openedWorkspaceSystem: "已用系统默认程序打开工作区的 AGENTS.md，保存后点「刷新」看预览。",
      saveAsGlobal: "存为全局预设",
      globalNameLabel: "预设名称",
      globalNamePlaceholder: "例如：代码审查",
      globalDescPlaceholder: "可选说明，只写进全局预设",
      saveGlobal: "保存为预设",
      savedAsGlobal: (name) => `已存为全局预设「${name}」`,
      saveAsNeedsFile: "工作区还没有 AGENTS.md，先应用一个预设或点「编辑」写入内容，再存为全局预设。",
      sourcePreset: (name) => `内容来自全局预设「${name}」`,
      sourceCustom: (name) => `内容是会话内自定义（${name}），尚未存为全局预设`,
      sourceWorkspace: "内容是工作区自带原文，不是预设",
      sourceMissingFile: "工作区还没有 AGENTS.md；应用预设会新建这个文件，也可以点「编辑」写一份。",
      fileMissing: "文件不存在",
      sourceDeleted: "应用过的预设已删除，文件还停在应用时的内容",
      currentDeleted: "当前：预设已删除",
      currentDeletedNamed: (name) => `当前：${name}（预设已删除）`,
      nameRequiredForGlobal: "请给全局预设起个名字",
    };

    const S = {
      page: { display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 24px" },
      row: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        minWidth: 0,
        maxWidth: "100%",
      },
      card: {
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
        borderRadius: "var(--dsw-radius-lg, 12px)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      },
      cardHead: { display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between" },
      cardHeadMain: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: "1 1 280px" },
      cardHeadActions: { display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" },
      name: { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" },
      meta: {
        fontSize: 11,
        color: "var(--dsw-alias-label-secondary, #666)",
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        wordBreak: "break-all",
      },
      hint: {
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--dsw-alias-label-secondary, #666)",
        minWidth: 0,
        maxWidth: "100%",
        overflowWrap: "anywhere",
      },
      label: { fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" },
      input: {
        width: "100%",
        boxSizing: "border-box",
        padding: "7px 9px",
        fontSize: 13,
        color: "var(--dsw-alias-label-primary, inherit)",
        background: "var(--dsw-alias-bg-l1, transparent)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        outline: "none",
      },
      textarea: {
        width: "100%",
        boxSizing: "border-box",
        minHeight: 160,
        maxHeight: "42vh",
        padding: "9px 10px",
        fontSize: 12.5,
        lineHeight: 1.6,
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        color: "var(--dsw-alias-label-primary, inherit)",
        background: "var(--dsw-alias-bg-l1, transparent)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        resize: "vertical",
        outline: "none",
      },
      button: {
        padding: "5px 12px",
        fontSize: 12,
        cursor: "pointer",
        color: "var(--dsw-alias-label-primary, inherit)",
        background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.1))",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        whiteSpace: "nowrap",
      },
      primary: {
        padding: "5px 12px",
        fontSize: 12,
        cursor: "pointer",
        color: "#fff",
        background: "var(--dsw-alias-brand-primary, #4d6bfe)",
        border: "1px solid transparent",
        borderRadius: "var(--dsw-radius-md, 8px)",
        whiteSpace: "nowrap",
      },
      danger: {
        padding: "5px 12px",
        fontSize: 12,
        cursor: "pointer",
        color: "var(--dsw-alias-label-primary, inherit)",
        background: "var(--dsw-alias-fill-danger, rgba(220,38,38,.12))",
        border: "1px solid var(--dsw-alias-border-danger, rgba(220,38,38,.45))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        whiteSpace: "nowrap",
      },
      overlay: {
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.32)",
      },
      dialog: {
        width: "min(360px, calc(100vw - 48px))",
        boxSizing: "border-box",
        padding: "16px 18px",
        borderRadius: "var(--dsw-radius-lg, 12px)",
        background: "var(--dsw-alias-bg-primary, #fff)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.24)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      },
      ghost: {
        padding: "3px 9px",
        fontSize: 11.5,
        cursor: "pointer",
        color: "var(--dsw-alias-label-secondary, #666)",
        background: "transparent",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        whiteSpace: "nowrap",
      },
      disabled: { opacity: 0.55, cursor: "not-allowed" },
      error: { fontSize: 12, color: "var(--dsw-alias-label-danger, #d4380d)" },
      ok: { fontSize: 12, color: "var(--dsw-alias-label-success, #389e0d)" },
      select: {
        padding: "4px 8px",
        fontSize: 12,
        maxWidth: 220,
        color: "var(--dsw-alias-label-primary, inherit)",
        background: "var(--dsw-alias-bg-l1, transparent)",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))",
        borderRadius: "var(--dsw-radius-md, 8px)",
      },
      dock: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 12px 10px",
        fontSize: 12,
        color: "var(--dsw-alias-label-secondary, #666)",
        // 跟随会话列（拖分割线变窄）一起伸缩：占满槽位宽度，
        // 内容在任何宽度下都通过 flexWrap 收行，不越过输入框。
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        // 整体容器：圆角边框 + 主题浅底，让插件在会话里有一块自己的面板。
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))",
        borderRadius: "var(--dsw-radius-lg, 12px)",
        background: "var(--dsw-alias-bg-l1, rgba(127,127,127,.06))",
      },
      panel: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        border: "1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.04))",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
      },
      currentName: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" },
    };

    async function api(name, body) {
      const response = await fetch(`${API}/${name}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!payload || typeof payload !== "object") {
        throw new Error(`接口异常（HTTP ${response.status}）`);
      }
      if (!payload.ok) {
        throw new Error(payload.error?.message || `请求失败（HTTP ${response.status}）`);
      }
      return payload.value;
    }

    function formatBytes(bytes) {
      const value = Number(bytes) || 0;
      return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
    }

    function formatTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    }

    function useTask() {
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");
      const running = useRef(0);
      const run = useCallback(async (task, successMessage) => {
        // 同一组件里并发点两次（刷新 + 自动刷新）时，只让最后一次的结果落地。
        const ticket = (running.current += 1);
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const value = await task();
          if (ticket === running.current && successMessage) setNotice(successMessage);
          return value;
        } catch (cause) {
          if (ticket === running.current) setError(cause?.message || String(cause));
          return undefined;
        } finally {
          if (ticket === running.current) setBusy(false);
        }
      }, []);
      return { busy, error, notice, run, setError, setNotice };
    }

    function Notice(props) {
      if (props.error) return h("div", { style: S.error }, props.error);
      if (props.notice) return h("div", { style: S.ok }, props.notice);
      return null;
    }

    // ------------------------------------------------------------------ 设置页

    function SettingsSection(_props) {
      const [state, setState] = useState(null);
      const [draft, setDraft] = useState(null);
      const [pendingDelete, setPendingDelete] = useState(null);
      const task = useTask();

      const reload = useCallback(async () => {
        const value = await api("state", {});
        setState(value);
      }, []);

      useEffect(() => {
        // 打开设置页的瞬间先 sync 一次：其他进程/编辑器改过预设文件也能立刻反映出来，
        // 不用等用户先点一下「刷新」。
        task.run(async () => {
          await api("preset/sync");
          await reload();
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      // 外部编辑器改过正文后，先把索引对齐再读列表，界面上才会显示新的字节数。
      const refresh = () => {
        task.run(async () => {
          await api("preset/sync");
          await reload();
        }, T.synced);
      };

      const openExternal = (preset) => {
        setPendingDelete(null);
        task.run(async () => {
          const value = await api("preset/open", { id: preset.id });
          task.setNotice(value.openedWith === "vscode" ? T.openedWithVscode : T.openedWithSystem);
        });
      };

      const presets = state?.presets ?? [];
      const limits = state?.limits ?? { maxBytes: 65536 };

      const startCreate = () => {
        setPendingDelete(null);
        setDraft({ mode: "create", id: "", name: "", description: "" });
      };

      // 只改元数据；正文一律交给编辑器。
      const startMeta = (preset) => {
        setPendingDelete(null);
        setDraft({ mode: "meta", id: preset.id, name: preset.name, description: preset.description || "" });
      };

      const save = () => {
        if (!draft) return;
        if (!draft.name.trim()) {
          task.setError(T.nameRequired);
          return;
        }
        task.run(async () => {
          if (draft.mode === "create") {
            const value = await api("preset/create", {
              name: draft.name,
              description: draft.description,
              content: "",
            });
            setDraft(null);
            await reload();
            notifyPresetsChanged();
            const opened = await api("preset/open", { id: value.preset.id });
            task.setNotice(opened.openedWith === "vscode" ? T.createdAndOpened : T.createdAndOpenedSystem);
          } else {
            await api("preset/update", { id: draft.id, name: draft.name, description: draft.description });
            setDraft(null);
            await reload();
            notifyPresetsChanged();
            task.setNotice(T.saved);
          }
        });
      };

      // 删除前先弹确认框：点「删除」只打开对话框，真正删除要再点「确认删除」。
      const remove = (preset) => setPendingDelete({ id: preset.id, name: preset.name });

      const confirmRemove = () => {
        if (!pendingDelete) return;
        const id = pendingDelete.id;
        setPendingDelete(null);
        task.run(async () => {
          await api("preset/delete", { id });
          await reload();
          notifyPresetsChanged();
          task.setNotice("预设已删除");
        });
      };

      const header = h(
        "div",
        { style: S.cardHead },
        h("div", { style: S.cardHeadMain },
          h("div", { style: S.name }, T.title),
          state?.root ? h("div", { style: S.meta }, `${T.dataDir}：${state.root}`) : null,
          state?.root ? h("div", { style: S.hint }, T.dataDirHint) : null,
        ),
        h("div", { style: S.cardHeadActions },
          h("button", { type: "button", style: task.busy ? { ...S.button, ...S.disabled } : S.button, disabled: task.busy, onClick: refresh }, T.refresh),
          h("button", { type: "button", style: S.primary, onClick: startCreate }, T.create),
        ),
      );

      if (!state) {
        return h(
          "div",
          { style: S.page },
          header,
          h(Notice, { error: task.error }),
          task.error
            ? h(
                "div",
                { style: S.row },
                h("span", { style: S.hint }, "读取失败，可重试。"),
                h("button", { type: "button", style: S.button, onClick: refresh }, T.refresh),
              )
            : h("div", { style: S.hint }, "读取中…"),
        );
      }

      return h(
        "div",
        { style: S.page },
        header,
        h("div", { style: S.hint }, T.intro),
        h(Notice, { error: task.error, notice: task.notice }),

        draft && draft.mode === "create"
          ? h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.row },
                h("span", { style: S.label }, T.create),
              ),
              h("input", {
                style: S.input,
                placeholder: T.namePlaceholder,
                value: draft.name,
                maxLength: limits.maxName ?? 80,
                onChange: (event) => setDraft({ ...draft, name: event.target.value }),
              }),
              h("input", {
                style: S.input,
                placeholder: T.descriptionPlaceholder,
                value: draft.description,
                maxLength: limits.maxDescription ?? 500,
                onChange: (event) => setDraft({ ...draft, description: event.target.value }),
              }),
              h("div", { style: S.hint }, draft.mode === "create" ? T.createHint : T.metaHint),
              h(
                "div",
                { style: S.row },
                h(
                  "button",
                  {
                    type: "button",
                    style: task.busy ? { ...S.primary, ...S.disabled } : S.primary,
                    disabled: task.busy,
                    onClick: save,
                  },
                  task.busy ? T.saving : draft.mode === "create" ? T.createAndOpen : T.save,
                ),
                h("button", { type: "button", style: S.button, onClick: () => setDraft(null) }, T.cancel),
              ),
            )
          : null,

        presets.length === 0 && !draft
          ? h("div", { style: S.card }, h("div", { style: S.hint }, T.empty))
          : null,

        ...presets.map((preset) => {
          const editing = draft?.mode === "meta" && draft.id === preset.id;
          return h(
            "div",
            {
              key: preset.id,
              style: S.card,
            },
            editing
              ? h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: 8 } },
                  h("input", {
                    style: S.input,
                    placeholder: T.namePlaceholder,
                    value: draft.name,
                    maxLength: limits.maxName ?? 80,
                    autoFocus: true,
                    onChange: (event) => setDraft({ ...draft, name: event.target.value }),
                  }),
                  h("input", {
                    style: S.input,
                    placeholder: T.descriptionPlaceholder,
                    value: draft.description,
                    maxLength: limits.maxDescription ?? 500,
                    onChange: (event) => setDraft({ ...draft, description: event.target.value }),
                  }),
                  h("div", { style: S.hint }, T.metaHint),
                  h(
                    "div",
                    { style: S.row },
                    h(
                      "button",
                      {
                        type: "button",
                        style: task.busy ? { ...S.primary, ...S.disabled } : S.primary,
                        disabled: task.busy,
                        onClick: save,
                      },
                      task.busy ? T.saving : T.save,
                    ),
                    h("button", { type: "button", style: S.button, onClick: () => setDraft(null) }, T.cancel),
                  ),
                )
              : h(
                  "div",
                  { style: S.cardHead },
                  h(
                    "div",
                    { style: S.cardHeadMain },
                    h("div", { style: S.name }, preset.name),
                    preset.description ? h("div", { style: S.hint }, preset.description) : null,
                    h("div", { style: S.meta }, `${formatBytes(preset.bytes)} · ${formatTime(preset.updatedAt)} · ${preset.id}`),
                  ),
                  h(
                    "div",
                    { style: S.cardHeadActions },
                    h(
                      "button",
                      {
                        type: "button",
                        style: task.busy ? { ...S.button, ...S.disabled } : S.button,
                        disabled: task.busy,
                        title: "用本机编辑器打开这个预设的正文（优先 VS Code）",
                        onClick: () => openExternal(preset),
                      },
                      T.openExternal,
                    ),
                    h("button", { type: "button", style: S.button, onClick: () => startMeta(preset) }, T.rename),
                    h(
                      "button",
                      { type: "button", style: S.danger, onClick: () => remove(preset) },
                      T.remove,
                    ),
                  ),
                ),
            preset.missing ? h("div", { style: S.error }, T.missingFile) : null,
          );
        }),

        pendingDelete
          ? h(
              "div",
              {
                style: S.overlay,
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget) setPendingDelete(null);
                },
              },
              h(
                "div",
                { style: S.dialog, role: "dialog", "aria-modal": "true", "aria-label": T.deleteTitle },
                h("div", { style: S.name }, T.deleteTitle),
                h("div", { style: S.hint }, T.deleteHint(pendingDelete.name)),
                h(
                  "div",
                  { style: { ...S.row, justifyContent: "flex-end" } },
                  h("button", { type: "button", style: S.button, onClick: () => setPendingDelete(null) }, T.cancel),
                  h(
                    "button",
                    {
                      type: "button",
                      style: task.busy ? { ...S.danger, ...S.disabled } : S.danger,
                      disabled: task.busy,
                      onClick: confirmRemove,
                    },
                    T.confirmDelete,
                  ),
                ),
              ),
            )
          : null,
      );
    }

    // ------------------------------------------------------------------ 会话预设条

    function SessionPresetBar(props) {
      const sessionId = props?.sessionId;
      const ctx = props?.ctx;
      const [state, setState] = useState(null);
      const [selected, setSelected] = useState("");
      const [panel, setPanel] = useState(null);
      const [globalName, setGlobalName] = useState("");
      const [globalDesc, setGlobalDesc] = useState("");
      const [confirmApply, setConfirmApply] = useState(null);
      const task = useTask();
      // 切会话或连续刷新时，晚到的旧响应不能覆盖新会话的状态。
      const generation = useRef(0);

      // 桌面端输入框卡片在会话列内居中，而 dock 的槽位带可能比卡片宽
      // （web 上两者同宽）。把 dock 对齐到卡片矩形，随窗口/分割线变化重算；
      // 找不到卡片时退回跟随槽位带本身的宽度。
      const dockRef = useRef(null);
      const [align, setAlign] = useState(null);
      useEffect(() => {
        const el = dockRef.current;
        if (!el) return undefined;
        const findCard = () => {
          const input = document.querySelector("[data-placeholder]");
          let node = input ? input.parentElement : null;
          for (let i = 0; node && i < 8; i += 1, node = node.parentElement) {
            const radius = Number.parseFloat(getComputedStyle(node).borderRadius);
            if (radius >= 12 && node.getBoundingClientRect().width > 200) return node;
          }
          return null;
        };
        const measure = () => {
          // 槽位的直接包裹层可能是 display:contents（矩形为 0），
          // 沿父链找到真正提供宽度的容器再算偏移。
          let band = el.parentElement;
          while (band && getComputedStyle(band).display === "contents") band = band.parentElement;
          if (!band) {
            setAlign(null);
            return;
          }
          const card = findCard();
          if (!card) {
            setAlign(null);
            return;
          }
          const cardRect = card.getBoundingClientRect();
          const bandRect = band.getBoundingClientRect();
          const left = Math.round((cardRect.x - bandRect.x) * 10) / 10;
          const width = Math.round(cardRect.width * 10) / 10;
          setAlign((previous) => {
            if (previous && Math.abs(previous.left - left) < 2 && Math.abs(previous.width - width) < 2) {
              return previous;
            }
            return { left, width };
          });
        };
        measure();
        window.addEventListener("resize", measure);
        // 逐帧对齐（rAF）：侧栏开合/分割线拖动这类重排没有可靠的观察信号
        // （body 宽度不变、卡片在动画中途被量到），定时兜底又会有肉眼可见的
        // 「弹回」。改为每帧重测一次 —— 一次只有 querySelector + 两次
        // getBoundingClientRect，通常命中缓存，成本可忽略；内联 align 跟着
        // 布局逐帧更新，动画过程中同步移动，没有任何可感知的错位窗口。
        // 页面不可见时暂停 rAF，卸载时取消。
        let raf = 0;
        const tick = () => {
          measure();
          raf = window.requestAnimationFrame(tick);
        };
        raf = window.requestAnimationFrame(tick);
        let observer = null;
        if (typeof ResizeObserver === "function") {
          observer = new ResizeObserver(measure);
          observer.observe(document.documentElement);
          observer.observe(document.body);
          const card = findCard();
          if (card) observer.observe(card);
        }
        return () => {
          window.removeEventListener("resize", measure);
          window.cancelAnimationFrame(raf);
          if (observer) observer.disconnect();
        };
      }, []);

      const loadState = useCallback(async () => {
        const ticket = generation.current;
        const value = await api("state", { sessionId });
        if (ticket !== generation.current) return undefined;
        setState(value);
        setSelected((previous) => {
          if (previous && value.presets.some((item) => item.id === previous)) return previous;
          if (value.current?.presetId && value.presets.some((item) => item.id === value.current.presetId)) {
            return value.current.presetId;
          }
          return value.presets[0]?.id ?? "";
        });
        return value;
      }, [sessionId]);

      const reload = useCallback(async () => loadState(), [loadState]);

      // 只有「预览 / 编辑面板打开」期间才需要追外部变化：信号 =
      // 窗口重获焦点 / 标签页切回可见 / 每 5s 静默轮询（仅页面可见时）。
      // 平时不常驻检测。静默刷新不通过 useTask：不点亮 busy、失败不弹错
      // （下一轮信号会再试）；代际守卫防旧响应回写。
      useEffect(() => {
        if (!sessionId || !panel) return undefined;
        let last = 0;
        const refresh = () => {
          if (document.visibilityState !== "visible") return;
          const now = Date.now();
          if (now - last < 1500) return;
          last = now;
          loadState().catch(() => {});
        };
        const onVisibility = () => refresh();
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", onVisibility);
        const timer = window.setInterval(() => {
          if (document.visibilityState === "visible") loadState().catch(() => {});
        }, 5000);
        return () => {
          window.removeEventListener("focus", refresh);
          document.removeEventListener("visibilitychange", onVisibility);
          window.clearInterval(timer);
        };
      }, [sessionId, panel, loadState]);

      useEffect(() => {
        generation.current += 1;
        setState(null);
        setPanel(null);
        setConfirmApply(null);
        // 切会话时不能沿用上一个会话的下拉选择，否则会出现「状态是 A 会话、
        // 下拉停在 B 会话选过的预设」。清空后由 loadState 按新会话的
        // current.presetId（没有就取第一个预设）重新定。
        setSelected("");
        task.setError("");
        task.setNotice("");
        task.run(reload);
        // 设置页里增删改预设后，这里立刻重新读取，不用手动点刷新。
        return onPresetsChanged(() => {
          task.run(reload);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId]);

      if (!sessionId) return null;

      const presets = state?.presets ?? [];
      const current = state?.current ?? null;
      const limits = state?.limits ?? { maxBytes: 65536 };
      const currentName = current?.source === "preset" || current?.source === "custom" ? current.name : null;

      const applySelected = () => {
        if (!selected) return;
        task.run(async () => {
          // 覆盖判定基于点击瞬间的文件状态：先强制重读一次，再决定弹不弹
          // 确认框（工作区自带 / 会话内修改 / 预设已删除才弹）。
          const fresh = await loadState();
          const freshCurrent = fresh?.current ?? null;
          if (freshCurrent && freshCurrent.exists && freshCurrent.source !== "preset") {
            setConfirmApply(selected);
            return;
          }
          const value = await api("apply", { presetId: selected, sessionId });
          setState((previous) => ({ ...(previous ?? {}), ...value }));
          task.setNotice(value.unchanged ? T.unchanged : T.applied(value.preset.name));
        });
      };
      const confirmOverwrite = () => {
        const presetId = confirmApply;
        setConfirmApply(null);
        task.run(async () => {
          const value = await api("apply", { presetId, sessionId });
          setState((previous) => ({ ...(previous ?? {}), ...value }));
          task.setNotice(value.unchanged ? T.unchanged : T.applied(value.preset.name));
        });
      };

      const statusText = !current
        ? ""
        : !current.exists
          ? T.currentMissing
          : current.source === "preset" || current.source === "custom"
            ? `当前：${current.name}`
            : current.source === "deleted"
              ? current.name
                ? T.currentDeletedNamed(current.name)
                : T.currentDeleted
              : T.currentCustom;

      const togglePanel = () => {
        if (panel) {
          setPanel(null);
          return;
        }
        // 打开面板的瞬间重读一次，别把闭面板期间的旧状态直接摆出来。
        setPanel("preview");
        loadState().catch(() => {});
      };

      // 会话里既不内嵌全文也不内嵌文本框：正文用右侧栏的内置 markdown 预览打开，
      // 修改一律用本机编辑器打开工作区的 AGENTS.md。
      const openPreview = () => {
        if (!current?.exists) {
          task.setError(T.previewMissing);
          return;
        }
        const right = typeof ctx?.get === "function" ? ctx.get("sidebarRight") : undefined;
        const navigator = right ?? ctx?.sidebarRight;
        if (!navigator || typeof navigator.openResource !== "function") {
          task.setError(T.previewUnavailable);
          return;
        }
        const address = `dsh-resource://file/session/${encodeURIComponent(sessionId)}/AGENTS.md`;
        try {
          navigator.openResource(address);
          task.setNotice(T.previewOpened);
        } catch (error) {
          task.setError(error?.message ?? String(error));
        }
      };

      const editInEditor = () => {
        task.run(async () => {
          const value = await api("workspace/open", { sessionId });
          task.setNotice(value.openedWith === "vscode" ? T.openedWorkspaceVscode : T.openedWorkspaceSystem);
        });
      };

      const refreshAll = () => task.run(reload);

      const startSaveAs = () => {
        if (!current?.exists) {
          task.setError(T.saveAsNeedsFile);
          return;
        }
        setGlobalName(currentName ? String(currentName).replace(/（会话内修改）$/, "") : "");
        setGlobalDesc("");
        setPanel("saveAs");
      };

      const saveAsGlobal = () => {
        if (!globalName.trim()) {
          task.setError(T.nameRequiredForGlobal);
          return;
        }
        task.run(async () => {
          const workspace = await api("workspace/read", { sessionId });
          const value = await api("preset/create", {
            name: globalName,
            description: globalDesc,
            content: workspace.content ?? "",
          });
          // 下拉里立刻切到新预设，避免状态行已经是新预设、下拉还停在旧值，
          // 之后再点「应用」把旧行为覆写回去。
          setSelected(value.preset.id);
          await reload();
          setPanel("preview");
          notifyPresetsChanged();
          task.setNotice(T.savedAsGlobal(value.preset.name));
        });
      };

      return h(
        "div",
        {
          ref: dockRef,
          style: {
            ...S.dock,
            // 卡片对齐：铺满槽位带的字段在找到卡片后换成卡片的宽度/左边距。
            ...(align ? { width: align.width, marginLeft: align.left } : null),
          },
        },
        h(
          "div",
          { style: { ...S.row, justifyContent: "space-between" } },
          // 左簇：标签 + 下拉 + 应用（含）；右簇：当前状态 + 刷新。
          // space-between 让两簇分别贴两侧，面板拉伸时中缝自由变化；
          // 窄到放不下时 flexWrap 换行，一行一簇。
          h(
            "div",
            { style: { ...S.row, minWidth: 0, maxWidth: "100%" } },
            h("span", { style: { fontWeight: 600, whiteSpace: "nowrap" } }, T.dockLabel),
            state === null
              ? h("span", { style: S.hint }, task.error ? "读取失败" : "读取中…")
              : presets.length === 0
                ? h("span", { style: S.hint }, T.noPreset)
                : h(
                    "select",
                    {
                      style: S.select,
                      value: selected,
                      title: "选择要应用到此工作区的预设",
                      onChange: (event) => setSelected(event.target.value),
                    },
                    ...presets.map((preset) => h("option", { key: preset.id, value: preset.id }, preset.name)),
                  ),
            presets.length > 0
              ? h(
                  "button",
                  {
                    type: "button",
                    style: task.busy || !selected ? { ...S.primary, ...S.disabled } : S.primary,
                    disabled: task.busy || !selected,
                    onClick: applySelected,
                  },
                  task.busy ? T.applying : T.apply,
                )
              : null,
          ),
          h(
            "div",
            { style: { ...S.row, minWidth: 0, maxWidth: "100%" } },
            state && statusText
              ? h(
                  "button",
                  {
                    type: "button",
                    style: panel
                      ? { ...S.ghost, borderColor: "var(--dsw-alias-border-l3, rgba(127,127,127,.5))" }
                      : S.ghost,
                    title: T.previewTitle,
                    onClick: togglePanel,
                  },
                  `${statusText} · ${panel ? T.previewClose : T.previewButton}`,
                )
              : null,
            h(
              "button",
              {
                type: "button",
                style: task.busy ? { ...S.ghost, ...S.disabled } : S.ghost,
                disabled: task.busy,
                onClick: refreshAll,
              },
              T.refresh,
            ),
          ),
        ),
        panel && state
          ? h(
              "div",
              { style: S.panel },
              h(
                "div",
                { style: S.row },
                h("span", { style: S.label }, panel === "saveAs" ? T.saveAsGlobal : T.previewTitle),
                h(
                  "span",
                  { style: S.meta },
                  current?.exists ? `${T.bytes} ${current.bytes} / ${limits.maxBytes}` : T.fileMissing,
                ),
              ),
              current && current.exists
                ? h(
                    "div",
                    { style: S.row, gap: 6 },
                    h(
                      "span",
                      { style: S.currentName },
                      current.source === "deleted" && !current.name ? T.currentDeleted : current.name || T.currentCustom,
                    ),
                    h(
                      "span",
                      { style: S.hint },
                      current.description ? current.description : T.noDescription,
                    ),
                  )
                : h("div", { style: S.hint }, T.currentMissing),
              h(
                "div",
                { style: S.hint },
                !current?.exists
                  ? T.sourceMissingFile
                  : current.source === "preset"
                    ? T.sourcePreset(current.name)
                    : current.source === "custom"
                      ? T.sourceCustom(String(current.name ?? "").replace(/（会话内修改）$/, "") || "会话内自定义")
                      : current.source === "deleted"
                        ? T.sourceDeleted
                        : T.sourceWorkspace,
              ),
              panel === "preview" ? h("div", { style: S.hint }, T.previewOpenHint) : null,
              panel === "preview"
                ? h(
                    "div",
                    { style: S.row },
                    h(
                      "button",
                      {
                        type: "button",
                        style: current?.exists ? S.button : { ...S.button, ...S.disabled },
                        disabled: !current?.exists,
                        onClick: openPreview,
                      },
                      T.previewOpen,
                    ),
                    h("button", { type: "button", style: S.button, onClick: editInEditor }, T.editWorkspace),
                    h(
                      "button",
                      {
                        type: "button",
                        style: current?.exists ? S.button : { ...S.button, ...S.disabled },
                        disabled: !current?.exists,
                        title: current?.exists ? T.saveAsGlobal : T.saveAsNeedsFile,
                        onClick: startSaveAs,
                      },
                      T.saveAsGlobal,
                    ),
                  )
                : null,
              panel === "saveAs"
                ? h("input", {
                    style: S.input,
                    placeholder: T.globalNamePlaceholder,
                    value: globalName,
                    maxLength: limits.maxName ?? 80,
                    onChange: (event) => setGlobalName(event.target.value),
                  })
                : null,
              panel === "saveAs"
                ? h("input", {
                    style: S.input,
                    placeholder: T.globalDescPlaceholder,
                    value: globalDesc,
                    maxLength: limits.maxDescription ?? 500,
                    onChange: (event) => setGlobalDesc(event.target.value),
                  })
                : null,
              panel === "saveAs"
                ? h(
                    "div",
                    { style: S.row },
                    h("span", { style: S.hint }, "内容取自工作区当前文件"),
                    h("div", { style: { flex: 1 } }),
                    h(
                      "button",
                      {
                        type: "button",
                        style: task.busy ? { ...S.primary, ...S.disabled } : S.primary,
                        disabled: task.busy,
                        onClick: saveAsGlobal,
                      },
                      T.saveGlobal,
                    ),
                    h("button", { type: "button", style: S.button, onClick: () => setPanel("preview") }, T.cancel),
                  )
                : null,
            )
          : null,
        state && state.workspace === null ? h("div", { style: S.hint }, T.noWorkspace) : null,
        // 覆盖确认弹窗：当前内容不是生效预设原文时点「应用」先确认。
        confirmApply
          ? h(
              "div",
              {
                style: S.overlay,
                onClick: (event) => {
                  if (event.target === event.currentTarget) setConfirmApply(null);
                },
              },
              h(
                "div",
                { style: S.dialog },
                h(
                  "div",
                  { style: S.currentName },
                  T.overwriteTitle(presets.find((preset) => preset.id === confirmApply)?.name ?? ""),
                ),
                h("div", { style: S.hint }, T.overwriteBody),
                h(
                  "div",
                  { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                  h("button", { type: "button", style: S.button, onClick: () => setConfirmApply(null) }, T.overwriteCancel),
                  h(
                    "button",
                    {
                      type: "button",
                      style: task.busy ? { ...S.primary, ...S.disabled } : S.primary,
                      disabled: task.busy,
                      onClick: confirmOverwrite,
                    },
                    T.overwriteConfirm,
                  ),
                ),
              ),
            )
          : null,
        h(Notice, { error: task.error, notice: task.notice }),
      );
    }

    function apply(ctx) {
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          { name: "settings.section", id: ENTRY_ID, order: 64, label: () => T.settingsLabel },
          () => h(SettingsSection, {}),
        ),
      );
      ctx.slots.inject("conversation.input.dock", () =>
        ctx.slots.register({ name: "conversation.input.dock", id: DOCK_ID, order: 30 }, (props) =>
          h(SessionPresetBar, { ...(props ?? {}), ctx }),
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
