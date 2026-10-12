import { useI18n } from '../i18n/I18nContext';
import type { ListView } from '../types';

export const LIST_VIEWS: ListView[] = ['cards', 'list', 'table', 'tiles'];

function ViewGlyph({ view }: { view: ListView }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true } as const;
  switch (view) {
    case 'cards':
      return <svg {...common}><rect x="1" y="1" width="6" height="6" rx="1" /><rect x="9" y="1" width="6" height="6" rx="1" /><rect x="1" y="9" width="6" height="6" rx="1" /><rect x="9" y="9" width="6" height="6" rx="1" /></svg>;
    case 'list':
      return <svg {...common}><rect x="1" y="2" width="4" height="4" rx="1" /><rect x="7" y="3" width="8" height="2" rx="1" /><rect x="1" y="10" width="4" height="4" rx="1" /><rect x="7" y="11" width="8" height="2" rx="1" /></svg>;
    case 'table':
      return <svg {...common}><rect x="1" y="2" width="14" height="2" rx="1" /><rect x="1" y="7" width="14" height="2" rx="1" /><rect x="1" y="12" width="14" height="2" rx="1" /></svg>;
    case 'tiles':
      return <svg {...common}><rect x="1" y="1" width="4" height="4" rx="1" /><rect x="6" y="1" width="4" height="4" rx="1" /><rect x="11" y="1" width="4" height="4" rx="1" /><rect x="1" y="6" width="4" height="4" rx="1" /><rect x="6" y="6" width="4" height="4" rx="1" /><rect x="11" y="6" width="4" height="4" rx="1" /><rect x="1" y="11" width="4" height="4" rx="1" /><rect x="6" y="11" width="4" height="4" rx="1" /><rect x="11" y="11" width="4" height="4" rx="1" /></svg>;
  }
}

interface ViewSwitcherProps {
  value: ListView;
  onChange: (view: ListView) => void;
  /** Show text labels next to the glyphs (settings page). */
  labelled?: boolean;
}

export function ViewSwitcher({ value, onChange, labelled }: ViewSwitcherProps) {
  const { t } = useI18n();
  return (
    <div className={`view-switch${labelled ? ' view-switch--labelled' : ''}`} role="group" aria-label={t.views.label}>
      {LIST_VIEWS.map((v) => (
        <button
          key={v}
          type="button"
          className={`view-switch-btn${value === v ? ' active' : ''}`}
          aria-pressed={value === v}
          title={t.views[v]}
          aria-label={labelled ? undefined : t.views[v]}
          onClick={() => onChange(v)}
        >
          <ViewGlyph view={v} />
          {labelled && <span>{t.views[v]}</span>}
        </button>
      ))}
    </div>
  );
}
