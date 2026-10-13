import { useI18n } from '../i18n/I18nContext';
import type { ViewMode } from '../types';

export interface TabDescriptor {
  id: ViewMode;
  label: string;
  count?: number;
  /** Count drawn as an accent badge: something waits for the user. */
  highlight?: boolean;
}

interface TabBarProps {
  tabs: TabDescriptor[];
  active: ViewMode;
  onSelect: (view: ViewMode) => void;
}

export function TabBar({ tabs, active, onSelect }: TabBarProps) {
  const { t } = useI18n();

  return (
    <nav className="tab-bar" aria-label={t.nav.section}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-item${active === tab.id ? ' active' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className={`tab-count mono${tab.highlight ? ' tab-count--badge' : ''}`}>{tab.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
