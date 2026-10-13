/**
 * Package-manager commands go through cmd.exe: scoop and choco are .cmd shims and
 * Node refuses to start .cmd files without a shell. In shell mode Node only joins the
 * arguments with spaces, so a package id or search query carrying `&` or `|` would run
 * as a second command. Every argument is checked here and the command line is built
 * explicitly (which also quotes multi-word queries).
 */
import { InstallError } from './install-errors.js';

/** Characters cmd.exe treats as syntax even inside quotes, or that break quoting. */
const CMD_META = /[&|<>^%!"`\r\n\0]/;

export function quoteArg(arg: string): string {
  if (CMD_META.test(arg)) throw new InstallError('untrusted', 'Недопустимый символ в аргументе команды', arg);
  return /[\s()]/.test(arg) ? `"${arg}"` : arg;
}

/** The full command line for `spawn(cmd, { shell: true })`; empty arguments are dropped. */
export function shellCommand(exe: string, args: string[]): string {
  if (/["\r\n\0]/.test(exe)) throw new InstallError('untrusted', 'Недопустимый путь к программе', exe);
  return [`"${exe}"`, ...args.filter((a) => a !== '').map(quoteArg)].join(' ');
}

/** A search query someone typed: letters, digits and a few separators survive, the rest becomes spaces. */
export function cleanQuery(query: string): string {
  return query.replace(/[^\p{L}\p{N} ._+#@-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}
