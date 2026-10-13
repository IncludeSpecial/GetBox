/**
 * «Скопировать отчёт»: a plain-text summary someone can paste into an issue — versions,
 * system, package managers, settings that change behaviour, failed jobs and the log tail.
 * No identifiers are collected and the home folder is shortened to ~.
 */
import os from 'node:os';
import { app } from 'electron';
import { getSettings } from './store/settings.js';
import { loadRuntimeState } from './bootstrap/runtime.js';
import { getAllProviders } from './providers/registry.js';
import { installQueue } from './queue/install-queue.js';
import { selfUpdater } from './self-update/self-update.js';
import { readRecentLog, redact } from './log.js';

export async function buildReport(): Promise<string> {
  const s = getSettings();
  const runtime = loadRuntimeState();
  const update = selfUpdater.getState();
  const providers = await Promise.all(getAllProviders().map(async (p) => {
    try {
      const a = await p.available();
      return `${p.id}: ${a.ok ? 'ok' : 'нет'}${a.message ? ` — ${a.message}` : ''}`;
    } catch (err) {
      return `${p.id}: ошибка — ${err instanceof Error ? err.message : String(err)}`;
    }
  }));
  const failed = installQueue.getJobs().filter((j) => j.status === 'failed').slice(-10)
    .map((j) => `${j.provider}/${j.packageId}: ${j.errorCode ?? ''} ${j.message ?? ''}${j.detail ? `\n    ${j.detail.slice(-300).replace(/\n/g, '\n    ')}` : ''}`);

  const lines = [
    `GetBox ${app.getVersion()} (${process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'не portable'})`,
    `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    `${os.type()} ${os.release()} ${process.arch} · ${typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : ''} · язык ${app.getLocale()}`,
    `Память ${Math.round(os.totalmem() / 2 ** 30)} ГБ · ядер ${os.cpus().length}`,
    '',
    '## Менеджеры пакетов',
    `runtime: scoop=${runtime.scoop} winget=${runtime.winget} chocolatey=${runtime.chocolatey}${runtime.chocoUacPending ? ' (ждёт UAC)' : ''}`,
    ...providers,
    '',
    '## Настройки',
    `провайдеры: ${s.enabledProviders.join(', ')} · тихая установка: ${s.quietInstall ? 'да' : 'нет'} · свой каталог: ${s.remoteCatalogUrl ? 'да' : 'нет'}`,
    `обновления программ: проверка ${s.autoCheckUpdates ? 'вкл' : 'выкл'}, установка ${s.autoInstallUpdates ? 'вкл' : 'выкл'}`,
    `обновление GetBox: ${s.autoUpdateApp ? 'в фоне' : 'вручную'}, канал ${s.appUpdateChannel} · состояние ${update.status}${update.latest ? ` (${update.latest})` : ''}${update.error ? ` — ${update.error}` : ''}`,
    `тема ${s.theme}, масштаб ${s.uiScale}, язык ${s.language}`,
    '',
    '## Ошибки в очереди',
    ...(failed.length ? failed : ['нет']),
    '',
    '## Журнал (последние строки)',
    readRecentLog(200) || '(пусто)',
  ];
  return redact(lines.join('\n'));
}
