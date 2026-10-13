import Store from 'electron-store';
import { LIST_VIEWS, THEME_IDS, type AppSettings } from '../providers/types.js';

const DEFAULTS: AppSettings = {
  enabledProviders: ['catalog', 'scoop', 'winget', 'chocolatey'],
  quietInstall: true,
  remoteCatalogUrl: undefined,
  language: 'ru',
  theme: 'classic',
  accent: undefined,
  uiScale: 1,
  listView: 'cards',
  autoCheckUpdates: true,
  autoInstallUpdates: false,
  autoUpdateApp: true,
  appUpdateChannel: 'stable',
  lastSeenVersion: undefined,
};

export const UI_SCALE_MIN = 0.9;
export const UI_SCALE_MAX = 1.25;

const store = new Store<{ settings: AppSettings }>({
  name: 'getbox-settings',
  defaults: { settings: DEFAULTS },
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Drops appearance values the renderer cannot apply, so a bad store never breaks the UI. */
function sanitize(s: AppSettings): AppSettings {
  const theme = (THEME_IDS as readonly string[]).includes(s.theme) ? s.theme : DEFAULTS.theme;
  const listView = (LIST_VIEWS as readonly string[]).includes(s.listView) ? s.listView : DEFAULTS.listView;
  const accent = typeof s.accent === 'string' && HEX_COLOR.test(s.accent) ? s.accent.toLowerCase() : undefined;
  const scale = Number(s.uiScale);
  const uiScale = Number.isFinite(scale)
    ? Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(scale * 100) / 100))
    : DEFAULTS.uiScale;
  return {
    ...s,
    theme,
    listView,
    accent,
    uiScale,
    autoCheckUpdates: typeof s.autoCheckUpdates === 'boolean' ? s.autoCheckUpdates : DEFAULTS.autoCheckUpdates,
    autoInstallUpdates: typeof s.autoInstallUpdates === 'boolean' ? s.autoInstallUpdates : DEFAULTS.autoInstallUpdates,
    autoUpdateApp: typeof s.autoUpdateApp === 'boolean' ? s.autoUpdateApp : DEFAULTS.autoUpdateApp,
    appUpdateChannel: s.appUpdateChannel === 'beta' ? 'beta' : 'stable',
    lastSeenVersion: typeof s.lastSeenVersion === 'string' && /^\d+\.\d+\.\d+/.test(s.lastSeenVersion) ? s.lastSeenVersion : undefined,
  };
}

export function getSettings(): AppSettings {
  // Stores written by older versions lack the appearance keys.
  return sanitize({ ...DEFAULTS, ...store.get('settings') });
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next = sanitize({ ...current, ...partial });
  store.set('settings', next);
  return next;
}
