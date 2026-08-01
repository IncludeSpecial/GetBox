import { useEffect, useState, type ReactNode } from 'react';
import logoUrl from '../../data/logo.svg';

interface AppBootstrapProps {
  children: ReactNode;
}

export function AppBootstrap({ children }: AppBootstrapProps) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 50;

    const check = () => {
      if (typeof window.getbox !== 'undefined') {
        setReady(true);
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        setError('Preload-мост не загрузился. Перезапустите приложение.');
        return;
      }
      setTimeout(check, 100);
    };

    check();
  }, []);

  if (error) {
    return (
      <div className="boot-screen boot-error">
        <img className="boot-logo" src={logoUrl} alt="" width={64} height={64} />
        <h1>GetBox</h1>
        <p className="boot-error-title">Не удалось запустить</p>
        <p className="boot-error-detail">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="boot-screen">
        <img className="boot-logo" src={logoUrl} alt="" width={64} height={64} />
        <div className="boot-wordmark">GetBox</div>
        <div className="boot-spinner" />
        <p className="boot-hint">Загрузка…</p>
      </div>
    );
  }

  return <>{children}</>;
}
