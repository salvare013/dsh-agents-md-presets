window.__ModuleLoader__.load({
  id: "@local/dsh-prompt-presets",
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require("react");
    const { createElement: h, useCallback, useEffect, useRef, useState } = react;

    const API = "/api/dsh-prompt-presets";
    const ENTRY_ID = "prompt-presets";
    const DOCK_ID = "prompt-presets.session";
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
      confirmDelete: "确认删除",
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
      nameRequiredForGlobal: "请给全局预设起个名字",
    };

    const S = {
      page: { display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 24px" },
      row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
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
      hint: { fontSize: 12, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary, #666)" },
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
        padding: "6px 2px 2px",
        fontSize: 12,
        color: "var(--dsw-alias-label-secondary, #666)",
      },
      panel: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        background: "var(--dsw-alias-bg-l1, rgba(127,127,127,.05))",
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
      const [confirming, setConfirming] = useState("");
      const task = useTask();

      const reload = useCallback(async () => {
        const value = await api("state", {});
        setState(value);
      }, []);

      useEffect(() => {
        task.run(reload);
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
        setConfirming("");
        task.run(async () => {
          const value = await api("preset/open", { id: preset.id });
          task.setNotice(value.openedWith === "vscode" ? T.openedWithVscode : T.openedWithSystem);
        });
      };

      const presets = state?.presets ?? [];
      const limits = state?.limits ?? { maxBytes: 65536 };

      const startCreate = () => {
        setConfirming("");
        setDraft({ mode: "create", id: "", name: "", description: "" });
      };

      // 只改元数据；正文一律交给编辑器。
      const startMeta = (preset) => {
        setConfirming("");
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

      const remove = (id) => {
        if (confirming !== id) {
          setConfirming(id);
          return;
        }
        setConfirming("");
        task.run(async () => {
          await api("preset/delete", { id });
          await reload();
          notifyPresetsChanged();
        }, "预设已删除");
      };

      const header = h(
        "div",
        { style: S.cardHead },
        h("div", { style: S.cardHeadMain },
          h("div", { style: S.name }, T.title),
          state?.root ? h("div", { style: S.meta }, `${T.dataDir}：${state.root}`) : null,
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

        draft
          ? h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.row },
                h("span", { style: S.label }, draft.mode === "create" ? T.create : T.editMeta),
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

        ...presets.map((preset) =>
          h(
            "div",
            { key: preset.id, style: S.card },
            h(
              "div",
              { style: S.cardHead },
              h(
                "div",
                { style: S.cardHeadMain },
                h("div", { style: S.name }, preset.name),
                preset.description ? h("div", { style: S.hint }, preset.description) : null,
                h("div", { style: S.meta }, `${formatBytes(preset.bytes)} · ${formatTime(preset.updatedAt)} · ${preset.id}`),
                preset.missing ? h("div", { style: S.error }, T.missingFile) : null,
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
                  { type: "button", style: S.danger, onClick: () => remove(preset.id) },
                  confirming === preset.id ? T.confirmDelete : T.remove,
                ),
              ),
            ),
          ),
        ),
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
      const task = useTask();
      // 切会话或连续刷新时，晚到的旧响应不能覆盖新会话的状态。
      const generation = useRef(0);

      const reload = useCallback(async () => {
        if (!sessionId) return undefined;
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

      useEffect(() => {
        generation.current += 1;
        setState(null);
        setPanel(null);
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
          const value = await api("apply", { presetId: selected, sessionId });
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
            : T.currentCustom;

      const togglePanel = () => {
        setPanel((current) => (current ? null : "preview"));
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
          await reload();
          setPanel("preview");
          notifyPresetsChanged();
          task.setNotice(T.savedAsGlobal(value.preset.name));
        });
      };

      return h(
        "div",
        { style: S.dock },
        h(
          "div",
          { style: S.row },
          h("span", { style: { fontWeight: 600 } }, T.dockLabel),
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
          h("div", { style: { flex: 1 } }),
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
                  `${T.bytes} ${current?.bytes ?? 0} / ${limits.maxBytes}`,
                ),
                h("div", { style: { flex: 1 } }),
              ),
              current && current.exists
                ? h(
                    "div",
                    { style: S.row, gap: 6 },
                    h("span", { style: S.currentName }, current.name || T.currentCustom),
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
                current?.source === "preset"
                  ? T.sourcePreset(current.name)
                  : current?.source === "custom"
                    ? T.sourceCustom(String(current.name ?? "").replace(/（会话内修改）$/, "") || "会话内自定义")
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
