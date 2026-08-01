import Store from 'electron-store';
import type { AppSettings } from '../providers/types.js';

const store = new Store<{ settings: AppSettings }>({
  name: 'getbox-settings',
  defaults: {
    settings: {
      enabledProviders: ['catalog', 'scoop', 'winget', 'chocolatey'],
      quietInstall: true,
      remoteCatalogUrl: undefined,
      language: 'ru',
    },
  },
});

export function getSettings(): AppSettings {
  return store.get('settings');
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next = { ...current, ...partial };
  store.set('settings', next);
  return next;
}
