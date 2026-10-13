import type { InstallErrorCode } from './install-errors.js';
export type { InstallErrorCode } from './install-errors.js';

export interface Package {
  id: string;
  provider: string;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  sourceUrl?: string;
  wikiTitle?: string;
  logoSlug?: string;
  simpleSlug?: string;
  features?: string[];
  recommended?: boolean;
}

export interface InstallResult {
  ok: boolean;
  message: string;
  detail?: string;
  errorCode?: InstallErrorCode;
}

export interface ProviderStatus {
  ok: boolean;
  version?: string;
  message?: string;
}

/** Which half of an install a job is in: fetching the payload or running it. */
export type InstallPhase = 'download' | 'install';

export interface InstallProgress {
  phase: InstallPhase;
  /** 0–100 when measurable; omitted while the step is indeterminate. */
  percent?: number;
  bytesDone?: number;
  bytesTotal?: number;
  /** Bytes per second over the last sample window. */
  bytesPerSecond?: number;
  /** Short line worth showing, e.g. the installer's own status output. */
  note?: string;
}

export interface InstallOptions {
  quiet: boolean;
  onProgress?: (progress: InstallProgress) => void;
  /** Abort in-flight download/CLI install. */
  signal?: AbortSignal;
}

/** What a provider can tell us about one package beyond its id and version. */
export interface PackageDetails {
  description?: string;
  homepage?: string;
  publisher?: string;
}

export interface PackageProvider {
  id: string;
  displayName: string;
  search(query: string): Promise<Package[]>;
  install(packageId: string, opts: InstallOptions): Promise<InstallResult>;
  listInstalled(): Promise<Set<string>>;
  available(): Promise<ProviderStatus>;
  listAll?(): Promise<Package[]>;
  /** Description and homepage for a single package, used to fill in index entries. */
  describe?(packageId: string): Promise<PackageDetails | undefined>;
  /** Installed packages that have a newer version in the source. */
  listUpgrades?(): Promise<UpdateInfo[]>;
  upgrade?(packageId: string, opts: InstallOptions): Promise<InstallResult>;
  /** Install an exact version over the current one; used to roll back an update. */
  installVersion?(packageId: string, version: string, opts: InstallOptions): Promise<InstallResult>;
}

export interface UpdateInfo {
  provider: string;
  packageId: string;
  name: string;
  installed: string;
  available: string;
  /** Catalog package id when the update belongs to a curated app, for its name and icon. */
  catalogId?: string;
}

export type JobKind = 'install' | 'upgrade' | 'rollback';

export interface UpdateHistoryEntry {
  id: string;
  kind: 'upgrade' | 'rollback';
  provider: string;
  packageId: string;
  name: string;
  catalogId?: string;
  from?: string;
  to?: string;
  at: number;
  ok: boolean;
  message?: string;
  errorCode?: InstallErrorCode;
}

export interface UpdatesState {
  items: UpdateInfo[];
  checkedAt?: number;
  checking: boolean;
  history: UpdateHistoryEntry[];
}

export interface CuratedEntry {
  id: string;
  name: string;
  description: string;
  features: string[];
  category: string;
  packageId: string;
  provider: string;
  wikiTitle?: string;
  logoSlug?: string;
  /** simple-icons slug when it differs from logoSlug. */
  simpleSlug?: string;
  /** Hand-verified icon source that wins over both icon CDNs. */
  iconUrl?: string;
  /** Vendor site; its favicon is the icon of last resort. */
  homepage?: string;
  recommended?: boolean;
}

/** data/related.json — catalog ids that go together or replace each other. */
export interface RelatedData {
  stacks: Array<{ id: string; apps: string[] }>;
  alternatives: Array<{ id: string; apps: string[] }>;
}

export interface PickEntry {
  packageRef: string;
  why: string;
  tag: string;
  descriptionOverlay?: string;
  /** English editorial copy; falls back to the Russian text when absent. */
  whyEn?: string;
  tagEn?: string;
  descriptionOverlayEn?: string;
}

export interface ProfileEntry {
  id: string;
  name: string;
  description: string;
  packages: Array<{ provider: string; packageId: string }>;
}

export interface MergedApp extends Package {
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

export interface SearchResult {
  results: Package[];
  fromCache: boolean;
  stale: boolean;
}

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
  /** Absent on plain installs. */
  kind?: JobKind;
  fromVersion?: string;
  toVersion?: string;
  catalogId?: string;
}

export interface AppSettings {
  enabledProviders: string[];
  quietInstall: boolean;
  remoteCatalogUrl?: string;
  language: 'ru' | 'en';
  theme: ThemeId;
  /** Custom accent hex; overrides the theme's own accent when set. */
  accent?: string;
  /** Interface zoom factor, 0.9–1.25. */
  uiScale: number;
  listView: ListView;
  /** Look for updates at launch and every 6 hours. */
  autoCheckUpdates: boolean;
  /** Queue every found update without asking. */
  autoInstallUpdates: boolean;
}

export const THEME_IDS = ['classic', 'light', 'oled', 'contrast', 'mica'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const LIST_VIEWS = ['cards', 'list', 'table', 'tiles'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export const APP_NAME = 'GetBox';

export function packageKey(provider: string, packageId: string): string {
  return `${provider}:${packageId}`;
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

function abbrevNorm(name: string): string {
  return normalizeName(name)
    .replace(/visualstudio/g, 'vs')
    .replace(/nodejs/g, 'node');
}

const SHORT_TOKENS = new Set(['git', 'code', 'go', 'npm', 'jdk', 'jre', 'vc', 'vs']);

export function softIsInstalled(appName: string, installedSet: Set<string>): boolean {
  const norm = normalizeName(appName);
  const abbrev = abbrevNorm(appName);
  if (norm.length < 5) return false;
  if (SHORT_TOKENS.has(norm)) return false;

  for (const inst of installedSet) {
    const instNorm = normalizeName(inst);
    if (instNorm.length < 2) continue;
    if (SHORT_TOKENS.has(instNorm) && SHORT_TOKENS.has(norm)) continue;
    const forms = [norm, abbrev];
    for (const form of forms) {
      if (instNorm === form || instNorm.includes(form) || form.includes(instNorm)) {
        return true;
      }
    }
  }
  return false;
}
