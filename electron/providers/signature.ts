import { execFile } from 'node:child_process';
import { InstallError } from './install-errors.js';

/** What Get-AuthenticodeSignature reports for a file. */
export interface SignatureInfo {
  /** Valid, NotSigned, HashMismatch, NotTrusted, UnknownError, … */
  status: string;
  /** CN of the signer certificate, when there is one. */
  signer?: string;
}

/** Catalog fields that describe who is expected to have signed the installer. */
export interface SignatureExpectation {
  /** Signer CN recorded by scripts/fetch-publishers.cjs; several when the vendor rotates certificates. */
  publisher?: string | string[];
  /** The vendor ships an unsigned installer; only HTTPS protects it. */
  unsigned?: boolean;
}

const SIGNATURE_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$s = Get-AuthenticodeSignature -LiteralPath $env:GETBOX_SIGNATURE_FILE',
  '$signer = $null',
  'if ($s.SignerCertificate) { $signer = $s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }',
  '[pscustomobject]@{ status = [string]$s.Status; signer = $signer } | ConvertTo-Json -Compress',
].join('; ');

/** Ask Windows to verify the Authenticode signature of `filePath`. */
export function readSignature(filePath: string): Promise<SignatureInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SIGNATURE_SCRIPT],
      {
        timeout: 60_000,
        windowsHide: true,
        // The path travels in the environment so it never has to be quoted into the script.
        env: { ...process.env, GETBOX_SIGNATURE_FILE: filePath },
      },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as { status?: string; signer?: string | null };
          resolve({ status: parsed.status ?? 'UnknownError', signer: parsed.signer ?? undefined });
        } catch {
          reject(new Error(`Unexpected Get-AuthenticodeSignature output: ${stdout.slice(0, 200)}`));
        }
      },
    );
  });
}

/**
 * Decide whether an installer may run. Returns null when it may, otherwise the
 * error to report. Pure, so the policy is covered by smoke tests.
 *
 * - Valid signature: accepted; when `publisher` is known the signer must match it.
 * - No signature: accepted only for entries explicitly marked `unsigned`.
 * - Anything else (tampered, untrusted chain, …): rejected.
 */
export function checkSignature(info: SignatureInfo, expected: SignatureExpectation): InstallError | null {
  const reject = (detail: string) =>
    new InstallError('untrusted', 'Установщик не прошёл проверку подлинности', detail);

  if (info.status === 'NotSigned') {
    return expected.unsigned ? null : reject('Installer is not signed');
  }
  if (info.status !== 'Valid') {
    return reject(`Signature status: ${info.status}${info.signer ? ` (${info.signer})` : ''}`);
  }

  const publishers = [expected.publisher ?? []].flat();
  if (publishers.length === 0) return null;
  const signer = (info.signer ?? '').trim().toLowerCase();
  if (publishers.some((p) => p.trim().toLowerCase() === signer)) return null;
  return reject(`Signed by "${info.signer ?? '?'}", expected "${publishers.join('" or "')}"`);
}

/** Throws InstallError('untrusted') unless the downloaded installer passes `checkSignature`. */
export async function verifyInstallerSignature(filePath: string, expected: SignatureExpectation): Promise<void> {
  let info: SignatureInfo;
  try {
    info = await readSignature(filePath);
  } catch (err) {
    // Fail closed: an installer we could not verify is not run.
    throw new InstallError(
      'untrusted',
      'Не удалось проверить подпись установщика',
      err instanceof Error ? err.message : String(err),
    );
  }
  const problem = checkSignature(info, expected);
  if (problem) throw problem;
}
