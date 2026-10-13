import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { SelfUpdateState } from '../types';

/** First few bullet lines of the release notes, without Markdown markers. */
function summary(notes = ''): string[] {
  return notes
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*] /.test(l))
    .map((l) => l.replace(/^[-*] /, '').replace(/\*\*|`/g, ''))
    .slice(0, 3);
}

interface SelfUpdateButtonProps {
  state: SelfUpdateState;
  onShowWhatsNew: () => void;
}

/** «Обновить до X» in the title bar; a popover offers restart now or on exit. */
export function SelfUpdateButton({ state, onShowWhatsNew }: SelfUpdateButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const visible = state.latest && (state.status === 'available' || state.status === 'downloading' || state.status === 'ready');
  if (!visible) return null;
  const ready = state.status === 'ready';
  const label = ready
    ? `${t.selfUpdate.updateTo} ${state.latest}`
    : state.status === 'downloading'
      ? `${t.selfUpdate.downloading} ${state.progress ?? 0}%`
      : `${t.selfUpdate.available} ${state.latest}`;

  return (
    <div className="self-update" ref={ref}>
      <button
        type="button"
        className={`self-update-btn${ready ? ' ready' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="self-update-dot" aria-hidden />
        {label}
      </button>
      {open && (
        <section className="self-update-pop" role="dialog" aria-label={`GetBox ${state.latest}`}>
          <div className="self-update-pop-body">
            <h2>
              {ready ? `GetBox ${state.latest} ${t.selfUpdate.readyTitle}` : `GetBox ${state.latest}`}
            </h2>
            {summary(state.notes).length > 0 && (
              <ul>{summary(state.notes).map((l) => <li key={l}>{l}</li>)}</ul>
            )}
            {ready && <p className="self-update-ok">{t.selfUpdate.verified}</p>}
            {state.status === 'downloading' && (
              <div className="self-update-progress" role="progressbar" aria-valuenow={state.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${state.progress ?? 0}%` }} />
              </div>
            )}
            {!state.canApply && <p className="self-update-note">{t.selfUpdate.manual}</p>}
            {state.error && <p className="self-update-err">{state.error}</p>}
          </div>
          <div className="self-update-actions">
            {ready && state.canApply ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void window.getbox.restartToUpdate()}>
                  {t.selfUpdate.restart}
                </button>
                <button
                  type="button"
                  className={`btn btn-secondary${state.applyOnQuit ? ' active' : ''}`}
                  aria-pressed={Boolean(state.applyOnQuit)}
                  onClick={() => void window.getbox.updateOnQuit(!state.applyOnQuit)}
                >
                  {state.applyOnQuit ? t.selfUpdate.onQuitSet : t.selfUpdate.onQuit}
                </button>
              </>
            ) : state.status === 'available' && state.canApply ? (
              <button type="button" className="btn btn-primary" onClick={() => void window.getbox.checkSelfUpdate()}>
                {t.selfUpdate.download}
              </button>
            ) : !state.canApply ? (
              <button type="button" className="btn btn-primary" onClick={() => void window.getbox.openReleasePage()}>
                {t.selfUpdate.openRelease}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="self-update-link"
            onClick={() => { setOpen(false); void window.getbox.openReleasePage(); }}
          >
            {t.selfUpdate.whatsNewIn} {state.latest}
          </button>
          <button type="button" className="self-update-link self-update-link--muted" onClick={() => { setOpen(false); onShowWhatsNew(); }}>
            {t.selfUpdate.currentWhatsNew}
          </button>
        </section>
      )}
    </div>
  );
}
