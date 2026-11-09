import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

/**
 * 冒烟测试：用假的 ModuleLoader / react / Slots 执行 client.js，
 * 确认模块能加载、apply() 注册到两个预期 slot，且不需要真实浏览器。
 */

const source = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  useCallback: (fn) => fn,
  useMemo: (factory) => factory(),
  useEffect: () => {},
};

function boot() {
  let definition = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value;
        },
      },
    },
    console,
    TextEncoder,
    fetch: async () => {
      throw new Error("测试里不应发起网络请求");
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "lib/client.js" });
  assert.ok(definition, "client.js 应当调用 window.__ModuleLoader__.load");
  assert.equal(definition.id, "@local/dsh-prompt-presets");

  const moduleExports = definition.factory((name) => {
    if (name === "react") return fakeReact;
    throw new Error(`unexpected require: ${name}`);
  });
  return moduleExports;
}

test("client 模块加载并导出 apply / inject", () => {
  const exported = boot();
  assert.equal(typeof exported.apply, "function");
  assert.deepEqual([...exported.inject], ["slots"]);
});

test("apply() 注册设置页与会话预设条", () => {
  const exported = boot();
  const registrations = [];
  const ctx = {
    slots: {
      inject(key, callback) {
        assert.ok(key === "settings.section" || key === "conversation.input.dock", `未知 slot: ${key}`);
        callback();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  exported.apply(ctx);

  assert.equal(registrations.length, 2);
  const settings = registrations.find((item) => item.options.name === "settings.section");
  const dock = registrations.find((item) => item.options.name === "conversation.input.dock");
  assert.ok(settings, "应注册 settings.section");
  assert.ok(dock, "应注册 conversation.input.dock");
  assert.equal(settings.options.id, "prompt-presets");
  assert.equal(dock.options.id, "prompt-presets.session");
  assert.equal(settings.options.label(), "AGENTS.md 预设");
  assert.equal(typeof settings.component, "function");
  assert.equal(typeof dock.component, "function");
});
