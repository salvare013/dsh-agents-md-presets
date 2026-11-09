import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 编辑器集成：定位 VS Code、在系统编辑器中打开文件。纯函数 + 依赖注入，不缓存结果，
 * 便于宿主 HTTP 路由与单元测试复用。
 */

/** 把 env 里的目录值规范成字符串；缺失、非字符串或空白值一律视为空。 */
function directoryOf(env, key) {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '';
}

/** 拼接 Windows 路径，保留盘符根目录（C:\）的尾部分隔符，避免拼出 C:xxx。 */
function windowsJoin(base, ...parts) {
  let result = String(base);
  for (const part of parts) {
    const next = String(part);
    if (result === '') result = next;
    else if (/[\\/]$/.test(result) || /^[\\/]/.test(next)) result += next;
    else result += `\\${next}`;
  }
  return result;
}

/** 取出 PATH / Path 里的目录列表；空 PATH 返回空数组。 */
function pathDirectories(env, delimiter) {
  const source = env ?? {};
  const raw = typeof source.PATH === 'string' && source.PATH !== '' ? source.PATH : source.Path;
  if (typeof raw !== 'string' || raw === '') return [];
  const separator = typeof delimiter === 'string' && delimiter !== '' ? delimiter : path.delimiter;
  return raw
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Windows 上 VS Code 的固定安装位置，按优先级排列；缺字段的项会被跳过。 */
function windowsCandidates(env) {
  const local = directoryOf(env, 'LOCALAPPDATA');
  const programFiles = directoryOf(env, 'ProgramFiles');
  const programFilesX86 = directoryOf(env, 'ProgramFiles(x86)');
  return [
    local && windowsJoin(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    local && windowsJoin(local, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
    programFiles && windowsJoin(programFiles, 'Microsoft VS Code', 'Code.exe'),
    programFilesX86 && windowsJoin(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
  ].filter(Boolean);
}

/**
 * 查找 VS Code 可执行文件。
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform] 目标平台，默认当前进程平台。
 * @param {Record<string, string | undefined>} [options.env] 环境变量视图，默认 process.env；可注入假 env。
 * @param {(candidate: string) => boolean} [options.exists] 存在性判断，默认 fs.existsSync；可注入假实现。
 * @param {string} [options.delimiter] PATH 分隔符，默认 path.delimiter；测试可显式传 ';'。
 * @returns {string | null} 可执行文件绝对路径；找不到时返回 null，不抛异常。
 */
export function findCodeExecutable({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
  delimiter = path.delimiter,
} = {}) {
  const directories = pathDirectories(env, delimiter);
  if (platform === 'win32') {
    // 固定安装目录优先，其次才是 PATH；PATH 中 .exe 优先于 .cmd（与 where code 的顺序一致）。
    for (const candidate of windowsCandidates(env)) {
      if (exists(candidate)) return candidate;
    }
    for (const name of ['code.exe', 'code.cmd']) {
      for (const directory of directories) {
        const candidate = windowsJoin(directory, name);
        if (exists(candidate)) return candidate;
      }
    }
    return null;
  }
  for (const directory of directories) {
    const candidate = path.posix.join(directory, 'code');
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** 构造 file-not-found 错误；调用方（HTTP 路由）只按 code 分支即可。 */
function fileNotFoundError() {
  const error = new Error('file-not-found');
  error.code = 'file-not-found';
  return error;
}

/** Windows 命令解释器；默认 cmd.exe，测试/宿主可通过 env.ComSpec 覆盖。 */
function windowsShell(env) {
  const comSpec = env?.ComSpec;
  return typeof comSpec === 'string' && comSpec !== '' ? comSpec : 'cmd.exe';
}

/**
 * 子进程环境：DSH 桌面端从 Electron 启动，环境里常带 ELECTRON_RUN_AS_NODE=1；
 * 继承下去会让同样基于 Electron 的 VS Code 以 Node 模式运行，报 "bad option: -n"。
 * 启动编辑器前必须把这个变量摘掉。
 */
function launchEnv(env) {
  const next = { ...(env ?? {}) };
  delete next.ELECTRON_RUN_AS_NODE;
  return next;
}

/** 发起启动并返回「准备执行」的事实；不等待进程结束、不检查退出码。 */
function launch(spawnImpl, openedWith, command, args, env) {
  const child = spawnImpl(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: launchEnv(env),
  });
  try {
    child.unref();
  } catch {
    // 测试里的假 child 可能没有 unref；打开动作已经发出，无需补救。
  }
  return { openedWith, command, args };
}

/**
 * 在 VS Code 中打开文件；找不到 VS Code 时退回系统默认程序。
 * @param {string} file 目标文件的绝对路径（由调用方解析，本模块只做存在性检查）。
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform] 目标平台，默认当前进程平台。
 * @param {Record<string, string | undefined>} [options.env] 环境变量视图，默认 process.env。
 * @param {(candidate: string) => boolean} [options.exists] 存在性判断，默认 fs.existsSync。
 * @param {Function} [options.spawnImpl] 子进程启动函数，默认 childProcess.spawn；测试可注入假实现。
 * @returns {{ openedWith: 'vscode' | 'system', command: string, args: string[] }}
 * @throws {Error & { code: 'file-not-found' }} 文件不存在时抛出。
 */
export function openInEditor(
  file,
  { platform = process.platform, env = process.env, exists = fs.existsSync, spawnImpl = childProcess.spawn } = {},
) {
  const target = typeof file === 'string' ? file : '';
  if (target === '' || !exists(target)) throw fileNotFoundError();

  // 用平台固定分隔符而不是宿主 path.delimiter，保证模拟其他平台时路径解析仍然确定。
  const delimiter = platform === 'win32' ? ';' : ':';
  const executable = findCodeExecutable({ platform, env, exists, delimiter });
  if (executable) {
    if (/\.(cmd|bat)$/i.test(executable)) {
      // .cmd/.bat 不能直接 CreateProcess，必须交给 cmd；整条命令加引号以容忍空格。
      const command = windowsShell(env);
      return launch(spawnImpl, 'vscode', command, ['/d', '/s', '/c', `"${executable}" -n "${target}"`], env);
    }
    return launch(spawnImpl, 'vscode', executable, ['-n', target], env);
  }

  if (platform === 'win32') {
    return launch(spawnImpl, 'system', windowsShell(env), ['/d', '/s', '/c', `start "" "${target}"`], env);
  }
  if (platform === 'darwin') {
    return launch(spawnImpl, 'system', 'open', [target], env);
  }
  return launch(spawnImpl, 'system', 'xdg-open', [target], env);
}
