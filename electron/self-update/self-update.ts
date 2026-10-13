import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { getAppDataDir } from '../paths.js';
import { getSettings } from '../store/settings.js';
import type { SelfUpdateState } from '../providers/types.js';

const REPO = 'IncludeSpecial/GetBox';
const API = `https://api.github.com/repos/${REPO}/releases`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 20 * 1000;
const ASSET = /^GetBox-(.+)-portable\.exe$/;
/** Release assets are served from github.com and redirect to GitHub's object storage. */
const ALLOWED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

interface GhAsset { name: string; browser_download_url: string; size: number; digest?: string | null }
interface GhRelease { tag_name: string; name: string; body: string; html_url: string; prerelease: boolean; draft: boolean; assets: GhAsset[] }

/** Compare dotted versions with an optional -prerelease suffix; a release beats its prereleases. */
export function compareVersions(a: string, b: string): number {
  const [ma, pa = ''] = a.replace(/^v/, '').split('-', 2);
  const [mb, pb = ''] = b.replace(/^v/, '').split('-', 2);
  const na = ma.split('.').map(Number), nb = mb.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return Math.sign(d);
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

/** Picks the newest release for the channel that ships a portable exe. */
export function pickRelease(releases: GhRelease[], channel: 'stable' | 'beta'): { release: GhRelease; asset: GhAsset; version: string } | null {
  let best: { release: GhRelease; asset: GhAsset; version: string } | null = null;
  for (const release of releases) {
    if (release.draft || (release.prerelease && channel !== 'beta')) continue;
    const asset = release.assets.find((a) => ASSET.test(a.name));
    if (!asset) continue;
    const version = release.tag_name.replace(/^v/, '');
    if (!best || compareVersions(version, best.version) > 0) best = { release, asset, version };
  }
  return best;
}

/** The exe this app was started from; only set for electron-builder portable builds. */
function portableExe(): string | undefined {
  return process.env.PORTABLE_EXECUTABLE_FILE || undefined;
}

function updatesDir(): string {
  return path.join(getAppDataDir(), 'self-update');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GetBox' } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'GetBox' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function assertAllowed(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`Недопустимый адрес загрузки: ${u.hostname}`);
}

class SelfUpdater extends EventEmitter {
  private state: SelfUpdateState = { status: 'idle', current: app.getVersion(), canApply: Boolean(portableExe()) };
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  getState(): SelfUpdateState {
    return { ...this.state };
  }

  private set(patch: Partial<SelfUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('changed', this.getState());
  }

  /** Looks for a newer release and, when allowed, downloads and verifies it in the background. */
  async check(manual = false): Promise<SelfUpdateState> {
    if (this.busy || this.state.status === 'ready') return this.getState();
    this.busy = true;
    this.set({ status: 'checking', error: undefined });
    try {
      const { appUpdateChannel } = getSettings();
      const releases = await fetchJson<GhRelease[]>(`${API}?per_page=15`);
      const found = pickRelease(releases, appUpdateChannel);
      if (!found || compareVersions(found.version, this.state.current) <= 0) {
        this.set({ status: 'idle', latest: found?.version, checkedAt: Date.now() });
        return this.getState();
      }
      this.set({
        status: 'available', latest: found.version, notes: found.release.body, releaseUrl: found.release.html_url, checkedAt: Date.now(),
      });
      if (this.state.canApply && (manual || getSettings().autoUpdateApp)) await this.download(found.release, found.asset);
    } catch (err) {
      // A failed download keeps the update visible as «available» so it can be retried.
      const status = this.state.status === 'downloading' || this.state.status === 'available' ? 'available' : 'error';
      this.set({ status, progress: undefined, error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.busy = false;
    }
    return this.getState();
  }

  /** Downloads the portable exe and checks it against the .sha256 file (or GitHub's digest) of the release. */
  private async download(release: GhRelease, asset: GhAsset): Promise<void> {
    const shaAsset = release.assets.find((a) => a.name === `${asset.name}.sha256`);
    let expected = shaAsset ? (await fetchText(shaAsset.browser_download_url)).trim().split(/\s+/)[0].toLowerCase() : '';
    if (!expected && asset.digest?.startsWith('sha256:')) expected = asset.digest.slice(7).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error('У релиза нет контрольной суммы SHA256 — обновление не скачано');

    assertAllowed(asset.browser_download_url);
    fs.mkdirSync(updatesDir(), { recursive: true });
    const target = path.join(updatesDir(), asset.name);
    const part = target + '.part';
    this.set({ status: 'downloading', progress: 0 });

    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'GetBox' }, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Загрузка: HTTP ${res.status}`);
    assertAllowed(res.url);
    const total = Number(res.headers.get('content-length')) || asset.size;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let done = 0, lastEmit = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      hash.update(value);
      done += value.length;
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      if (Date.now() - lastEmit > 300) {
        lastEmit = Date.now();
        this.set({ progress: total ? Math.min(99, Math.round((done / total) * 100)) : undefined });
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    const actual = hash.digest('hex');
    if (actual !== expected) {
      fs.rmSync(part, { force: true });
      throw new Error(`SHA256 не совпал: ${actual}`);
    }
    fs.renameSync(part, target);
    this.set({ status: 'ready', progress: 100, downloadedPath: target });
  }

  /**
   * Swaps the running portable exe for the downloaded one. The exe is locked while
   * this process runs, so a detached script waits for it to exit, copies the new
   * file over and (optionally) starts it again.
   */
  apply(restart: boolean): boolean {
    const exe = portableExe();
    const next = this.state.downloadedPath;
    if (!exe || !next || this.state.status !== 'ready' || !fs.existsSync(next)) return false;
    const script = path.join(os.tmpdir(), `getbox-update-${process.pid}.cmd`);
    const q = (p: string) => `"${p.replace(/"/g, '')}"`;
    fs.writeFileSync(script, [
      '@echo off',
      ':wait',
      `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
      // No write access to the exe's folder: bring the old version back instead of leaving GetBox closed.
      `copy /Y ${q(next)} ${q(exe)} >nul || (${restart ? `start "" ${q(exe)} & ` : ''}goto end)`,
      `del ${q(next)} >nul 2>&1`,
      restart ? `start "" ${q(exe)}` : 'rem no restart',
      ':end',
      'del "%~f0"',
    ].join('\r\n'));
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  }

  /** «При выходе»: remember the choice and swap the exe when the app closes. */
  setApplyOnQuit(on: boolean): void {
    this.set({ applyOnQuit: on });
  }

  onQuit(): void {
    if (this.state.applyOnQuit) this.apply(false);
  }

  schedule(atLaunch = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.check().catch(() => {});
      this.schedule();
    }, atLaunch ? FIRST_CHECK_DELAY_MS : CHECK_INTERVAL_MS);
  }
}

export const selfUpdater = new SelfUpdater();
