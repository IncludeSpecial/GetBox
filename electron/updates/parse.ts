/**
 * Parsers for the "what can be upgraded" output of each package manager.
 * Pure functions so the smoke tests can feed them captured output.
 */

export interface ParsedUpgrade {
  packageId: string;
  name: string;
  installed: string;
  available: string;
}

/** Column start offsets of a header line: every run of non-spaces begins a column. */
function columnStarts(header: string): number[] {
  const starts: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) starts.push(m.index);
  return starts;
}

function sliceColumns(line: string, starts: number[]): string[] {
  return starts.map((start, i) => line.slice(start, starts[i + 1] ?? undefined).trim());
}

const WINGET_FOOTER = /^\d+\s|upgrades? available|обновлени|require explicit targeting|явного указания/i;

/**
 * `winget upgrade` prints a fixed-width table: Name | Id | Version | Available | Source.
 * Headers are localised but always single words, so their offsets mark the columns.
 * Names may contain double spaces, which is why splitting on whitespace is not enough.
 */
export function parseWingetUpgrade(out: string): ParsedUpgrade[] {
  // winget redraws its spinner with carriage returns; keep only what stayed on screen.
  const lines = out.split('\n').map((l) => l.split('\r').pop() ?? '');
  const dash = lines.findIndex((l) => /^-{10,}\s*$/.test(l.trim()));
  if (dash < 1) return [];
  const starts = columnStarts(lines[dash - 1]);
  if (starts.length < 4) return [];

  const results: ParsedUpgrade[] = [];
  for (const line of lines.slice(dash + 1)) {
    if (!line.trim()) break;
    if (WINGET_FOOTER.test(line.trim())) break;
    const [name, id, installed, available] = sliceColumns(line, starts);
    if (!id || !available || /\s/.test(id)) continue;
    results.push({ packageId: id, name: name || id, installed, available });
  }
  return results;
}

/**
 * `scoop status` is a PowerShell table whose headers have spaces in them
 * ("Installed Version"), so the dashed underline is what marks the columns.
 */
export function parseScoopStatus(out: string): ParsedUpgrade[] {
  const lines = out.split('\n').map((l) => l.replace(/\r$/, ''));
  const dash = lines.findIndex((l) => /^-+(\s+-+)+\s*$/.test(l.trim()) && l.trim().startsWith('----'));
  if (dash < 1) return [];
  const starts = columnStarts(lines[dash]);
  if (starts.length < 3) return [];

  const results: ParsedUpgrade[] = [];
  for (const line of lines.slice(dash + 1)) {
    if (!line.trim()) continue;
    const [name, installed, available] = sliceColumns(line, starts);
    // Rows with only a note (failed, held) carry no newer version.
    if (!name || !available || available === installed) continue;
    results.push({ packageId: name, name, installed, available });
  }
  return results;
}

/** `choco outdated --limit-output` prints `id|current|available|pinned` per package. */
export function parseChocoOutdated(out: string): ParsedUpgrade[] {
  const results: ParsedUpgrade[] = [];
  for (const raw of out.split('\n')) {
    const parts = raw.trim().split('|');
    if (parts.length < 3) continue;
    const [id, installed, available, pinned] = parts.map((p) => p.trim());
    if (!id || !available || installed === available || pinned === 'true') continue;
    results.push({ packageId: id, name: id, installed, available });
  }
  return results;
}
