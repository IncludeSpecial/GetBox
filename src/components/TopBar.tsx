import { useI18n } from '../i18n/I18nContext';
import { localeLabel } from '../i18n/helpers';
import type { Locale } from '../i18n/translations';
import { IconSearch, IconQueue } from './Icons';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  searchBadge?: string;
  queueCount: number;
  queueOpen: boolean;
  /** 0–100 for the job currently running, when it reports measurable progress. */
  queuePercent?: number;
  onToggleQueue: () => void;
  language: Locale;
  onLanguageChange: (lang: Locale) => void;
}

export function TopBar({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  searchBadge,
  queueCount,
  queueOpen,
  queuePercent,
  onToggleQueue,
  language,
  onLanguageChange,
}: TopBarProps) {
  const { t } = useI18n();

  return (
    <header className="topbar">
      <div className="search-box">
        <IconSearch size={16} className="search-icon" />
        <input
          type="search"
          placeholder={t.search.placeholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
        />
      </div>
      {searchBadge && <span className="search-badge mono">{searchBadge}</span>}
      <div className="topbar-actions">
        <div className="lang-switch" role="group" aria-label={t.settings.language}>
          {(['ru', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              className={`lang-btn${language === lang ? ' active' : ''}`}
              onClick={() => onLanguageChange(lang)}
              title={localeLabel(t, lang)}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className={`btn btn-secondary btn-queue${queueOpen ? ' active' : ''}`}
          onClick={onToggleQueue}
        >
          {typeof queuePercent === 'number' && (
            <span className="btn-queue-fill" style={{ width: `${Math.round(queuePercent)}%` }} aria-hidden />
          )}
          <IconQueue size={16} />
          {t.queue.title}
          {queueCount > 0 && (
            <span className="queue-badge mono">
              {typeof queuePercent === 'number' ? `${Math.round(queuePercent)}%` : queueCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
