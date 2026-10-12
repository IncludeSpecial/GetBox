/**
 * Generate data/installers.json — how GetBox installs each catalog app —
 * from the official winget-pkgs manifests on cdn.winget.microsoft.com.
 *
 * The catalog itself holds no download links: every app maps to a winget Id
 * (data/winget-map.json), and this script resolves that Id to the latest
 * installer URL, its SHA256, type and silent switches. GetBox downloads the
 * file directly and refuses it unless the hash matches; apps whose only
 * installer is MSIX/zip/portable are left to the winget client. Apps missing
 * from winget get a hand-written entry, e.g. { "provider": "chocolatey",
 * "packageId": "filezilla" }, which this script leaves untouched.
 *
 * Chain (the same one the winget client uses for its "winget" source):
 *   source2.msix → Public/index.db (packages: id, latest_version, hash)
 *   → packages/<Id>/<hash8>/versionData.mszyml (versions → manifest path)
 *   → <manifest path> (merged YAML manifest)
 *
 * Needs Node 22.5+ (node:sqlite). No winget, no GitHub API, no rate limits.
 *
 * Run: node scripts/refresh-installers.cjs [--check] [id ...]
 *   --check   do not write; exit 1 if installers.json is out of date
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const os = require('node:os');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'installers.json');
const CDN = 'https://cdn.winget.microsoft.com/cache';
const CHECK = process.argv.includes('--check');
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CONCURRENCY = 8;

/** Installer types GetBox can run itself; the rest go through the winget client. */
const RUNNABLE = { nullsoft: 'exe', inno: 'exe', burn: 'exe', exe: 'exe', msi: 'msi', wix: 'msi' };
/** Silent switches winget uses when a manifest does not specify its own. */
const DEFAULT_SILENT = {
  nullsoft: '/S',
  inno: '/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
  burn: '/quiet /norestart',
  msi: '/quiet /norestart',
  wix: '/quiet /norestart',
};
const ARCH_RANK = { x64: 0, neutral: 1, x86: 2 };
/** Per-user installs need no UAC prompt, which keeps the queue unattended. */
const SCOPE_RANK = { user: 0, undefined: 1, machine: 2 };
const LOCALE_RANK = { 'ru-RU': 0, 'en-US': 1, undefined: 2 };

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3 || /HTTP 404/.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** Pull one file out of a zip (the msix, which is written as zip64) via its central directory. */
function unzipEntry(zip, name) {
  const MAX32 = 0xffffffff;
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('zip: no end of central directory');
  let p = zip.readUInt32LE(eocd + 16);
  let count = zip.readUInt16LE(eocd + 10);
  if (p === MAX32 || count === 0xffff) {
    const locator = eocd - 20;
    if (zip.readUInt32LE(locator) !== 0x07064b50) throw new Error('zip: no zip64 locator');
    const eocd64 = Number(zip.readBigUInt64LE(locator + 8));
    count = Number(zip.readBigUInt64LE(eocd64 + 32));
    p = Number(zip.readBigUInt64LE(eocd64 + 48));
  }
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(p + 10);
    let size = zip.readUInt32LE(p + 20);
    const rawSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    let local = zip.readUInt32LE(p + 42);
    // zip64 extra field: 64-bit values for whichever 32-bit fields are saturated, in this order.
    for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; e += 4 + zip.readUInt16LE(e + 2)) {
      if (zip.readUInt16LE(e) !== 0x0001) continue;
      let q = e + 4;
      if (rawSize === MAX32) q += 8;
      if (size === MAX32) {
        size = Number(zip.readBigUInt64LE(q));
        q += 8;
      }
      if (local === MAX32) local = Number(zip.readBigUInt64LE(q));
    }
    if (zip.toString('utf-8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${name} not found`);
}

/**
 * Windows Compression API buffer in MSZIP mode: a 24-byte header, then blocks
 * of "CK" + raw deflate, each using the previous 32 KB of output as dictionary.
 */
function decodeMszip(buf) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0xc0e5510a) return buf;
  const total = Number(buf.readBigUInt64LE(8));
  const out = [];
  let size = 0;
  let off = 24;
  let dict = Buffer.alloc(0);
  while (size < total) {
    const len = buf.readUInt32LE(off);
    off += 4;
    if (buf.toString('latin1', off, off + 2) !== 'CK') throw new Error('mszip: bad block');
    const chunk = zlib.inflateRawSync(buf.subarray(off + 2, off + len), dict.length ? { dictionary: dict } : {});
    out.push(chunk);
    size += chunk.length;
    dict = Buffer.concat([dict, chunk]).subarray(-32768);
    off += len;
  }
  return Buffer.concat(out);
}

async function openIndex() {
  const { DatabaseSync } = require('node:sqlite');
  const msix = await get(`${CDN}/source2.msix`);
  const file = path.join(os.tmpdir(), `getbox-winget-index-${process.pid}.db`);
  fs.writeFileSync(file, unzipEntry(msix, 'Public/index.db'));
  const db = new DatabaseSync(file, { readOnly: true });
  const stmt = db.prepare('SELECT id, latest_version, hex(hash) AS hash FROM packages WHERE id = ? COLLATE NOCASE');
  return {
    lookup: (id) => stmt.get(id),
    close: () => {
      db.close();
      fs.rmSync(file, { force: true });
    },
  };
}

function rank(table, key) {
  return table[String(key)] ?? 9;
}

/** Pick the installer GetBox should use, applying root-level manifest defaults. */
function pickInstaller(manifest) {
  const candidates = (manifest.Installers ?? []).map((inst) => ({
    ...inst,
    InstallerType: inst.InstallerType ?? manifest.InstallerType,
    Scope: inst.Scope ?? manifest.Scope,
    InstallerLocale: inst.InstallerLocale ?? manifest.InstallerLocale,
    InstallerSwitches: { ...manifest.InstallerSwitches, ...inst.InstallerSwitches },
    InstallerSuccessCodes: inst.InstallerSuccessCodes ?? manifest.InstallerSuccessCodes,
  }));
  const usable = candidates.filter((i) => i.Architecture in ARCH_RANK);
  const runnable = usable.filter((i) => RUNNABLE[String(i.InstallerType).toLowerCase()]);
  const sort = (list) =>
    list.sort(
      (a, b) =>
        rank(ARCH_RANK, a.Architecture) - rank(ARCH_RANK, b.Architecture) ||
        rank(SCOPE_RANK, a.Scope) - rank(SCOPE_RANK, b.Scope) ||
        rank(LOCALE_RANK, a.InstallerLocale) - rank(LOCALE_RANK, b.InstallerLocale),
    );
  return { direct: sort(runnable)[0], fallbackType: sort(usable)[0]?.InstallerType };
}

function toEntry(wingetId, version, manifest) {
  const { direct, fallbackType } = pickInstaller(manifest);
  if (!direct) {
    return { wingetId, version, type: String(fallbackType ?? 'unknown').toLowerCase(), direct: false };
  }
  const type = String(direct.InstallerType).toLowerCase();
  const switches = direct.InstallerSwitches ?? {};
  const silent = [switches.Silent ?? DEFAULT_SILENT[type], switches.Custom].filter(Boolean).join(' ').trim();
  const entry = {
    wingetId,
    version,
    type,
    url: direct.InstallerUrl,
    sha256: String(direct.InstallerSha256).toLowerCase(),
  };
  if (silent) entry.silentArgs = silent;
  if (switches.Custom) entry.args = switches.Custom;
  if (direct.Scope) entry.scope = direct.Scope;
  if (direct.InstallerSuccessCodes?.length) entry.successCodes = direct.InstallerSuccessCodes;
  return entry;
}

/** A mapping typo installs the wrong program, so the catalog name or id must share a word with the package. */
function namesAgree(app, packageName, wingetId) {
  const words = `${app.name} ${app.id}`.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const pkg = `${packageName} ${wingetId}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  return words.some((w) => pkg.includes(w));
}

async function resolve(index, app, wingetId) {
  const row = index.lookup(wingetId);
  if (!row) throw new Error(`${wingetId} is not in the winget index`);
  const versionData = yaml.load(
    decodeMszip(await get(`${CDN}/packages/${row.id}/${row.hash.slice(0, 8).toLowerCase()}/versionData.mszyml`)).toString(
      'utf-8',
    ),
  );
  const versions = versionData.vD ?? [];
  const latest = versions.find((v) => String(v.v) === row.latest_version) ?? versions[0];
  if (!latest) throw new Error(`${wingetId}: no versions`);
  const manifest = yaml.load(decodeMszip(await get(`${CDN}/${latest.rP}`)).toString('utf-8'));
  if (!namesAgree(app, manifest.PackageName, row.id)) {
    throw new Error(`${wingetId} is "${manifest.PackageName}", not "${app.name}" — check winget-map`);
  }
  return toEntry(row.id, String(latest.v), manifest);
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf-8'));
  const wingetMap = JSON.parse(fs.readFileSync(path.join(DATA, 'winget-map.json'), 'utf-8'));
  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf-8')) : {};
  const apps = catalog.filter((a) => ONLY.length === 0 || ONLY.includes(a.id));

  const index = await openIndex();
  const result = { ...previous };
  const failures = [];
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < apps.length) {
          const app = apps[next++];
          // Hand-written entries pin another provider for apps winget does not carry.
          if (previous[app.id]?.provider) continue;
          const wingetId = wingetMap[app.id];
          if (!wingetId) {
            failures.push(`${app.id}: no winget-map entry`);
            continue;
          }
          try {
            result[app.id] = await resolve(index, app, wingetId);
          } catch (err) {
            failures.push(`${app.id}: ${err.message}`);
          }
        }
      }),
    );
  } finally {
    index.close();
  }

  // Drop apps that left the catalog; keep stable key order for readable diffs.
  const known = new Set(catalog.map((a) => a.id));
  const sorted = Object.fromEntries(
    Object.keys(result)
      .filter((id) => known.has(id))
      .sort()
      .map((id) => [id, result[id]]),
  );

  let changed = 0;
  for (const [id, entry] of Object.entries(sorted)) {
    const before = previous[id];
    if (JSON.stringify(before) === JSON.stringify(entry)) continue;
    changed++;
    const how = entry.provider
      ? `via ${entry.provider}`
      : entry.direct === false ? `winget only (${entry.type})` : `${entry.type} ${entry.scope ?? ''}`.trim();
    console.log(`${id.padEnd(24)} ${before?.version ?? '—'} → ${entry.version}  ${how}`);
  }
  for (const f of failures) console.error(`  x ${f}`);

  const entries = Object.values(sorted);
  const direct = entries.filter((e) => e.url).length;
  const winget = entries.filter((e) => e.direct === false).length;
  console.log(
    `\n${entries.length} apps · ${direct} direct · ${winget} via winget · ${entries.length - direct - winget} other provider · ${changed} changed · ${failures.length} failed`,
  );

  if (CHECK) {
    process.exit(changed > 0 || failures.length > 0 ? 1 : 0);
  }
  fs.writeFileSync(OUT, `${JSON.stringify(sorted, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
