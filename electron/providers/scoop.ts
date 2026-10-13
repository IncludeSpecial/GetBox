import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import type {
  InstallOptions,
  InstallResult,
  Package,
  PackageDetails,
  PackageProvider,
  ProviderStatus,
  UpdateInfo,
} from './types.js';
import { getRuntimePaths, testScoop, loadRuntimeState } from '../bootstrap/runtime.js';
import { runCliWithProgress } from './cli-progress.js';
import { cleanQuery, shellCommand } from './shell-args.js';
import { classifyError } from './install-errors.js';
import { parseScoopStatus } from '../updates/parse.js';
import { getAppDataDir } from '../paths.js';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const INSTALLED_CACHE_TTL = 20 * 60 * 1000;
let installedCache: { data: Set<string>; at: number } | null = null;

function getScoopExe(): string | null {
  const shim = getRuntimePaths().scoopShim;
  if (fs.existsSync(shim)) return shim;
  return null;
}

async function resolveScoopExe(): Promise<{ exe: string; env?: Record<string, string> } | null> {
  const bundled = getScoopExe();
  const paths = getRuntimePaths();
  const bundledEnv = { SCOOP: paths.scoop, SCOOP_GLOBAL: paths.scoopGlobal };
  if (bundled) return { exe: bundled, env: bundledEnv };

  const check = await testScoop();
  if (check.ok) return { exe: 'scoop' };

  return null;
}

async function runScoop(args: string[], timeout = 60000): Promise<string> {
  const resolved = await resolveScoopExe();
  if (!resolved) throw new Error('Scoop runtime not ready');
  const { stdout } = await execFileAsync(shellCommand(resolved.exe, args), [], {
    timeout,
    windowsHide: true,
    shell: true,
    env: { ...process.env, ...resolved.env },
  });
  return stdout;
}

function installedCachePath(): string {
  return path.join(getAppDataDir(), 'installed-scoop.json');
}

const MANIFEST_INDEX_TTL = 60 * 60 * 1000;
let manifestIndex: { paths: Map<string, string>; at: number } | null = null;

function scoopRoots(): string[] {
  const roots = [getRuntimePaths().scoop];
  const home = process.env.USERPROFILE;
  if (home) roots.push(path.join(home, 'scoop'));
  if (process.env.SCOOP) roots.push(process.env.SCOOP);
  return [...new Set(roots)];
}

/**
 * Bucket manifests carry the description and homepage that `scoop search` drops.
 * They are plain files on disk, so the whole index can be described offline.
 */
function getManifestIndex(): Map<string, string> {
  if (manifestIndex && Date.now() - manifestIndex.at < MANIFEST_INDEX_TTL) {
    return manifestIndex.paths;
  }
  const paths = new Map<string, string>();
  for (const root of scoopRoots()) {
    const bucketsDir = path.join(root, 'buckets');
    if (!fs.existsSync(bucketsDir)) continue;
    for (const bucket of fs.readdirSync(bucketsDir)) {
      // Newer scoop keeps manifests one level deeper, in <bucket>/bucket/.
      for (const dir of [path.join(bucketsDir, bucket, 'bucket'), path.join(bucketsDir, bucket)]) {
        if (!fs.existsSync(dir)) continue;
        let files: string[];
        try {
          files = fs.readdirSync(dir);
        } catch {
          continue;
        }
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const name = path.basename(file, '.json').toLowerCase();
          if (!paths.has(name)) paths.set(name, path.join(dir, file));
        }
      }
    }
  }
  manifestIndex = { paths, at: Date.now() };
  return paths;
}

function readManifest(packageId: string): PackageDetails | undefined {
  const file = getManifestIndex().get(packageId.split('/').pop()!.toLowerCase());
  if (!file) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      description?: string | string[];
      homepage?: string;
    };
    const description = Array.isArray(raw.description) ? raw.description.join(' ') : raw.description;
    if (!description && !raw.homepage) return undefined;
    return { description: description?.trim(), homepage: raw.homepage };
  } catch {
    return undefined;
  }
}

function loadInstalledFromDisk(): Set<string> | null {
  try {
    const p = installedCachePath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { items: string[]; at: number };
    if (Date.now() - raw.at > INSTALLED_CACHE_TTL) return null;
    return new Set(raw.items);
  } catch {
    return null;
  }
}

function saveInstalledToDisk(items: Set<string>): void {
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(
    installedCachePath(),
    JSON.stringify({ items: [...items], at: Date.now() }),
  );
}

export class ScoopProvider implements PackageProvider {
  id = 'scoop';
  displayName = 'Scoop';

  async available(): Promise<ProviderStatus> {
    const check = await testScoop();
    if (check.ok) {
      const suffix = check.bundled === false ? ' (системный)' : '';
      return { ok: true, version: check.version ? `${check.version}${suffix}` : undefined };
    }
    const state = loadRuntimeState();
    if (state.scoop === 'pending') {
      return { ok: false, message: 'Scoop настраивается…' };
    }
    return {
      ok: false,
      message: state.messages?.scoop ?? 'Не удалось установить Scoop. Нажмите «Повторить настройку».',
    };
  }

  async search(query: string): Promise<Package[]> {
    if (!(await this.available()).ok) return [];
    try {
      const q = cleanQuery(query);
      if (!q) return [];
      const out = await runScoop(['search', q], 30000);
      return this.parseSearchOutput(out);
    } catch {
      return [];
    }
  }

  parseSearchOutput(out: string): Package[] {
    const lines = out.split('\n').filter((l) => l.trim());
    const results: Package[] = [];
    let headerPassed = false;
    for (const line of lines) {
      if (line.includes('Name') && line.includes('Version')) {
        headerPassed = true;
        continue;
      }
      if (!headerPassed || line.startsWith('-') || line.startsWith('Results')) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      results.push({
        id: parts[0],
        provider: this.id,
        name: parts[0],
        version: parts[1],
        sourceUrl: parts[parts.length - 1] || 'main',
      });
    }
    return results;
  }

  async listAll(): Promise<Package[]> {
    if (!(await this.available()).ok) return [];
    try {
      const packages = this.parseSearchOutput(await runScoop(['search', ''], 120000));
      return packages.map((pkg) => {
        const details = readManifest(pkg.id);
        return details?.description ? { ...pkg, description: details.description } : pkg;
      });
    } catch {
      return [];
    }
  }

  async describe(packageId: string): Promise<PackageDetails | undefined> {
    return readManifest(packageId);
  }

  async install(packageId: string, opts: InstallOptions): Promise<InstallResult> {
    const args = ['install', packageId];
    if (opts.quiet) args.push('-g');
    return this.run(packageId, args, opts);
  }

  async upgrade(packageId: string, opts: InstallOptions): Promise<InstallResult> {
    return this.run(packageId, ['update', packageId], opts);
  }

  /** Scoop keeps earlier versions on disk until `scoop cleanup`, so a reset switches back offline. */
  async installVersion(packageId: string, version: string, opts: InstallOptions): Promise<InstallResult> {
    return this.run(packageId, ['reset', `${packageId}@${version}`], opts);
  }

  async listUpgrades(): Promise<UpdateInfo[]> {
    if (!(await this.available()).ok) return [];
    const out = await runScoop(['status'], 120000);
    return parseScoopStatus(out).map((u) => ({ ...u, provider: this.id }));
  }

  private async run(packageId: string, args: string[], opts: InstallOptions): Promise<InstallResult> {
    try {
      const resolved = await resolveScoopExe();
      if (!resolved) throw new Error('Scoop runtime not ready');
      const { code, output } = await runCliWithProgress(resolved.exe, args, {
        timeout: 300000,
        env: resolved.env,
        onProgress: opts.onProgress,
        signal: opts.signal,
      });
      installedCache = null;
      if (code !== 0) {
        return { ok: false, errorCode: 'installer', message: `Ошибка установки ${packageId}`, detail: output.slice(-500) };
      }
      return { ok: true, message: `Установлено: ${packageId}`, detail: output.slice(-500) };
    } catch (err) {
      const c = classifyError(err);
      return { ok: false, errorCode: c.code, message: c.code === 'cancelled' ? 'Установка отменена' : `Ошибка установки ${packageId}`, detail: c.detail || c.message };
    }
  }

  async listInstalled(): Promise<Set<string>> {
    if (installedCache && Date.now() - installedCache.at < INSTALLED_CACHE_TTL) {
      return installedCache.data;
    }
    const disk = loadInstalledFromDisk();
    if (disk) {
      installedCache = { data: disk, at: Date.now() };
      return disk;
    }
    if (!(await this.available()).ok) return new Set();
    try {
      const out = await runScoop(['list'], 30000);
      const items = new Set<string>();
      let headerPassed = false;
      for (const line of out.split('\n')) {
        if (line.includes('Name') && line.includes('Version')) {
          headerPassed = true;
          continue;
        }
        if (!headerPassed || line.startsWith('-')) continue;
        const name = line.trim().split(/\s+/)[0];
        if (name) items.add(name);
      }
      installedCache = { data: items, at: Date.now() };
      saveInstalledToDisk(items);
      return items;
    } catch {
      return disk ?? new Set();
    }
  }
}

export function peekScoopInstalledCache(): Set<string> {
  if (installedCache) return installedCache.data;
  return loadInstalledFromDisk() ?? new Set();
}
