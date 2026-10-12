export interface MergedApp {
  id: string;
  provider: string;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  features?: string[];
  wikiTitle?: string;
  logoSlug?: string;
  simpleSlug?: string;
  recommended?: boolean;
  curatedId?: string;
  isInstalled: boolean;
  isFavorite: boolean;
  enrichedDescription?: string;
  iconUrl?: string;
  /** Brand hex used for capsule and banner gradients. */
  brandColor?: string;
  pickTag?: string;
  pickWhy?: string;
  metaPending?: boolean;
}

export type InstallPhase = 'download' | 'install';

export interface InstallProgress {
  phase: InstallPhase;
  /** 0–100 when measurable; omitted while the step is indeterminate. */
  percent?: number;
  bytesDone?: number;
  bytesTotal?: number;
  bytesPerSecond?: number;
  note?: string;
}

export type InstallErrorCode =
  | 'cancelled'
  | 'not_found'
  | 'forbidden'
  | 'network'
  | 'timeout'
  | 'http'
  | 'installer'
  | 'untrusted'
  | 'unknown';

export interface QueueJob {
  id: string;
  packageId: string;
  provider: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  message?: string;
  detail?: string;
  errorCode?: InstallErrorCode;
  progress?: InstallProgress;
}

export interface SearchResult {
  results: Array<{ id: string; provider: string; name: string; description?: string; category?: string }>;
  fromCache: boolean;
  stale: boolean;
}

export interface AppSettings {
  enabledProviders: string[];
  quietInstall: boolean;
  remoteCatalogUrl?: string;
  language: 'ru' | 'en';
  theme: ThemeId;
  accent?: string;
  uiScale: number;
  listView: ListView;
}

export type ThemeId = 'classic' | 'light' | 'oled' | 'contrast' | 'mica';
export type ListView = 'cards' | 'list' | 'table' | 'tiles';

export interface MetaProgress {
  running: boolean;
  total: number;
  done: number;
  current?: string;
  completeness: number;
}

export interface ProfileEntry {
  id: string;
  name: string;
  description: string;
  packages: Array<{ provider: string; packageId: string }>;
}

export type ViewMode =
  | 'home'
  | 'catalog'
  | 'packages'
  | 'recommended'
  | 'favorites'
  | 'installed'
  | 'search'
  | 'settings';

export function packageKey(provider: string, packageId: string): string {
  return `${provider}:${packageId}`;
}

export function listIdentity(apps: MergedApp[]): string {
  if (apps.length === 0) return 'empty';
  return `${apps.length}:${apps[0].provider}:${apps[0].id}:${apps[apps.length - 1].provider}:${apps[apps.length - 1].id}`;
}
