import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findCodeExecutable, openInEditor } from '../lib/editor.js';

const LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
const VSCODE = `${LOCALAPPDATA}\\Programs\\Microsoft VS Code\\Code.exe`;
const INSIDERS = `${LOCALAPPDATA}\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe`;
const VSCODE_PF = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
const VSCODE_X86 = 'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe';
const OPTIONS = { detached: true, stdio: 'ignore', windowsHide: true };

/** 只把 known 里的路径当作存在，并记录每次查询，便于断言查找顺序。 */
function fixedExists(known) {
  const calls = [];
  const exists = (candidate) => {
    calls.push(candidate);
    return known.includes(candidate);
  };
  exists.calls = calls;
  return exists;
}

/** 假的 spawn：记录 command/args/options，并统计 unref 次数。 */
function spawnRecorder() {
  const calls = [];
  let unrefs = 0;
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      unref() {
        unrefs += 1;
      },
    };
  };
  spawnImpl.calls = calls;
  spawnImpl.unrefCount = () => unrefs;
  return spawnImpl;
}

test('win32: LOCALAPPDATA 的 Code.exe 优先于 Insiders / ProgramFiles', () => {
  const env = { LOCALAPPDATA, ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
  assert.equal(findCodeExecutable({ platform: 'win32', env, exists: fixedExists([VSCODE, INSIDERS, VSCODE_PF]) }), VSCODE);
  assert.equal(findCodeExecutable({ platform: 'win32', env, exists: fixedExists([INSIDERS, VSCODE_PF]) }), INSIDERS);
  assert.equal(findCodeExecutable({ platform: 'win32', env, exists: fixedExists([VSCODE_PF, VSCODE_X86]) }), VSCODE_PF);
  assert.equal(findCodeExecutable({ platform: 'win32', env, exists: fixedExists([VSCODE_X86]) }), VSCODE_X86);
});

test('win32: PATH 里只有 code.cmd 时也能找到（delimiter 显式传 ;）', () => {
  const bin = 'C:\\tools\\bin';
  const codeCmd = `${bin}\\code.cmd`;
  const exists = fixedExists([codeCmd]);
  assert.equal(
    findCodeExecutable({ platform: 'win32', env: { Path: `C:\\empty;${bin}` }, exists, delimiter: ';' }),
    codeCmd,
  );
  // 两趟扫描：先找遍所有目录的 code.exe，再找 code.cmd，所以 .exe 优先于任意目录里的 .cmd。
  assert.deepEqual(exists.calls, ['C:\\empty\\code.exe', `${bin}\\code.exe`, 'C:\\empty\\code.cmd', codeCmd]);
});

test('找不到 VS Code 时返回 null，且 env 缺字段 / 空 PATH 不抛异常', () => {
  assert.equal(findCodeExecutable({ platform: 'win32', env: {}, exists: () => false }), null);
  assert.equal(findCodeExecutable({ platform: 'win32', env: { PATH: '' }, exists: () => false }), null);
  assert.equal(findCodeExecutable({ platform: 'win32', env: null, exists: () => false }), null);
  assert.equal(findCodeExecutable({ platform: 'darwin', env: {}, exists: () => false }), null);
  assert.equal(findCodeExecutable({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false }), null);
});

test('openInEditor: .exe 直接 spawn，复用窗口（-r -g file:1）并调用 unref', () => {
  const file = 'C:\\ws\\AGENTS.md';
  const env = { LOCALAPPDATA };
  const exists = (candidate) => candidate === file || candidate === VSCODE;
  const spawnImpl = spawnRecorder();
  const result = openInEditor(file, { platform: 'win32', env, exists, spawnImpl });

  assert.deepEqual(result, { openedWith: 'vscode', command: VSCODE, args: ['-r', '-g', `${file}:1`] });
  assert.equal(spawnImpl.calls.length, 1);
  assert.equal(spawnImpl.calls[0].command, VSCODE);
  assert.deepEqual(spawnImpl.calls[0].args, ['-r', '-g', `${file}:1`]);
  assert.deepEqual(spawnImpl.calls[0].options, { ...OPTIONS, env });
  assert.equal(spawnImpl.unrefCount(), 1);

  // 假 child 没有 unref 时不应因为 try/catch 之外的原因失败。
  assert.doesNotThrow(() =>
    openInEditor(file, { platform: 'win32', env: { LOCALAPPDATA }, exists, spawnImpl: () => ({}) }),
  );
});

test('openInEditor: .cmd 走 ComSpec /d /s /c，命令中带 -r -g 和引号', () => {
  const bin = 'C:\\Program Files\\Microsoft VS Code\\bin';
  const codeCmd = `${bin}\\code.cmd`;
  const file = 'D:\\notes\\带空格 的笔记.md';
  const env = { PATH: bin, ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  const exists = (candidate) => candidate === file || candidate === codeCmd;
  const spawnImpl = spawnRecorder();
  const result = openInEditor(file, { platform: 'win32', env, exists, spawnImpl });

  assert.equal(result.openedWith, 'vscode');
  assert.equal(result.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(result.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(result.args[3], `"${codeCmd}" -r -g "${file}:1"`);
  assert.match(result.args[3], / -r -g "D:\\notes\\带空格 的笔记\.md:1"$/);
  assert.deepEqual(spawnImpl.calls[0].options, { ...OPTIONS, env });
});

test('openInEditor: win32 无 VS Code 时退回 start "" "<file>"', () => {
  const file = 'C:\\ws\\AGENTS.md';
  const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  const spawnImpl = spawnRecorder();
  const result = openInEditor(file, {
    platform: 'win32',
    env,
    exists: (candidate) => candidate === file,
    spawnImpl,
  });

  assert.deepEqual(result, {
    openedWith: 'system',
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', `start "" "${file}"`],
  });
  assert.deepEqual(spawnImpl.calls[0].options, { ...OPTIONS, env });
});

test('openInEditor: 启动编辑器时摘掉 ELECTRON_RUN_AS_NODE', () => {
  const file = 'C:\\ws\\AGENTS.md';
  const env = { LOCALAPPDATA, ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\Windows' };
  const exists = (candidate) => candidate === file || candidate === VSCODE;
  const spawnImpl = spawnRecorder();
  openInEditor(file, { platform: 'win32', env, exists, spawnImpl });

  assert.deepEqual(spawnImpl.calls[0].options.env, { LOCALAPPDATA, PATH: 'C:\\Windows' });
});

test('openInEditor: darwin 退回 open，linux 退回 xdg-open', () => {
  const file = '/ws/AGENTS.md';
  const existsFileOnly = (candidate) => candidate === file;

  const darwinEnv = { PATH: '/usr/bin' };
  const darwinSpawn = spawnRecorder();
  assert.deepEqual(
    openInEditor(file, { platform: 'darwin', env: darwinEnv, exists: existsFileOnly, spawnImpl: darwinSpawn }),
    { openedWith: 'system', command: 'open', args: [file] },
  );
  assert.deepEqual(darwinSpawn.calls[0].options, { ...OPTIONS, env: darwinEnv });

  const linuxSpawn = spawnRecorder();
  assert.deepEqual(
    openInEditor(file, { platform: 'linux', env: { PATH: '/usr/bin' }, exists: existsFileOnly, spawnImpl: linuxSpawn }),
    { openedWith: 'system', command: 'xdg-open', args: [file] },
  );
});

test('openInEditor: 文件不存在时抛 code=file-not-found 且不 spawn', () => {
  const spawnImpl = spawnRecorder();
  assert.throws(
    () => openInEditor('C:\\ws\\missing.md', { platform: 'win32', env: {}, exists: () => false, spawnImpl }),
    (error) => error.code === 'file-not-found' && error.message === 'file-not-found',
  );
  assert.equal(spawnImpl.calls.length, 0);
});

test('openInEditor: requireFile=false 时允许打开尚不存在的文件（工作区还没有 AGENTS.md）', () => {
  const file = 'C:\\ws\\AGENTS.md';
  const env = { LOCALAPPDATA };
  const spawnImpl = spawnRecorder();
  const exists = (candidate) => candidate === VSCODE; // 只有 VS Code 存在，目标文件不存在
  const result = openInEditor(file, { platform: 'win32', env, exists, spawnImpl, requireFile: false });

  assert.deepEqual(result, { openedWith: 'vscode', command: VSCODE, args: ['-r', '-g', `${file}:1`] });
  assert.equal(spawnImpl.calls.length, 1);
});
