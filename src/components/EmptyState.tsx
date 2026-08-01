import { useI18n } from '../i18n/I18nContext';
import type { ViewMode } from '../types';
import { IconCatalog, IconSearch, IconStar, IconCheck, IconHome } from './Icons';

interface EmptyStateProps {
  view: ViewMode;
}

const VIEW_ICONS: Record<string, typeof IconHome> = {
  home: IconHome,
  favorites: IconStar,
  installed: IconCheck,
  recommended: IconStar,
  search: IconSearch,
  catalog: IconCatalog,
};

export function EmptyState({ view }: EmptyStateProps) {
  const { t } = useI18n();
  const key = view in t.empty ? view : 'catalog';
  const msg = t.empty[key as keyof typeof t.empty];
  const Icon = VIEW_ICONS[key] ?? IconCatalog;

  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={32} />
      </div>
      <h3>{msg.title}</h3>
      <p>{msg.text}</p>
    </div>
  );
}
