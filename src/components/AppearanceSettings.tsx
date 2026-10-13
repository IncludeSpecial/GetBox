import { useI18n } from '../i18n/I18nContext';
import type { AppSettings } from '../types';
import { ACCENT_PRESETS, THEMES, UI_SCALES } from '../appearance';
import { ViewSwitcher } from './ViewSwitcher';

interface AppearanceSettingsProps {
  settings: AppSettings;
  onChange: (partial: Partial<AppSettings>) => void | Promise<void>;
}

export function AppearanceSettings({ settings, onChange }: AppearanceSettingsProps) {
  const { t } = useI18n();
  const accentLocked = settings.theme === 'contrast';

  return (
    <section className="appearance" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="page-title">{t.appearance.title}</h2>

      <h3 className="appearance-label">{t.appearance.theme}</h3>
      <div className="theme-gallery" role="radiogroup" aria-label={t.appearance.theme}>
        {THEMES.map((th) => {
          const active = settings.theme === th.id;
          return (
            <button
              key={th.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`theme-card${active ? ' active' : ''}`}
              onClick={() => void onChange({ theme: th.id })}
            >
              <span
                className={`theme-preview theme-preview--${th.id}`}
                style={{ background: th.bg, color: th.text }}
                aria-hidden
              >
                <span className="theme-preview-bar" style={{ background: th.surface }} />
                <span className="theme-preview-row">
                  <span style={{ background: th.surface }} />
                  <span style={{ background: th.surface }} />
                  <span style={{ background: th.surface }} />
                </span>
                <span className="theme-preview-cta" style={{ background: th.accent }} />
              </span>
              <span className="theme-card-name">{t.appearance.themes[th.id]}</span>
              <span className="theme-card-hint">{t.appearance.themeHints[th.id]}</span>
            </button>
          );
        })}
      </div>

      <h3 className="appearance-label">{t.appearance.accent}</h3>
      <div className="accent-row">
        <button
          type="button"
          className={`accent-swatch accent-swatch--auto${!settings.accent ? ' active' : ''}`}
          aria-pressed={!settings.accent}
          onClick={() => void onChange({ accent: undefined })}
          disabled={accentLocked}
        >
          {t.appearance.accentAuto}
        </button>
        {ACCENT_PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            className={`accent-swatch${settings.accent === hex ? ' active' : ''}`}
            style={{ background: hex }}
            aria-label={hex}
            aria-pressed={settings.accent === hex}
            onClick={() => void onChange({ accent: hex })}
            disabled={accentLocked}
          />
        ))}
        <label className="accent-custom">
          <input
            type="color"
            value={settings.accent ?? '#66c0f4'}
            onChange={(e) => void onChange({ accent: e.target.value })}
            disabled={accentLocked}
          />
          {t.appearance.accentCustom}
        </label>
        {accentLocked && <span className="appearance-note">{t.appearance.accentLocked}</span>}
      </div>

      <div className="appearance-grid">
        <div>
          <h3 className="appearance-label">{t.appearance.listView}</h3>
          <ViewSwitcher value={settings.listView} onChange={(v) => void onChange({ listView: v })} labelled />
        </div>
        <div>
          <h3 className="appearance-label">{t.appearance.scale}</h3>
          <div className="view-switch view-switch--labelled" role="group" aria-label={t.appearance.scale}>
            {UI_SCALES.map((sc) => (
              <button
                key={sc}
                type="button"
                className={`view-switch-btn${settings.uiScale === sc ? ' active' : ''}`}
                aria-pressed={settings.uiScale === sc}
                onClick={() => void onChange({ uiScale: sc })}
              >
                <span className="mono">{Math.round(sc * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
