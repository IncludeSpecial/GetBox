import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { ViewMode } from '../types';
import whatsNew from '../../data/whats-new.json';
import logoUrl from '../../data/logo.svg';

interface Card {
  icon: string;
  title: string;
  text: string;
  action?: ViewMode;
  actionLabel?: string;
  titleEn?: string;
  textEn?: string;
  actionLabelEn?: string;
}

const NOTES = whatsNew as Record<string, Card[]>;

const ICONS: Record<string, string> = {
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  palette: 'M12 3a9 9 0 1 0 0 18h1.5a1.5 1.5 0 0 0 1-2.6 1.5 1.5 0 0 1 1-2.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  shield: 'M12 3l8 3.5v5.5c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6.5zM8.5 12l2.5 2.5 4.5-5',
};

/** The notes for a version: exact match, else the same major.minor (1.3.1 shows 1.3.0's). */
export function notesFor(version: string): Card[] | undefined {
  if (NOTES[version]) return NOTES[version];
  const mm = version.split('.').slice(0, 2).join('.');
  const key = Object.keys(NOTES).find((k) => k.startsWith(mm + '.'));
  return key ? NOTES[key] : undefined;
}

interface WhatsNewProps {
  version: string;
  previous?: string;
  onClose: () => void;
  onNavigate: (view: ViewMode) => void;
}

/** Shown once after GetBox updated itself: what changed, with a way into each feature. */
export function WhatsNew({ version, previous, onClose, onNavigate }: WhatsNewProps) {
  const { t, locale } = useI18n();
  const cards = notesFor(version) ?? [];
  const closeRef = useRef<HTMLButtonElement>(null);
  const en = locale === 'en';

  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <div className="whats-new-inner">
        <img src={logoUrl} alt="" className="whats-new-logo" />
        <span className="whats-new-version mono">{previous ? `${previous} → ${version}` : version}</span>
        <h1 id="whats-new-title">{t.whatsNew.title}</h1>
        <p className="whats-new-sub">{t.whatsNew.kept}</p>
        <div className="whats-new-cards">
          {cards.map((c) => (
            <article key={c.title} className="whats-new-card">
              <div className="whats-new-icon" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 24 24"><path d={ICONS[c.icon] ?? ICONS.grid} /></svg>
              </div>
              <h2>{en ? c.titleEn ?? c.title : c.title}</h2>
              <p>{en ? c.textEn ?? c.text : c.text}</p>
              {c.action && (
                <button type="button" className="whats-new-link" onClick={() => { onNavigate(c.action!); onClose(); }}>
                  {en ? c.actionLabelEn ?? c.actionLabel : c.actionLabel} →
                </button>
              )}
            </article>
          ))}
        </div>
        <div className="whats-new-actions">
          <button ref={closeRef} type="button" className="btn btn-accent-solid" onClick={onClose}>{t.whatsNew.continue}</button>
          <button type="button" className="whats-new-link" onClick={() => void window.getbox.openReleasePage(version)}>
            {t.whatsNew.fullChangelog}
          </button>
        </div>
      </div>
    </div>
  );
}
