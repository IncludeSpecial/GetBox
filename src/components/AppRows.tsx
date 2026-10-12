import { memo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { MergedApp, QueueJob } from '../types';
import { packageKey } from '../types';
import { AppCover } from './AppMonogram';
import { AppAction } from './AppAction';
import { IconStar, IconStarFilled } from './Icons';

interface RowHandlers {
  onInstall: (app: MergedApp) => void;
  onRetry?: (app: MergedApp) => void;
  onCancel?: (jobId: string) => void;
  onOpen: (app: MergedApp) => void;
  onToggleFavorite: (app: MergedApp) => void;
}

interface ListRowProps extends RowHandlers {
  app: MergedApp;
  metaLabel?: string;
  reason?: string;
  job?: QueueJob;
}

function FavButton({ app, onToggle }: { app: MergedApp; onToggle: (app: MergedApp) => void }) {
  const { t } = useI18n();
  const label = app.isFavorite ? t.app.unfavorite : t.app.favorite;
  return (
    <button
      type="button"
      className={`row-fav${app.isFavorite ? ' active' : ''}`}
      onClick={(e) => { e.stopPropagation(); onToggle(app); }}
      title={label}
      aria-label={label}
      aria-pressed={app.isFavorite}
    >
      {app.isFavorite ? <IconStarFilled size={14} /> : <IconStar size={14} />}
    </button>
  );
}

function ListRowInner({ app, metaLabel, reason, job, onInstall, onRetry, onCancel, onOpen, onToggleFavorite }: ListRowProps) {
  const { t } = useI18n();
  const description = app.enrichedDescription ?? app.description;
  return (
    <article className="list-row" onClick={() => onOpen(app)}>
      <AppCover name={app.name} iconUrl={app.iconUrl} size="sm" />
      <div className="list-row-text">
        <div className="list-row-title">
          <span className="list-row-name">{app.name}</span>
          {app.version && <span className="list-row-version mono">{app.version}</span>}
          {app.isInstalled && <span className="badge badge--ok">{t.app.installedBadge}</span>}
        </div>
        {reason ? (
          <div className="list-row-reason">{reason}</div>
        ) : (
          description && <div className="list-row-desc">{description}</div>
        )}
      </div>
      {metaLabel && <span className="list-row-meta">{metaLabel}</span>}
      <FavButton app={app} onToggle={onToggleFavorite} />
      <AppAction app={app} job={job} onInstall={onInstall} onRetry={onRetry} onCancel={onCancel} className="row-cta" />
    </article>
  );
}

export const AppListRow = memo(ListRowInner);

interface TableProps extends RowHandlers {
  apps: MergedApp[];
  activeJobs?: Map<string, QueueJob>;
  metaLabel: (app: MergedApp) => string | undefined;
}

/** Dense table for long package lists: one line per app, sortable later. */
export function AppTable({ apps, activeJobs, metaLabel, onInstall, onRetry, onCancel, onOpen, onToggleFavorite }: TableProps) {
  const { t } = useI18n();
  return (
    <table className="app-table">
      <thead>
        <tr>
          <th scope="col" className="app-table-name">{t.views.columns.name}</th>
          <th scope="col">{t.views.columns.version}</th>
          <th scope="col">{t.views.columns.source}</th>
          <th scope="col">{t.views.columns.status}</th>
          <th scope="col"><span className="visually-hidden">{t.views.columns.actions}</span></th>
        </tr>
      </thead>
      <tbody>
        {apps.map((app) => {
          const key = packageKey(app.provider, app.id);
          return (
            <tr key={key} onClick={() => onOpen(app)}>
              <td className="app-table-name">
                <div className="app-table-cell">
                  <AppCover name={app.name} iconUrl={app.iconUrl} size="xs" />
                  <span>{app.name}</span>
                </div>
              </td>
              <td className="mono">{app.version ?? '—'}</td>
              <td className="app-table-meta">{metaLabel(app) ?? '—'}</td>
              <td>{app.isInstalled ? <span className="badge badge--ok">{t.app.installedBadge}</span> : <span className="app-table-dim">—</span>}</td>
              <td>
                <div className="app-table-cell app-table-actions">
                  <FavButton app={app} onToggle={onToggleFavorite} />
                  <AppAction app={app} job={activeJobs?.get(key)} onInstall={onInstall} onRetry={onRetry} onCancel={onCancel} className="row-cta" />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
