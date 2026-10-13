import { useEffect, useState } from 'react';
// 18 px: the simplified mark stays crisp where the full one turns to mush.
import logoUrl from '../../data/logo-small.svg';
import { IconClose, IconMaximize, IconMinimize, IconRestore } from './Icons';

function waitForApi(): Promise<typeof window.getbox> {
  return new Promise((resolve) => {
    const tick = () => {
      if (typeof window.getbox !== 'undefined') {
        resolve(window.getbox);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    void waitForApi().then((api) => {
      if (cancelled) return;
      void api.windowIsMaximized().then((v) => {
        if (!cancelled) setMaximized(v);
      });
      unsub = api.onWindowState((state) => {
        if (!cancelled) setMaximized(state.maximized);
      });
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  return (
    <header className="titlebar" onDoubleClick={() => void window.getbox?.windowMaximize()}>
      <div className="titlebar-brand">
        <img className="titlebar-logo" src={logoUrl} alt="" width={18} height={18} />
        <span className="titlebar-name">GetBox</span>
      </div>
      <div className="titlebar-drag" aria-hidden />
      {/* App portals the GetBox update button here, inside its i18n provider. */}
      <div className="titlebar-slot" id="titlebar-slot" />
      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          aria-label="Minimize"
          onClick={() => void window.getbox?.windowMinimize()}
        >
          <IconMinimize size={12} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.getbox?.windowMaximize()}
        >
          {maximized ? <IconRestore size={12} /> : <IconMaximize size={12} />}
        </button>
        <button
          type="button"
          className="titlebar-btn titlebar-btn--close"
          aria-label="Close"
          onClick={() => void window.getbox?.windowClose()}
        >
          <IconClose size={12} />
        </button>
      </div>
    </header>
  );
}
