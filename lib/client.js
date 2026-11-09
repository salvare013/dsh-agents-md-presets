window.__ModuleLoader__.load({
  id: "@local/dsh-prompt-presets",
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require("react");
    const { createElement: h, useCallback, useEffect, useMemo, useState } = react;

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
        "预设保存在 DSH 数据目录中，任意工作区都能使用。会话面板里选中预设并应用后，会改写该会话工作区的 AGENTS.md，应用前的原文会存成快照，可随时回滚。",
      create: "新建预设",
      edit: "编辑",
      remove: "删除",
      cancel: "取消",
      save: "保存",
      saving: "保存中…",
      empty: "还没有预设。新建一个，然后在会话面板里应用它。",
      namePlaceholder: "预设名称，例如：代码审查",
      descriptionPlaceholder: "可选说明，例如：只看 diff、必须给出测试建议",
      contentPlaceholder: "在这里写 AGENTS.md 的内容（Markdown）",
      bytes: "字节",
      overLimit: "超过内置加载器上限，保存会被拒绝",
      nameRequired: "请填写预设名称",
      dataDir: "数据目录",
      confirmDelete: "确认删除",
      dockLabel: "AGENTS.md 预设",
      apply: "应用",
      applying: "应用中…",
      refresh: "刷新",
      history: "历史",
      noPreset: "还没有预设，先到「设置 → AGENTS.md 预设」里创建。",
      currentPreset: (name) => `当前：${name}`,
      currentCustom: "当前：工作区自带内容（非预设）",
      currentMissing: "当前：工作区没有 AGENTS.md",
      noWorkspace: "当前会话没有可用工作区，无法应用预设。",
      applied: (name) => `已应用「${name}」到 AGENTS.md`,
      rolledBack: "已回滚到应用前的版本",
      unchanged: "文件已经是这个预设的内容，无需重复写入",
      entryApply: "应用",
      entryRollback: "回滚",
      rollbackTo: (time) => `回滚到 ${time} 之前`,
      emptyHistory: "暂无记录",
      snapshotHint: "回滚会以快照恢复文件；如果回滚后又想回到预设，回滚那条记录即可。",
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
      historyItem: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "5px 8px",
        borderRadius: "var(--dsw-radius-md, 8px)",
        background: "var(--dsw-alias-bg-l1, rgba(127,127,127,.06))",
      },
      historyList: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: 190,
        overflowY: "auto",
        padding: "6px 8px 6px 6px",
        border: "1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))",
        borderRadius: "var(--dsw-radius-md, 8px)",
        background: "var(--dsw-alias-bg-l1, rgba(127,127,127,.05))",
      },
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
      const run = useCallback(async (task, successMessage) => {
        setBusy(true);
        setError("");
        setNotice("");
        try {
          const value = await task();
          if (successMessage) setNotice(successMessage);
          return value;
        } catch (cause) {
          setError(cause?.message || String(cause));
          return undefined;
        } finally {
          setBusy(false);
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
        const value = await api("state", { historyLimit: 0 });
        setState(value);
      }, []);

      useEffect(() => {
        task.run(reload);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      const presets = state?.presets ?? [];
      const limits = state?.limits ?? { maxBytes: 65536 };
      const draftBytes = draft ? new TextEncoder().encode(draft.content || "").length : 0;

      const startCreate = () => {
        setConfirming("");
        setDraft({ mode: "create", id: "", name: "", description: "", content: "" });
      };

      const startEdit = (preset) => {
        setConfirming("");
        task.run(async () => {
          const value = await api("preset/read", { id: preset.id });
          setDraft({
            mode: "edit",
            id: value.preset.id,
            name: value.preset.name,
            description: value.preset.description || "",
            content: value.content ?? "",
          });
        });
      };

      const save = () => {
        if (!draft) return;
        if (!draft.name.trim()) {
          task.setError(T.nameRequired);
          return;
        }
        if (draftBytes > limits.maxBytes) {
          task.setError(`${T.overLimit}（${draftBytes} > ${limits.maxBytes}）`);
          return;
        }
        const payload = {
          name: draft.name,
          description: draft.description,
          content: draft.content,
        };
        task.run(async () => {
          if (draft.mode === "create") {
            await api("preset/create", payload);
          } else {
            await api("preset/update", { ...payload, id: draft.id });
          }
          await reload();
          setDraft(null);
          notifyPresetsChanged();
        }, draft.mode === "create" ? "预设已创建" : "预设已保存");
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
          h("button", { type: "button", style: task.busy ? { ...S.button, ...S.disabled } : S.button, disabled: task.busy, onClick: () => task.run(reload) }, T.refresh),
          h("button", { type: "button", style: S.primary, onClick: startCreate }, T.create),
        ),
      );

      if (!state) {
        return h("div", { style: S.page }, header, h(Notice, { error: task.error }), h("div", { style: S.hint }, "读取中…"));
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
                h("span", { style: S.label }, draft.mode === "create" ? T.create : T.edit),
                h("span", { style: S.meta }, `${T.bytes} ${draftBytes} / ${limits.maxBytes}`),
                draftBytes > limits.maxBytes ? h("span", { style: S.error }, T.overLimit) : null,
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
              h("textarea", {
                style: S.textarea,
                placeholder: T.contentPlaceholder,
                value: draft.content,
                spellCheck: false,
                onChange: (event) => setDraft({ ...draft, content: event.target.value }),
              }),
              h(
                "div",
                { style: S.row },
                h("button", { type: "button", style: task.busy ? { ...S.primary, ...S.disabled } : S.primary, disabled: task.busy, onClick: save }, task.busy ? T.saving : T.save),
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
              ),
              h(
                "div",
                { style: S.cardHeadActions },
                h("button", { type: "button", style: S.button, onClick: () => startEdit(preset) }, T.edit),
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
      const [state, setState] = useState(null);
      const [selected, setSelected] = useState("");
      const [showHistory, setShowHistory] = useState(false);
      const task = useTask();

      const reload = useCallback(async () => {
        if (!sessionId) return undefined;
        const value = await api("state", { sessionId, historyLimit: 8 });
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
        setState(null);
        task.run(reload).catch(() => {});
        // 设置页里增删改预设后，这里立刻重新读取，不用手动点刷新。
        return onPresetsChanged(() => {
          task.run(reload).catch(() => {});
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId]);

      if (!sessionId) return null;

      const presets = state?.presets ?? [];
      const current = state?.current ?? null;
      const history = state?.history ?? [];
      const currentPreset = current?.presetId
        ? presets.find((item) => item.id === current.presetId) ?? null
        : null;

      const applySelected = () => {
        if (!selected) return;
        task.run(async () => {
          const value = await api("apply", { presetId: selected, sessionId });
          setState((previous) => ({ ...(previous ?? {}), ...value }));
          task.setNotice(value.unchanged ? T.unchanged : T.applied(value.preset.name));
        });
      };

      const rollbackTo = (entry) => {
        task.run(async () => {
          const value = await api("rollback", { entryId: entry.id, sessionId });
          setState((previous) => ({ ...(previous ?? {}), ...value }));
          task.setNotice(T.rolledBack);
        });
      };

      const statusText = !current
        ? ""
        : !current.exists
          ? T.currentMissing
          : currentPreset
            ? T.currentPreset(currentPreset.name)
            : T.currentCustom;

      return h(
        "div",
        { style: S.dock },
        h(
          "div",
          { style: S.row },
          h("span", { style: { fontWeight: 600 } }, T.dockLabel),
          state === null
            ? h("span", { style: S.hint }, "读取中…")
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
          state && statusText ? h("span", { style: S.hint }, statusText) : null,
          h("div", { style: { flex: 1 } }),
          state && history.length > 0
            ? h(
                "button",
                { type: "button", style: S.ghost, onClick: () => setShowHistory((value) => !value) },
                `${T.history} (${history.length})`,
              )
            : null,
          h(
            "button",
            {
              type: "button",
              style: task.busy ? { ...S.ghost, ...S.disabled } : S.ghost,
              disabled: task.busy,
              onClick: () => task.run(reload),
            },
            T.refresh,
          ),
        ),
        state && state.workspace === null ? h("div", { style: S.hint }, T.noWorkspace) : null,
        h(Notice, { error: task.error, notice: task.notice }),
        showHistory && state
          ? h(
              "div",
              { style: S.historyList },
              history.length === 0
                ? h("div", { style: S.hint }, T.emptyHistory)
                : history.map((entry) =>
                    h(
                      "div",
                      { key: entry.id, style: S.historyItem },
                      h(
                        "span",
                        { style: S.hint },
                        `${formatTime(entry.at)} · ${entry.action === "apply" ? T.entryApply : T.entryRollback} · ${
                          entry.presetName ?? "（无预设）"
                        } · ${formatBytes(entry.beforeBytes)} → ${formatBytes(entry.afterBytes)}`,
                      ),
                      h(
                        "button",
                        {
                          type: "button",
                          style: S.ghost,
                          title: T.rollbackTo(formatTime(entry.at)),
                          onClick: () => rollbackTo(entry),
                        },
                        T.entryRollback,
                      ),
                    ),
                  ),
              h("div", { style: S.hint }, T.snapshotHint),
            )
          : null,
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
          h(SessionPresetBar, props ?? {}),
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
