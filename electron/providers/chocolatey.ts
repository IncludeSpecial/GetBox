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
import { getRuntimePaths, testChocolatey, runCmd } from '../bootstrap/runtime.js';
import { runCliWithProgress } from './cli-progress.js';
import { cleanQuery } from './shell-args.js';
import { classifyError } from './install-errors.js';
import { parseChocoOutdated } from '../updates/parse.js';

const INFO_LABEL = /^\s*(Summary|Description|Software Site|Title)\s*:\s*(.*)$/i;

/**
 * `choco info` prints an indented block per field. Summary is one line and reads
 * better on a card; the Description block is the fallback when there is none.
 */
export function parseInfoOutput(out: string): PackageDetails | undefined {
  const fields: Record<string, string> = {};
  const lines = out.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = INFO_LABEL.exec(lines[i]);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (fields[key]) continue;
    let value = match[2].trim();
    if (key === 'description') {
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim() || INFO_LABEL.test(lines[j])) break;
        value += ' ' + lines[j].trim();
      }
    }
    if (value) fields[key] = value;
  }

  const description = fields.summary || fields.description;
  const homepage = fields['software site'];
  if (!description && !homepage) return undefined;
  return { description: description?.slice(0, 600), homepage };
}

export class ChocolateyProvider implements PackageProvider {
  id = 'chocolatey';
  displayName = 'Chocolatey';

  private chocoExe(): string {
    const bundled = getRuntimePaths().chocolatey;
    if (fs.existsSync(bundled)) return bundled;
    return 'choco';
  }

  async available(): Promise<ProviderStatus> {
    const check = await testChocolatey();
    if (check.ok) return { ok: true, version: check.version };
    return {
      ok: false,
      message: 'Chocolatey не установлен. Разрешите UAC при первом запуске GetBox.',
    };
  }

  async search(query: string): Promise<Package[]> {
    const q = cleanQuery(query);
    if (!q || !(await this.available()).ok) return [];
    try {
      const out = await runCmd(this.chocoExe(), ['search', q, '--limit-output', '--exact=false'], 60000);
      return out
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('|') && !l.includes('Approved'))
        .map((line) => {
          const parts = line.split('|');
          const id = parts[0]?.trim() || line.trim();
          return {
            id,
            provider: this.id,
            name: id,
            version: parts[1]?.trim(),
          };
        })
        .filter((p) => p.id);
    } catch {
      return [];
    }
  }

  async listAll(): Promise<Package[]> {
    return this.search('');
  }

  async describe(packageId: string): Promise<PackageDetails | undefined> {
    if (!(await this.available()).ok) return undefined;
    try {
      return parseInfoOutput(await runCmd(this.chocoExe(), ['info', packageId], 45000));
    } catch {
      return undefined;
    }
  }

  async install(packageId: string, opts: InstallOptions): Promise<InstallResult> {
    const args = ['install', packageId, '-y'];
    if (opts.quiet) args.push('--force');
    return this.run(packageId, args, opts);
  }

  async upgrade(packageId: string, opts: InstallOptions): Promise<InstallResult> {
    return this.run(packageId, ['upgrade', packageId, '-y'], opts);
  }

  async installVersion(packageId: string, version: string, opts: InstallOptions): Promise<InstallResult> {
    return this.run(packageId, ['install', packageId, '--version', version, '--allow-downgrade', '--force', '-y'], opts);
  }

  async listUpgrades(): Promise<UpdateInfo[]> {
    if (!(await this.available()).ok) return [];
    const out = await runCmd(this.chocoExe(), ['outdated', '--limit-output'], 120000);
    return parseChocoOutdated(out).map((u) => ({ ...u, provider: this.id }));
  }

  private async run(packageId: string, args: string[], opts: InstallOptions): Promise<InstallResult> {
    try {
      const { code, output } = await runCliWithProgress(this.chocoExe(), args, {
        timeout: 600000,
        onProgress: opts.onProgress,
        signal: opts.signal,
      });
      if (code !== 0) {
        return { ok: false, errorCode: 'installer', message: `Ошибка choco: ${packageId}`, detail: output.slice(-500) };
      }
      return { ok: true, message: `Установлено: ${packageId}`, detail: output.slice(-500) };
    } catch (err) {
      const c = classifyError(err);
      return { ok: false, errorCode: c.code, message: c.code === 'cancelled' ? 'Установка отменена' : `Ошибка choco: ${packageId}`, detail: c.detail || c.message };
    }
  }

  async listInstalled(): Promise<Set<string>> {
    if (!(await this.available()).ok) return new Set();
    try {
      const out = await runCmd(this.chocoExe(), ['list', '--local-only', '--limit-output'], 60000);
      const items = new Set<string>();
      for (const line of out.split('\n')) {
        const id = line.split('|')[0]?.trim();
        if (id && id !== 'Chocolatey') items.add(id);
      }
      return items;
    } catch {
      return new Set();
    }
  }
}
