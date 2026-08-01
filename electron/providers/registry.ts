import type { PackageProvider } from './types.js';
import { ScoopProvider } from './scoop.js';
import { CatalogProvider } from './catalog.js';
import { WingetProvider } from './winget.js';
import { ChocolateyProvider } from './chocolatey.js';

const providers = new Map<string, PackageProvider>();

export function initProviders(): void {
  providers.set('catalog', new CatalogProvider());
  providers.set('scoop', new ScoopProvider());
  providers.set('winget', new WingetProvider());
  providers.set('chocolatey', new ChocolateyProvider());
}

export function getProvider(id: string): PackageProvider | undefined {
  return providers.get(id);
}

export function getAllProviders(): PackageProvider[] {
  return [...providers.values()];
}

export function getEnabledProviders(enabledIds: string[]): PackageProvider[] {
  return enabledIds
    .map((id) => providers.get(id))
    .filter((p): p is PackageProvider => p !== undefined);
}

export function setCatalogRemoteUrl(url?: string): void {
  const catalog = providers.get('catalog') as CatalogProvider | undefined;
  catalog?.setRemoteUrl(url);
}

export const PROVIDER_IDS = ['catalog', 'scoop', 'winget', 'chocolatey'] as const;
