import type {
  InstallOptions,
  InstallResult,
  Package,
  PackageDetails,
  PackageProvider,
  ProviderStatus,
} from './types.js';
import { getRuntimePaths, testWinget, runCmd } from '../bootstrap/runtime.js';
import { runCliWithProgress } from './cli-progress.js';

/** winget prints in the Windows display language, so every label needs both forms. */
const FIELD_LABELS: Record<keyof PackageDetails, RegExp> = {
  description: /^(?:description|описание)\s*:\s*(.*)$/i,
  homepage: /^(?:homepage|publisher url|домашняя страница|url-адрес издателя)\s*:\s*(.*)$/i,
  publisher: /^(?:publisher|издатель)\s*:\s*(.*)$/i,
};

const ANY_LABEL = /^\s*[^\s:][^:]{0,40}:\s/;

/** `winget show` wraps long descriptions onto indented continuation lines. */
export function parseShowOutput(out: string): PackageDetails | undefined {
  const details: PackageDetails = {};
  const lines = out.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const [field, pattern] of Object.entries(FIELD_LABELS) as Array<[keyof PackageDetails, RegExp]>) {
      if (details[field]) continue;
      const match = pattern.exec(line);
      if (!match) continue;
      let value = match[1].trim();
      if (field === 'description') {
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (!next.trim() || ANY_LABEL.test(next)) break;
          value += ' ' + next.trim();
        }
      }
      if (value) details[field] = value;
    }
  }

  return details.description || details.homepage ? details : undefined;
}

export class WingetProvider implements PackageProvider {
  id = 'winget';
  displayName = 'winget';

  private wingetExe(): string | null {
    return getRuntimePaths().winget;
  }

  async available(): Promise<ProviderStatus> {
    const check = await testWinget();
    if (check.ok) return { ok: true, version: check.version };
    return {
      ok: false,
      message: 'winget недоступен. Требуется Windows 10/11 с App Installer.',
    };
  }

  async search(query: string): Promise<Package[]> {
    const exe = this.wingetExe();
    if (!exe || !(await this.available()).ok) return [];
    try {
      const out = await runCmd(
        exe,
        ['search', query, '--accept-source-agreements', '--disable-interactivity'],
        60000,
      );
      return this.parseSearchOutput(out);
    } catch {
      return [];
    }
  }

  parseSearchOutput(out: string): Package[] {
    const results: Package[] = [];
    const lines = out.split('\n');
    let inTable = false;
    for (const line of lines) {
      if (line.includes('---')) {
        inTable = true;
        continue;
      }
      if (!inTable || !line.trim()) continue;
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length < 2) continue;
      const name = parts[0];
      const id = parts[1] || name;
      if (id === 'Name' || id === '-----') continue;
      results.push({
        id,
        provider: this.id,
        name: name || id,
        version: parts[2],
      });
    }
    return results;
  }

  async listAll(): Promise<Package[]> {
    return this.search('');
  }

  async describe(packageId: string): Promise<PackageDetails | undefined> {
    const exe = this.wingetExe();
    if (!exe) return undefined;
    try {
      const out = await runCmd(
        exe,
        ['show', '--id', packageId, '-e', '--accept-source-agreements', '--disable-interactivity'],
        30000,
      );
      return parseShowOutput(out);
    } catch {
      return undefined;
    }
  }

  async install(packageId: string, opts: InstallOptions): Promise<InstallResult> {
    const exe = this.wingetExe();
    if (!exe) return { ok: false, message: 'winget недоступен' };
    try {
      const args = [
        'install', '--id', packageId, '-e',
        '--accept-package-agreements', '--accept-source-agreements',
        '--disable-interactivity',
      ];
      if (opts.quiet) args.push('--silent');
      const { code, output } = await runCliWithProgress(exe, args, {
        timeout: 600000,
        onProgress: opts.onProgress,
      });
      if (code !== 0) {
        return { ok: false, message: `Ошибка winget: ${packageId}`, detail: output.slice(-500) };
      }
      return { ok: true, message: `Установлено: ${packageId}`, detail: output.slice(-500) };
    } catch (err) {
      return { ok: false, message: `Ошибка winget: ${packageId}`, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async listInstalled(): Promise<Set<string>> {
    const exe = this.wingetExe();
    if (!exe || !(await this.available()).ok) return new Set();
    try {
      const out = await runCmd(exe, ['list', '--disable-interactivity'], 60000);
      const items = new Set<string>();
      let inTable = false;
      for (const line of out.split('\n')) {
        if (line.includes('---')) {
          inTable = true;
          continue;
        }
        if (!inTable) continue;
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 2 && parts[1]) items.add(parts[1]);
      }
      return items;
    } catch {
      return new Set();
    }
  }
}
