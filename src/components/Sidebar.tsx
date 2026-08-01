import { useI18n } from '../i18n/I18nContext';
import { categoryLabel } from '../i18n/helpers';
import type { ViewMode } from '../types';
import { IconCatalog, IconSettings, IconRefresh } from './Icons';
import logoUrl from '../../data/logo.svg';

interface ProviderInfo {
  id: string;
  displayName: string;
  ok: boolean;
  version?: string;
  message?: string;
}

interface SidebarProps {
  view: ViewMode;
  categories: Record<string, string>;
  categoryCounts: Record<string, number>;
  providers: ProviderInfo[];
  enabledProviderIds: string[];
  bootstrapRunning?: boolean;
  onNavigate: (view: ViewMode, category?: string) => void;
  onRefresh: () => void;
  selectedCategory?: string;
}

export function Sidebar({
  view,
  categories,
  categoryCounts,
  providers,
  enabledProviderIds,
  bootstrapRunning,
  onNavigate,
  onRefresh,
  selectedCategory,
}: SidebarProps) {
  const { t } = useI18n();

  function providerStatusLabel(p: ProviderInfo): string | undefined {
    if (p.ok && p.version) return p.version;
    if (!p.ok && bootstrapRunning && p.id !== 'catalog') return t.bootstrap.configuring;
    if (!p.ok && p.message) return t.provider.unavailable;
    return undefined;
  }

  const visibleProviders = providers.filter((p) => enabledProviderIds.includes(p.id));
  const browsing = view === 'catalog';
  const totalCount = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-mark" src={logoUrl} alt="" width={30} height={30} />
        <div>
          <h1>GetBox</h1>
          <p>{t.brandSubtitle}</p>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-title">{t.nav.categories}</div>

        <button
          className={`nav-item${browsing && !selectedCategory ? ' active' : ''}`}
          onClick={() => onNavigate('catalog')}
        >
          <IconCatalog size={16} className="nav-icon" />
          <span className="nav-label">{t.nav.all}</span>
          <span className="nav-count mono">{totalCount}</span>
        </button>

        {Object.entries(categories)
          .filter(([id]) => (categoryCounts[id] ?? 0) > 0)
          .map(([id, label]) => (
            <button
              key={id}
              className={`nav-item nav-item--sub${browsing && selectedCategory === id ? ' active' : ''}`}
              onClick={() => onNavigate('catalog', id)}
            >
              <span className="nav-label">{categoryLabel(t, id, label)}</span>
              <span className="nav-count mono">{categoryCounts[id]}</span>
            </button>
          ))}

        <div className="nav-section-title">{t.nav.system}</div>
        <button
          className={`nav-item${view === 'settings' ? ' active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <IconSettings size={16} className="nav-icon" />
          <span className="nav-label">{t.nav.settings}</span>
        </button>
        <button className="nav-item nav-item--refresh" onClick={onRefresh}>
          <IconRefresh size={16} className="nav-icon" />
          <span className="nav-label">{t.nav.refresh}</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="nav-section-title">{t.nav.providers}</div>
        {visibleProviders.map((p) => {
          const state = p.ok ? 'ok' : bootstrapRunning && p.id !== 'catalog' ? 'pending' : 'fail';
          const statusLabel = providerStatusLabel(p);
          return (
            <div key={p.id} className={`provider-status ${state}`}>
              <span className={`status-dot ${state}`} />
              <span className="provider-label">{p.displayName}</span>
              {statusLabel && (
                <span className={`provider-version mono${state === 'pending' ? ' pending' : ''}`}>
                  {statusLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
