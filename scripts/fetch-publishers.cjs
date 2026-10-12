/**
 * Read the Authenticode signer of every catalog installer and record it as
 * `publisher` in data/catalog.json. GetBox refuses to run a downloaded
 * installer whose signer does not match (see electron/providers/signature.ts).
 *
 * EXE: only the PE header and the certificate table are fetched (HTTP Range)
 * when the server allows it. MSI: the signature lives in a stream of the OLE
 * container, so the whole file is downloaded.
 *
 * Run: node scripts/fetch-publishers.cjs [--write] [id ...]
 *   --write   insert/update "publisher" (or "unsigned": true) in catalog.json
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'data', 'catalog.json');
const WRITE = process.argv.includes('--write');
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CONCURRENCY = 4;
const MAX_FULL_DOWNLOAD = 600 * 1024 * 1024;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CODE_SIGNING_EKU = '1.3.6.1.5.5.7.3.3';

async function fetchRange(url, start, end) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
    redirect: 'follow',
  });
  if (res.status !== 206) {
    res.body?.cancel().catch(() => {});
    return null;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function fetchFull(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_FULL_DOWNLOAD) throw new Error(`too large (${Math.round(len / 1e6)} MB)`);
  return Buffer.from(await res.arrayBuffer());
}

/** Locate the certificate table via the PE optional header's data directory #4. */
function peSecurityDir(head) {
  if (head.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file');
  const pe = head.readUInt32LE(0x3c);
  if (head.readUInt32LE(pe) !== 0x4550) throw new Error('bad PE signature');
  const opt = pe + 24;
  const magic = head.readUInt16LE(opt);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  return { offset: head.readUInt32LE(dirs + 32), size: head.readUInt32LE(dirs + 36) };
}

/**
 * Minimal OLE compound-file reader: returns the named root-level stream.
 * MSI keeps its Authenticode blob in "\x05DigitalSignature"; scanning the raw
 * file instead would find signatures of embedded custom-action DLLs.
 */
function oleStream(buf, wanted) {
  if (buf.readUInt32LE(0) !== 0xe011cfd0) throw new Error('not an OLE file');
  const ss = 1 << buf.readUInt16LE(0x1e);
  const mss = 1 << buf.readUInt16LE(0x20);
  const cutoff = buf.readUInt32LE(0x38);
  const sector = (n) => buf.subarray((n + 1) * ss, (n + 2) * ss);
  const END = 0xfffffffe;

  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(0x4c + i * 4);
    if (s < 0xfffffffa) fatSectors.push(s);
  }
  for (let d = buf.readUInt32LE(0x44), n = buf.readUInt32LE(0x48); n-- > 0 && d < 0xfffffffa; ) {
    const sec = sector(d);
    for (let i = 0; i < ss / 4 - 1; i++) {
      const s = sec.readUInt32LE(i * 4);
      if (s < 0xfffffffa) fatSectors.push(s);
    }
    d = sec.readUInt32LE(ss - 4);
  }
  const fat = Buffer.concat(fatSectors.map(sector));
  const chain = (start, table) => {
    const out = [];
    for (let s = start; s !== END && s < table.length / 4 && out.length < 1e7; s = table.readUInt32LE(s * 4)) out.push(s);
    return out;
  };
  const readChain = (start) => Buffer.concat(chain(start, fat).map(sector));

  const dir = readChain(buf.readUInt32LE(0x30));
  const entries = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 64);
    entries.push({
      name: dir.subarray(off, off + Math.max(0, nameLen - 2)).toString('utf16le'),
      type: dir[off + 66],
      start: dir.readUInt32LE(off + 116),
      size: dir.readUInt32LE(off + 120),
    });
  }
  const entry = entries.find((e) => e.type === 2 && e.name === wanted);
  if (!entry) return null;
  if (entry.size >= cutoff) return readChain(entry.start).subarray(0, entry.size);

  const miniStream = readChain(entries[0].start);
  const miniFat = readChain(buf.readUInt32LE(0x3c));
  const parts = chain(entry.start, miniFat).map((s) => miniStream.subarray(s * mss, (s + 1) * mss));
  return Buffer.concat(parts).subarray(0, entry.size);
}

/**
 * CN of the primary signer's certificate in a PKCS#7 blob. The blob may carry
 * several leaf certificates, so the signer is matched by the serial in the
 * first signer_info — the same one Get-AuthenticodeSignature reports.
 */
function signerFromPkcs7(der) {
  const tmp = path.join(os.tmpdir(), `getbox-sig-${process.pid}-${Math.random().toString(36).slice(2)}.p7b`);
  fs.writeFileSync(tmp, der);
  try {
    const openssl = (...args) =>
      execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-in', tmp, ...args], {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    const pem = openssl('-print_certs');
    const certs = (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map(
      (p) => new X509Certificate(p),
    );
    const serialMatch = /signer_info:[\s\S]*?serial:\s*(0x[0-9a-f]+|-?\d+)/i.exec(openssl('-print'));
    const serial = serialMatch ? BigInt(serialMatch[1]) : null;
    const leaf =
      certs.find((c) => serial !== null && BigInt(`0x${c.serialNumber}`) === serial) ??
      certs.find((c) => !c.ca && (c.keyUsage ?? []).includes(CODE_SIGNING_EKU));
    if (!leaf) return null;
    const cn = /^CN=(.+)$/m.exec(leaf.subject);
    return cn ? cn[1].replace(/\\(.)/g, '$1').trim() : null;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function peSigner(file) {
  const dir = peSecurityDir(file);
  if (!dir.offset || !dir.size) return null;
  return certTableSigner(file.subarray(dir.offset, dir.offset + dir.size));
}

/** WIN_CERTIFICATE: dwLength, wRevision, wCertificateType, then PKCS#7. */
function certTableSigner(table) {
  return signerFromPkcs7(table.subarray(8, table.readUInt32LE(0)));
}

function msiSigner(file) {
  const blob = oleStream(file, '\u0005DigitalSignature');
  return blob ? signerFromPkcs7(blob) : null;
}

/** File type by magic bytes, the same way GetBox decides how to run it. */
function kindOf(head) {
  if (head.readUInt16LE(0) === 0x5a4d) return 'exe';
  if (head.readUInt32LE(0) === 0xe011cfd0) return 'msi';
  return null;
}

async function signerOf(url) {
  const head = await fetchRange(url, 0, 4095);
  if (head && kindOf(head) === 'exe') {
    const dir = peSecurityDir(head);
    if (!dir.offset || !dir.size) return null;
    const table = await fetchRange(url, dir.offset, dir.offset + dir.size - 1);
    if (table) return certTableSigner(table);
  }
  // No range support, an MSI, or a CDN that hands out a different file per request.
  const file = await fetchFull(url);
  const kind = kindOf(file);
  if (kind === 'exe') return peSigner(file);
  if (kind === 'msi') return msiSigner(file);
  throw new Error(`not an installer (${file.subarray(0, 16).toString('latin1').replace(/[^\x20-\x7e]/g, '.')})`);
}

async function inspect(item) {
  try {
    const signer = await signerOf(item.installUrl);
    return { id: item.id, signer, unsigned: signer === null };
  } catch (err) {
    return { id: item.id, error: err.message };
  }
}

/** Insert or replace a top-level key inside the item's block, keeping the file's hand formatting. */
function setField(text, id, key, valueJson) {
  const start = text.indexOf(`"id": "${id}"`);
  if (start < 0) return text;
  const end = text.indexOf('\n  }', start);
  let block = text.slice(start, end);
  block = block.replace(new RegExp(`\\n\\s*"(publisher|unsigned)": [^\\n]*,`, 'g'), '');
  block = block.replace(/(\n(\s*)"installUrl": [^\n]*,)/, `$1\n$2"${key}": ${valueJson},`);
  return text.slice(0, start) + block + text.slice(end);
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf-8'));
  const items = catalog.filter((i) => i.installUrl && (ONLY.length === 0 || ONLY.includes(i.id)));
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const item = items[next++];
        const r = await inspect(item);
        results.push(r);
        const label = r.error ? `ERROR ${r.error}` : r.unsigned ? 'UNSIGNED' : r.signer;
        const prev = item.publisher ?? (item.unsigned ? 'UNSIGNED' : '—');
        const mark = !r.error && prev !== label ? ' (changed)' : '';
        console.log(`${item.id.padEnd(24)} ${label}${mark}`);
      }
    }),
  );

  if (WRITE) {
    let text = fs.readFileSync(CATALOG, 'utf-8');
    for (const r of results) {
      if (r.error) continue;
      text = r.unsigned
        ? setField(text, r.id, 'unsigned', 'true')
        : setField(text, r.id, 'publisher', JSON.stringify(r.signer));
    }
    JSON.parse(text);
    fs.writeFileSync(CATALOG, text);
  }

  const errors = results.filter((r) => r.error).length;
  const unsigned = results.filter((r) => r.unsigned).length;
  console.log(`\n${results.length} checked · ${unsigned} unsigned · ${errors} errors${WRITE ? ' · catalog.json updated' : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
