import { useI18n } from '../i18n/I18nContext';
import { IconCheck } from './Icons';

export interface BootstrapToolState {
  status: string;
  ok: boolean;
  version?: string;
  message?: string;
  uacPending?: boolean;
}

export interface BootstrapOverlayProps {
  visible: boolean;
  running: boolean;
  progressMessage?: string;
  tools: {
    scoop: BootstrapToolState;
    winget: BootstrapToolState;
    chocolatey: BootstrapToolState;
  };
  onApproveChoco: () => void;
  onSkipChoco: () => void;
  onDismiss: () => void;
}

const TOOL_LABELS: Record<string, string> = {
  scoop: 'Scoop',
  winget: 'winget',
  chocolatey: 'Chocolatey',
};

function toolIcon(tool: BootstrapToolState, running: boolean, isActive: boolean): string {
  if (tool.ok || tool.status === 'ok') return 'done';
  if (tool.status === 'skipped') return 'skip';
  if (tool.status === 'fail') return 'fail';
  if (running && isActive) return 'active';
  if (tool.status === 'pending' || tool.uacPending) return 'pending';
  return 'pending';
}

export function BootstrapOverlay({
  visible,
  running,
  progressMessage,
  tools,
  onApproveChoco,
  onSkipChoco,
  onDismiss,
}: BootstrapOverlayProps) {
  const { t } = useI18n();
  if (!visible) return null;

  const chocoPending = tools.chocolatey.uacPending || tools.chocolatey.status === 'pending';
  const allDone = !running && !chocoPending;

  const rows = (['scoop', 'winget', 'chocolatey'] as const).map((key) => {
    const tool = tools[key];
    const active = running && progressMessage?.toLowerCase().includes(key === 'scoop' ? 'scoop' : key);
    const icon = toolIcon(tool, running, !!active);
    return { key, tool, icon };
  });

  return (
    <div className="bootstrap-overlay" role="status" aria-live="polite">
      <div className="bootstrap-panel">
        <div className="bootstrap-header">
          <h3>{t.bootstrap.title}</h3>
          {allDone && (
            <button className="btn btn-ghost btn-sm" onClick={onDismiss} aria-label={t.bootstrap.hide}>
              {t.bootstrap.hide}
            </button>
          )}
        </div>
        <p className="bootstrap-sub">
          {t.bootstrap.subtitle}{' '}
          <span className="mono">%LOCALAPPDATA%/GetBox/runtime/</span>.
        </p>
        {progressMessage && running && (
          <p className="bootstrap-progress-msg mono">{progressMessage}</p>
        )}
        <ul className="bootstrap-steps">
          {rows.map(({ key, tool, icon }) => (
            <li key={key} className={`bootstrap-step bootstrap-step--${icon}`}>
              <span className="bootstrap-step-icon">
                {icon === 'done' ? <IconCheck size={14} /> : icon === 'active' ? '…' : icon === 'fail' ? '!' : icon === 'skip' ? '—' : '○'}
              </span>
              <span className="bootstrap-step-label">{TOOL_LABELS[key]}</span>
              <span className="bootstrap-step-meta mono">
                {tool.ok && tool.version ? `v${tool.version}` : tool.message ?? (icon === 'active' ? t.bootstrap.configuring : '')}
              </span>
            </li>
          ))}
        </ul>
        {chocoPending && !running && (
          <div className="bootstrap-choco-actions">
            <p>{t.bootstrap.chocoUac}</p>
            <div className="bootstrap-choco-buttons">
              <button className="btn btn-accent btn-sm" onClick={onApproveChoco}>
                {t.bootstrap.approveChoco}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onSkipChoco}>
                {t.bootstrap.skip}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
