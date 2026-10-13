import { useMemo } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { AppSettings, MergedApp, QueueJob, UpdateHistoryEntry, UpdateInfo, UpdatesState } from '../types';
import { AppCover } from './AppMonogram';

/** Providers that can put back an exact earlier version. */
const ROLLBACK_PROVIDERS = new Set(['winget', 'scoop', 'chocolatey']);

type Key = { provider: string; packageId: string };
const keyOf = (k: Key) => `${k.provider}:${k.packageId.toLowerCase()}`;

interface UpdatesViewProps {
  state: UpdatesState;
  apps: MergedApp[];
  jobs: QueueJob[];
  settings: AppSettings;
  onCheck: () => void;
  onUpgrade: (keys: Key[]) => void;
  onRollback: (historyId: string) => void;
  onClearHistory: () => void;
  onOpen: (app: MergedApp) => void;
  onSettingsChange: (partial: Partial<AppSettings>) => void;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function UpdatesView({
  state, apps, jobs, settings, onCheck, onUpgrade, onRollback, onClearHistory, onOpen, onSettingsChange,
}: UpdatesViewProps) {
  const { t, locale } = useI18n();

  const catalogApps = useMemo(() => {
    const map = new Map<string, MergedApp>();
    for (const a of apps) if (a.provider === 'catalog') map.set(a.id, a);
    return map;
  }, [apps]);

  const activeJobs = useMemo(() => {
    const map = new Map<string, QueueJob>();
    for (const j of jobs) {
      if ((j.kind === 'upgrade' || j.kind === 'rollback') && (j.status === 'pending' || j.status === 'running')) {
        map.set(keyOf(j), j);
      }
    }
    return map;
  }, [jobs]);

  const appFor = (entry: { catalogId?: string }) => (entry.catalogId ? catalogApps.get(entry.catalogId) : undefined);
  const displayName = (entry: { name: string; catalogId?: string }) => appFor(entry)?.name ?? entry.name;

  // Only the newest successful upgrade of a package can be undone, and only once.
  const latestByPackage = useMemo(() => {
    const seen = new Set<string>();
    const latest = new Set<string>();
    for (const h of state.history) {
      const k = keyOf(h);
      if (seen.has(k)) continue;
      seen.add(k);
      latest.add(h.id);
    }
    return latest;
  }, [state.history]);

  const days = useMemo(() => {
    const today = startOfDay(Date.now());
    const groups: Array<{ label: string; entries: UpdateHistoryEntry[] }> = [];
    for (const h of state.history) {
      const day = startOfDay(h.at);
      const label = day === today
        ? t.updates.today
        : day === today - 86400000
          ? t.updates.yesterday
          : new Date(day).toLocaleDateString(locale, { day: 'numeric', month: 'long' });
      const last = groups[groups.length - 1];
      if (last?.label === label) last.entries.push(h);
      else groups.push({ label, entries: [h] });
    }
    return groups;
  }, [state.history, locale, t]);

  const checkedLabel = useMemo(() => {
    if (state.checking) return t.updates.checking;
    if (!state.checkedAt) return t.updates.neverChecked;
    const minutes = Math.round((Date.now() - state.checkedAt) / 60000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const ago = minutes < 60 ? rtf.format(-minutes, 'minute') : rtf.format(-Math.round(minutes / 60), 'hour');
    return `${t.updates.checked} ${ago}`;
  }, [state.checking, state.checkedAt, locale, t]);

  const pending = state.items.filter((u) => !activeJobs.has(keyOf(u)));

  const renderIcon = (entry: { name: string; catalogId?: string }) => {
    const app = appFor(entry);
    return <AppCover name={displayName(entry)} iconUrl={app?.iconUrl} size="sm" />;
  };

  const openable = (entry: { catalogId?: string }) => {
    const app = appFor(entry);
    return app ? () => onOpen(app) : undefined;
  };

  const renderPending = (u: UpdateInfo) => {
    const job = activeJobs.get(keyOf(u));
    const percent = job?.progress?.percent;
    return (
      <li key={keyOf(u)} className="upd-row">
        <span className="upd-dot upd-dot--pending" aria-hidden />
        {renderIcon(u)}
        <div className="upd-text">
          <button type="button" className="upd-name" onClick={openable(u)} disabled={!openable(u)}>
            {displayName(u)}
          </button>
          <span className="upd-versions mono">{u.installed} → {u.available}</span>
          <div className="upd-note">{u.provider}</div>
        </div>
        {job ? (
          <span className="upd-status" aria-live="polite">
            {job.status === 'pending'
              ? t.queue.status.pending
              : typeof percent === 'number' ? `${t.updates.updating} ${Math.round(percent)}%` : t.updates.updating}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-sm upd-btn-update"
            aria-label={`${t.updates.update} ${displayName(u)}`}
            onClick={() => onUpgrade([u])}
          >
            {t.updates.update}
          </button>
        )}
      </li>
    );
  };

  const renderHistory = (h: UpdateHistoryEntry) => {
    const time = new Date(h.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const busy = activeJobs.has(keyOf(h));
    const canRollback = h.ok && h.kind === 'upgrade' && !!h.from && ROLLBACK_PROVIDERS.has(h.provider)
      && latestByPackage.has(h.id) && !busy;
    const stillAvailable = state.items.find((u) => keyOf(u) === keyOf(h));
    const canRetry = !h.ok && h.kind === 'upgrade' && !!stillAvailable && !busy;
    const note = h.ok
      ? `${h.kind === 'rollback' ? t.updates.rolledBackAt : t.updates.updatedAt} ${time} · ${h.provider}`
      : (h.errorCode ? t.queue.errors[h.errorCode] : h.message) ?? t.app.failed;
    return (
      <li key={h.id} className="upd-row">
        <span className={`upd-dot ${h.ok ? 'upd-dot--ok' : 'upd-dot--fail'}`} aria-hidden />
        {renderIcon(h)}
        <div className="upd-text">
          <button type="button" className="upd-name" onClick={openable(h)} disabled={!openable(h)}>
            {displayName(h)}
          </button>
          {h.from && h.to && <span className="upd-versions mono">{h.from} → {h.to}</span>}
          <div className={`upd-note${h.ok ? '' : ' upd-note--fail'}`}>{note}</div>
        </div>
        {canRollback && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRollback(h.id)}>
            {t.updates.rollbackTo} {h.from}
          </button>
        )}
        {canRetry && (
          <button type="button" className="btn btn-sm upd-btn-retry" onClick={() => onUpgrade([h])}>
            {t.app.retry}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="updates-layout">
      <div className="updates-main">
        <div className="updates-head">
          <h2 className="page-title">{t.nav.updates}</h2>
          <span className="updates-checked">{checkedLabel}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCheck} disabled={state.checking}>
            {state.checking ? <span className="desc-spinner" aria-hidden /> : null}
            {t.updates.check}
          </button>
        </div>

        <section className="upd-group" aria-labelledby="upd-pending">
          <div className="upd-group-head">
            <h3 id="upd-pending" className="upd-group-title upd-group-title--pending">{t.updates.pending}</h3>
            <span className="upd-group-line" />
            {pending.length > 1 && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onUpgrade(pending)}>
                {t.updates.updateAll} {pending.length}
              </button>
            )}
          </div>
          {state.items.length === 0 ? (
            <p className="upd-empty">{state.checkedAt ? t.updates.allFresh : t.updates.notChecked}</p>
          ) : (
            <ul className="upd-list">{state.items.map(renderPending)}</ul>
          )}
        </section>

        {days.map((d) => (
          <section key={d.label} className="upd-group" aria-label={d.label}>
            <div className="upd-group-head">
              <h3 className="upd-group-title">{d.label}</h3>
              <span className="upd-group-line" />
            </div>
            <ul className="upd-list">{d.entries.map(renderHistory)}</ul>
          </section>
        ))}

        {state.history.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm upd-clear" onClick={onClearHistory}>
            {t.updates.clearHistory}
          </button>
        )}
      </div>

      <aside className="updates-aside" aria-labelledby="upd-auto">
        <h3 id="upd-auto">{t.updates.autoTitle}</h3>
        <label className="upd-check">
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates}
            onChange={(e) => onSettingsChange({ autoCheckUpdates: e.target.checked })}
          />
          <span>{t.updates.autoCheck}</span>
        </label>
        <label className="upd-check">
          <input
            type="checkbox"
            checked={settings.autoInstallUpdates}
            onChange={(e) => onSettingsChange({ autoInstallUpdates: e.target.checked })}
          />
          <span>{t.updates.autoInstall}</span>
        </label>
        <p className="upd-aside-note">{t.updates.rollbackNote}</p>
      </aside>
    </div>
  );
}
