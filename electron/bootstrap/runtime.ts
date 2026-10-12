import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAppDataDir, getDataDir } from '../paths.js';

const execFileAsync = promisify(execFile);
const __bootstrapDir = path.dirname(fileURLToPath(import.meta.url));

export type RuntimeToolStatus = 'pending' | 'ok' | 'fail' | 'skipped';

export interface RuntimeState {
  scoop: RuntimeToolStatus;
  winget: RuntimeToolStatus;
  chocolatey: RuntimeToolStatus;
  completedAt?: number;
  chocoUacPending?: boolean;
  messages?: Record<string, string>;
}

export interface RuntimePaths {
  root: string;
  scoop: string;
  scoopGlobal: string;
  scoopShim: string;
  winget: string | null;
  chocolatey: string;
}

const STATE_FILE = 'runtime-state.json';

function statePath(): string {
  return path.join(getAppDataDir(), STATE_FILE);
}

export function getRuntimeDir(): string {
  return path.join(getAppDataDir(), 'runtime');
}

export function getRuntimePaths(): RuntimePaths {
  const root = getRuntimeDir();
  const scoop = path.join(root, 'scoop');
  const scoopGlobal = path.join(root, 'scoop-global');
  const scoopShim = path.join(scoop, 'shims', 'scoop.cmd');
  const choco = path.join(root, 'chocolatey', 'bin', 'choco.exe');
  return {
    root,
    scoop,
    scoopGlobal,
    scoopShim,
    winget: resolveWingetPath(),
    chocolatey: choco,
  };
}

export function loadRuntimeState(): RuntimeState {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) {
      return { scoop: 'pending', winget: 'pending', chocolatey: 'pending' };
    }
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as RuntimeState;
  } catch {
    return { scoop: 'pending', winget: 'pending', chocolatey: 'pending' };
  }
}

export function saveRuntimeState(state: RuntimeState): void {
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

export function isBootstrapComplete(): boolean {
  const s = loadRuntimeState();
  if (s.completedAt) return true;
  const done = (x: RuntimeToolStatus) => x === 'ok' || x === 'fail' || x === 'skipped';
  return done(s.scoop) && done(s.winget) && done(s.chocolatey);
}

function resolveWingetPath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'winget', 'winget.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'winget';
}

async function runPowerShell(script: string, timeout = 300000, env?: Record<string, string>): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      timeout,
      windowsHide: true,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return (stdout || stderr || '').trim();
}

async function runCmd(exe: string, args: string[], timeout = 60000, env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync(exe, args, {
    timeout,
    windowsHide: true,
    shell: true,
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function testScoop(): Promise<{ ok: boolean; version?: string; bundled?: boolean }> {
  const paths = getRuntimePaths();
  const scoopEnv = { SCOOP: paths.scoop, SCOOP_GLOBAL: paths.scoopGlobal };
  if (fs.existsSync(paths.scoopShim)) {
    try {
      const out = await runCmd(paths.scoopShim, ['--version'], 15000, scoopEnv);
      const version = out.split('\n')[0]?.replace('Current Scoop version: ', '').trim();
      return { ok: true, version, bundled: true };
    } catch {
      // bundled shim broken — try system scoop below
    }
  }
  try {
    const out = await runCmd('scoop', ['--version'], 15000);
    const version = out.split('\n')[0]?.replace('Current Scoop version: ', '').trim();
    return { ok: true, version, bundled: false };
  } catch {
    return { ok: false };
  }
}

async function testWinget(): Promise<{ ok: boolean; version?: string }> {
  const winget = resolveWingetPath();
  if (!winget) return { ok: false };
  try {
    const out = await runCmd(winget, ['--version'], 15000);
    return { ok: true, version: out.split('\n')[0]?.trim() };
  } catch {
    return { ok: false };
  }
}

async function testChocolatey(): Promise<{ ok: boolean; version?: string }> {
  const paths = getRuntimePaths();
  if (!fs.existsSync(paths.chocolatey)) {
    try {
      const out = await runCmd('choco', ['--version'], 10000);
      return { ok: true, version: out.trim() };
    } catch {
      return { ok: false };
    }
  }
  try {
    const out = await runCmd(paths.chocolatey, ['--version'], 10000);
    return { ok: true, version: out.trim() };
  } catch {
    return { ok: false };
  }
}

function psPath(p: string): string {
  return p.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

async function isRunningAsAdmin(): Promise<boolean> {
  try {
    const out = await runPowerShell(
      '[bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))',
      10000,
    );
    return out.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

function materializeZipInstallScript(runtimeRoot: string): string {
  const dest = path.join(runtimeRoot, 'scoop-zip-install.ps1');
  if (fs.existsSync(dest)) return dest;

  const candidates = [
    path.join(getDataDir(), 'bootstrap', 'scoop-zip-install.ps1'),
    path.join(__bootstrapDir, 'scoop-zip-install.ps1'),
    path.join(process.resourcesPath, 'data', 'bootstrap', 'scoop-zip-install.ps1'),
  ];

  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(runtimeRoot, { recursive: true });
      fs.copyFileSync(src, dest);
      return dest;
    }
  }

  throw new Error('scoop-zip-install.ps1 not bundled');
}

async function bootstrapScoopFromZip(
  paths: RuntimePaths,
  logPath: string,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  onProgress?.('Установка Scoop из архива…');
  try {
    const zipScript = materializeZipInstallScript(paths.root);
    await runPowerShell(
      `& '${psPath(zipScript)}' -ScoopDir '${psPath(paths.scoop)}' -LogPath '${psPath(logPath)}'`,
      300000,
      { SCOOP: paths.scoop, SCOOP_GLOBAL: paths.scoopGlobal },
    );
    return (await testScoop()).ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GetBox] Scoop zip install failed:', msg);
    try {
      fs.appendFileSync(logPath, `\n[zip-error] ${msg}\n`);
    } catch {
      // ignore
    }
    return (await testScoop()).ok;
  }
}

async function bootstrapScoopFromOfficialInstaller(
  paths: RuntimePaths,
  logPath: string,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  const installScript = path.join(paths.root, 'install-scoop.ps1');
  onProgress?.('Скачивание установщика Scoop…');
  await runPowerShell(
    `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ` +
      `$ProgressPreference='SilentlyContinue'; ` +
      `Invoke-WebRequest -Uri 'https://get.scoop.sh' -OutFile '${psPath(installScript)}' -UseBasicParsing`,
    120000,
  );
  onProgress?.('Установка Scoop через официальный скрипт…');
  await runPowerShell(
    `$ErrorActionPreference='Continue'; ` +
      `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force; ` +
      `& '${psPath(installScript)}' ` +
      `-ScoopDir '${psPath(paths.scoop)}' ` +
      `-ScoopGlobalDir '${psPath(paths.scoopGlobal)}' ` +
      `-RunAsAdmin:$false *>&1 | Tee-Object -FilePath '${psPath(logPath)}' -Append`,
    300000,
    { SCOOP: paths.scoop, SCOOP_GLOBAL: paths.scoopGlobal },
  );
  return (await testScoop()).ok;
}

async function bootstrapScoop(onProgress?: (msg: string) => void): Promise<RuntimeToolStatus> {
  onProgress?.('Установка Scoop…');
  const existing = await testScoop();
  if (existing.ok) return 'ok';

  const paths = getRuntimePaths();
  fs.mkdirSync(paths.scoop, { recursive: true });
  fs.mkdirSync(paths.scoopGlobal, { recursive: true });

  const logPath = path.join(getAppDataDir(), 'bootstrap-scoop.log');
  const asAdmin = await isRunningAsAdmin();

  if (asAdmin) {
    onProgress?.('GetBox запущен от администратора — используем zip-установку Scoop…');
  }

  try {
    // Zip install has no admin restriction — always try first
    if (await bootstrapScoopFromZip(paths, logPath, onProgress)) return 'ok';

    // Official installer refuses elevated sessions — skip when admin
    if (!asAdmin && (await bootstrapScoopFromOfficialInstaller(paths, logPath, onProgress))) {
      return 'ok';
    }

    return (await testScoop()).ok ? 'ok' : 'fail';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GetBox] Scoop bootstrap failed:', msg);
    try {
      fs.appendFileSync(logPath, `\n[error] ${msg}\n`);
    } catch {
      // ignore log write errors
    }
    return (await testScoop()).ok ? 'ok' : 'fail';
  }
}

async function bootstrapWinget(onProgress?: (msg: string) => void): Promise<RuntimeToolStatus> {
  onProgress?.('Проверка winget…');
  const existing = await testWinget();
  if (existing.ok) return 'ok';

  onProgress?.('winget не найден — попытка установки App Installer…');
  const wingetDir = path.join(getRuntimeDir(), 'winget');
  fs.mkdirSync(wingetDir, { recursive: true });

  try {
    const msixUrl =
      'https://aka.ms/get-appinstaller';
    onProgress?.('Скачивание Microsoft App Installer…');
    await runPowerShell(
      `$url='${msixUrl}'; $out='${wingetDir.replace(/\\/g, '\\\\')}\\AppInstaller.msixbundle'; ` +
        `Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing; ` +
        `Add-AppxPackage -Path $out -ErrorAction SilentlyContinue`,
      180000,
    );
    const check = await testWinget();
    if (check.ok) return 'ok';
    return 'fail';
  } catch {
    return 'fail';
  }
}

export async function bootstrapChocolateyWithUAC(onProgress?: (msg: string) => void): Promise<RuntimeToolStatus> {
  onProgress?.('Установка Chocolatey (UAC)…');
  const existing = await testChocolatey();
  if (existing.ok) return 'ok';

  const installScript = `
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  `;
  const scriptPath = path.join(getRuntimeDir(), 'install-choco.ps1');
  fs.mkdirSync(getRuntimeDir(), { recursive: true });
  fs.writeFileSync(scriptPath, installScript);

  try {
    await runPowerShell(
      `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList ` +
        `'-NoProfile -ExecutionPolicy Bypass -File \\"${scriptPath.replace(/\\/g, '\\\\')}\\"'`,
      600000,
    );
    const check = await testChocolatey();
    return check.ok ? 'ok' : 'fail';
  } catch {
    return 'skipped';
  }
}

export type BootstrapProgressCallback = (msg: string) => void;

export async function bootstrapRuntime(
  onProgress?: BootstrapProgressCallback,
  skipChocolatey = true,
): Promise<RuntimeState> {
  const state = loadRuntimeState();
  const messages: Record<string, string> = { ...(state.messages ?? {}) };

  if (state.winget !== 'ok' && state.winget !== 'skipped') {
    state.winget = await bootstrapWinget(onProgress);
    messages.winget = state.winget === 'ok' ? 'Готов' : 'Не найден (нужен Windows 10/11 App Installer)';
    saveRuntimeState({ ...state, messages });
  }

  if (state.scoop !== 'ok' && state.scoop !== 'skipped') {
    state.scoop = await bootstrapScoop(onProgress);
    messages.scoop = state.scoop === 'ok' ? 'Готов' : 'Не удалось — нажмите «Повторить» (не запускайте GetBox от администратора)';
    saveRuntimeState({ ...state, messages });
  }

  if (!skipChocolatey && state.chocolatey !== 'ok' && state.chocolatey !== 'skipped') {
    state.chocolatey = await bootstrapChocolateyWithUAC(onProgress);
    messages.chocolatey = state.chocolatey === 'ok' ? 'Готов' : 'Пропущен';
    state.chocoUacPending = false;
    saveRuntimeState({ ...state, messages });
  } else if (skipChocolatey && state.chocolatey === 'pending') {
    state.chocolatey = 'pending';
    state.chocoUacPending = true;
    messages.chocolatey = 'Ожидает разрешения UAC';
    saveRuntimeState({ ...state, messages, chocoUacPending: true });
  }

  if (state.scoop !== 'pending' && state.winget !== 'pending' &&
      (state.chocolatey !== 'pending' || state.chocoUacPending)) {
    state.completedAt = state.completedAt ?? Date.now();
  }

  saveRuntimeState({ ...state, messages });
  return loadRuntimeState();
}

export async function retryBootstrap(onProgress?: BootstrapProgressCallback): Promise<RuntimeState> {
  const prev = loadRuntimeState();
  saveRuntimeState({
    scoop: 'pending',
    winget: prev.winget === 'ok' ? 'ok' : 'pending',
    chocolatey:
      prev.chocolatey === 'ok' ? 'ok' : prev.chocolatey === 'skipped' ? 'skipped' : 'pending',
    chocoUacPending: prev.chocolatey === 'ok' || prev.chocolatey === 'skipped' ? false : prev.chocoUacPending,
    completedAt: undefined,
    messages: prev.messages,
  });
  return bootstrapRuntime(onProgress, true);
}

export function shouldRetryBootstrap(): boolean {
  const state = loadRuntimeState();
  if (state.scoop === 'fail' || state.winget === 'fail') return true;
  return !isBootstrapComplete();
}

export function skipChocolatey(): RuntimeState {
  const state = loadRuntimeState();
  state.chocolatey = 'skipped';
  state.chocoUacPending = false;
  state.messages = { ...(state.messages ?? {}), chocolatey: 'Пропущен пользователем' };
  if (state.scoop !== 'pending' && state.winget !== 'pending') {
    state.completedAt = state.completedAt ?? Date.now();
  }
  saveRuntimeState(state);
  return loadRuntimeState();
}

export async function approveChocolatey(onProgress?: BootstrapProgressCallback): Promise<RuntimeState> {
  const state = loadRuntimeState();
  state.chocolatey = await bootstrapChocolateyWithUAC(onProgress);
  state.chocoUacPending = false;
  state.messages = {
    ...(state.messages ?? {}),
    chocolatey: state.chocolatey === 'ok' ? 'Готов' : state.chocolatey === 'skipped' ? 'Пропущен' : 'Ошибка установки',
  };
  if (state.scoop !== 'pending' && state.winget !== 'pending') {
    state.completedAt = state.completedAt ?? Date.now();
  }
  saveRuntimeState(state);
  return loadRuntimeState();
}

export { testScoop, testWinget, testChocolatey, runCmd };
