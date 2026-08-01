import { useI18n } from '../i18n/I18nContext';
import { IconAlert } from './Icons';

interface ProviderBannerProps {
  providers: Array<{ id: string; displayName: string; ok: boolean; message?: string }>;
  enabledIds: string[];
  bootstrapRunning?: boolean;
  onDisableProvider?: (id: string) => void;
  onRetryBootstrap?: () => void;
}

const RUNTIME_PROVIDERS = new Set(['scoop', 'winget', 'chocolatey']);

export function ProviderBanner({
  providers,
  enabledIds,
  bootstrapRunning,
  onDisableProvider,
  onRetryBootstrap,
}: ProviderBannerProps) {
  const { t } = useI18n();

  const failed = providers.filter((p) => {
    if (!enabledIds.includes(p.id) || p.ok) return false;
    if (bootstrapRunning && RUNTIME_PROVIDERS.has(p.id)) return false;
    return true;
  });
  if (failed.length === 0) return null;

  return (
    <>
      {failed.map((p) => (
        <div key={p.id} className="provider-banner">
          <IconAlert size={18} className="provider-banner-icon" />
          <div className="provider-banner-body">
            <p>
              <strong>{p.displayName} {t.provider.unavailable}.</strong>{' '}
              {p.message ?? ''}
              {p.id === 'catalog' ? (
                <> {t.provider.catalogHint}</>
              ) : (
                <> {t.provider.otherHint}</>
              )}
            </p>
            <div className="provider-banner-actions">
              {RUNTIME_PROVIDERS.has(p.id) && onRetryBootstrap && (
                <button className="btn btn-accent btn-sm" onClick={onRetryBootstrap}>
                  {t.provider.retry}
                </button>
              )}
              {onDisableProvider && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onDisableProvider(p.id)}
                >
                  {t.provider.disable}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
