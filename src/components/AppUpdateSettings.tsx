import { useI18n } from '../i18n/I18nContext';
import type { AppSettings, SelfUpdateState } from '../types';

interface AppUpdateSettingsProps {
  settings: AppSettings;
  state: SelfUpdateState | null;
  onChange: (partial: Partial<AppSettings>) => void | Promise<void>;
  onShowWhatsNew: () => void;
}

/** Settings → GetBox: version, background self-update and the release channel. */
export function AppUpdateSettings({ settings, state, onChange, onShowWhatsNew }: AppUpdateSettingsProps) {
  const { t } = useI18n();
  const status = !state
    ? ''
    : state.status === 'checking'
      ? t.selfUpdate.checking
      : state.status === 'ready'
        ? `${t.selfUpdate.ready} ${state.latest}`
        : state.status === 'downloading'
          ? `${t.selfUpdate.downloading} ${state.progress ?? 0}%`
          : state.status === 'available'
            ? `${t.selfUpdate.available} ${state.latest}`
            : state.status === 'error'
              ? `${t.selfUpdate.failed}: ${state.error ?? ''}`
              : state.checkedAt
                ? t.selfUpdate.upToDate
                : '';

  return (
    <section className="app-update" aria-labelledby="app-update-title">
      <h2 id="app-update-title" className="page-title">GetBox</h2>
      <div className="setting-row app-update-row">
        <span className="mono">{t.selfUpdate.version} {state?.current ?? ''}</span>
        <span className="app-update-status">{status}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={state?.status === 'checking' || state?.status === 'downloading'}
          onClick={() => void window.getbox.checkSelfUpdate()}
        >
          {t.selfUpdate.check}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onShowWhatsNew}>{t.selfUpdate.currentWhatsNew}</button>
      </div>
      <div className="setting-row">
        <label>
          <input type="checkbox" checked={settings.autoUpdateApp} onChange={(e) => void onChange({ autoUpdateApp: e.target.checked })} />
          {t.selfUpdate.auto}
        </label>
      </div>
      <div className="setting-row setting-row--lang">
        <span>{t.selfUpdate.channel}</span>
        <div className="lang-switch lang-switch--settings" role="group" aria-label={t.selfUpdate.channel}>
          {(['stable', 'beta'] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`lang-btn${settings.appUpdateChannel === c ? ' active' : ''}`}
              aria-pressed={settings.appUpdateChannel === c}
              onClick={() => void onChange({ appUpdateChannel: c })}
            >
              {c === 'stable' ? t.selfUpdate.stable : t.selfUpdate.beta}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
