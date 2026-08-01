import fs from 'node:fs';
import path from 'node:path';
import type { Package } from './providers/types.js';
import { getIndexPath } from './paths.js';
import { getEnabledProviders } from './providers/registry.js';
import { getSettings } from './store/settings.js';

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /chrome|firefox|edge|brave|opera|browser|safari/i, category: 'browsers' },
  { pattern: /git|node|python|java|docker|vscode|visual|studio|code|dev|npm|rust|go-lang|golang/i, category: 'dev' },
  { pattern: /game|steam|epic|minecraft|unity|unreal/i, category: 'games' },
  { pattern: /vlc|spotify|obs|discord|telegram|media|video|audio|music/i, category: 'media' },
  { pattern: /office|word|excel|libre|writer|calc/i, category: 'office' },
  { pattern: /keepass|password|security|vpn|antivirus|malware/i, category: 'security' },
  { pattern: /zip|7z|rar|archiver|everything|putty|util|tool/i, category: 'utils' },
];

export function categorizePackage(pkg: Package): string {
  const haystack = `${pkg.id} ${pkg.name} ${pkg.description ?? ''}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return pkg.category ?? 'other';
}

export function loadIndexFromDisk(): Package[] {
  try {
    const p = getIndexPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Package[];
  } catch {
    return [];
  }
}

export function saveIndexToDisk(packages: Package[]): void {
  const p = getIndexPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(packages, null, 2));
}

export function isIndexEmptyOrSmall(): boolean {
  const index = loadIndexFromDisk();
  return index.length < 50;
}

export type IndexProgressCallback = (msg: string) => void;

export async function buildIndex(onProgress?: IndexProgressCallback): Promise<{ ok: boolean; count: number; message?: string }> {
  const settings = getSettings();
  const order = ['catalog', 'scoop', 'winget', 'chocolatey'];
  const enabled = settings.enabledProviders;
  const sortedIds = [
    ...order.filter((id) => enabled.includes(id)),
    ...enabled.filter((id) => !order.includes(id)),
  ];
  const providers = getEnabledProviders(sortedIds);
  const allPackages: Package[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    onProgress?.(`Индексация: ${provider.displayName}...`);
    const status = await provider.available();
    if (!status.ok) continue;

    try {
      const listFn = provider.listAll ?? (() => provider.search(''));
      const pkgs = await listFn.call(provider);
      for (const pkg of pkgs) {
        const key = `${pkg.provider}:${pkg.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allPackages.push({ ...pkg, category: categorizePackage(pkg) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onProgress?.(`Ошибка ${provider.displayName}: ${msg}`);
    }
  }

  saveIndexToDisk(allPackages);
  onProgress?.(`Индекс собран: ${allPackages.length} пакетов`);
  return { ok: true, count: allPackages.length };
}
