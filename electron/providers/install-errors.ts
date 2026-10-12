/** Structured install failure codes shared by providers and the queue UI. */
export type InstallErrorCode =
  | 'cancelled'
  | 'not_found'
  | 'forbidden'
  | 'network'
  | 'timeout'
  | 'http'
  | 'installer'
  | 'untrusted'
  | 'unknown';

export class InstallError extends Error {
  readonly code: InstallErrorCode;
  readonly detail?: string;

  constructor(code: InstallErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
    this.detail = detail;
  }
}

export function isCancelledError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof InstallError && err.code === 'cancelled') return true;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (/aborted|cancelled|canceled/i.test(err.message)) return true;
  }
  return false;
}

export function classifyHttpStatus(status: number): InstallErrorCode {
  if (status === 404 || status === 410) return 'not_found';
  if (status === 401 || status === 403 || status === 451) return 'forbidden';
  if (status === 408 || status === 429) return 'timeout';
  if (status >= 500) return 'http';
  return 'http';
}

export function classifyError(err: unknown): {
  code: InstallErrorCode;
  message: string;
  detail?: string;
} {
  if (err instanceof InstallError) {
    return { code: err.code, message: err.message, detail: err.detail };
  }

  if (isCancelledError(err)) {
    return { code: 'cancelled', message: 'Установка отменена', detail: err instanceof Error ? err.message : undefined };
  }

  const msg = err instanceof Error ? err.message : String(err);
  const codeName =
    err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';

  if (/timed?\s*out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg) || codeName === 'ETIMEDOUT') {
    return { code: 'timeout', message: 'Превышено время ожидания', detail: msg };
  }

  if (codeName === 'ECONNRESET' || /ECONNRESET|socket hang up|read ECONNRESET/i.test(msg)) {
    return {
      code: 'network',
      message: 'Сервер оборвал загрузку. Нажмите «Повторить» — или поставьте через winget во вкладке «Все пакеты».',
      detail: msg,
    };
  }

  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|network/i.test(msg) ||
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/.test(codeName)
  ) {
    return { code: 'network', message: 'Нет сети или сервер недоступен', detail: msg };
  }

  const httpMatch = /Download failed:\s*(\d{3})/i.exec(msg);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    const code = classifyHttpStatus(status);
    const labels: Record<InstallErrorCode, string> = {
      cancelled: 'Установка отменена',
      not_found: 'Файл не найден (битая ссылка)',
      forbidden: 'Ссылка недоступна (ограничение сети/региона или CDN)',
      network: 'Нет сети или сервер недоступен',
      timeout: 'Превышено время ожидания',
      http: `Ошибка загрузки (HTTP ${status})`,
      installer: 'Ошибка установщика',
      untrusted: 'Установщик не прошёл проверку подлинности',
      unknown: 'Неизвестная ошибка',
    };
    return { code, message: labels[code], detail: msg };
  }

  if (/Too many redirects/i.test(msg)) {
    return { code: 'http', message: 'Слишком много перенаправлений', detail: msg };
  }

  return { code: 'installer', message: msg || 'Ошибка установки', detail: msg };
}

export function isRetryableDownloadError(err: unknown): boolean {
  if (isCancelledError(err)) return false;
  if (err instanceof InstallError) {
    return err.code === 'timeout' || err.code === 'network' || err.code === 'http';
  }
  const { code } = classifyError(err);
  if (code === 'not_found' || code === 'forbidden' || code === 'cancelled') return false;
  return code === 'timeout' || code === 'network' || code === 'http';
}

/** Whether catalog.install should attempt altProvider (winget/scoop) after direct download fails. */
export function shouldTryAltProvider(err: unknown): boolean {
  if (isCancelledError(err)) return false;
  if (err instanceof InstallError) {
    return (
      err.code === 'timeout' ||
      err.code === 'network' ||
      err.code === 'http' ||
      err.code === 'forbidden' ||
      err.code === 'not_found' ||
      err.code === 'untrusted'
    );
  }
  const { code } = classifyError(err);
  if (code === 'cancelled' || code === 'installer' || code === 'unknown') return false;
  return (
    code === 'timeout' ||
    code === 'network' ||
    code === 'http' ||
    code === 'forbidden' ||
    code === 'not_found'
  );
}
