/**
 * Checks that only mean something on real Windows (run by the windows job in CI):
 *  - the self-update swap script, executed by cmd.exe, replaces the exe after GetBox exits
 *    and leaves everything in place when the copy fails;
 *  - command lines from shell-args.ts reach the program intact through cmd.exe;
 *  - the update parsers read the real output of choco and winget when they are installed.
 *
 * Run: node scripts/test-windows.cjs
 */
const { strict: assert } = require('node:assert');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.log('test-windows: skipped (not Windows)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
process.env.LOCALAPPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'getbox-win-'));
let passed = 0;
let failed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function loadTsModule(entry, stubs = {}) {
  const { buildSync } = require('esbuild');
  const result = buildSync({
    entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node',
    external: ['node:*', ...Object.keys(stubs)],
    define: { 'import.meta.url': JSON.stringify(require('node:url').pathToFileURL(entry).href) },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, (id) => (id in stubs ? stubs[id] : require(id)));
  return module.exports;
}

const electronStub = { app: { isPackaged: false, getVersion: () => '1.3.0', getAppPath: () => ROOT, getPath: () => os.tmpdir() } };
const { swapScript } = loadTsModule(path.join(ROOT, 'electron/self-update/self-update.ts'), {
  electron: electronStub, 'electron-store': class { get() { return {}; } set() {} },
});
const { shellCommand } = loadTsModule(path.join(ROOT, 'electron/providers/shell-args.ts'));
const { parseChocoOutdated, parseWingetUpgrade } = loadTsModule(path.join(ROOT, 'electron/updates/parse.ts'));

/** A stand-in for the running GetBox: a process that lives for `ms`. */
function fakeApp(ms) {
  return spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'ignore' });
}

function runScript(file) {
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/c', file], { stdio: 'ignore', windowsHide: true });
    child.on('close', resolve);
  });
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getbox swap '));   // a space, like «Program Files»
  const exe = path.join(dir, 'GetBox Portable', 'GetBox.exe');
  fs.mkdirSync(path.dirname(exe));
  fs.writeFileSync(exe, 'old version');
  const next = path.join(dir, 'GetBox-9.9.9-portable.exe');
  fs.writeFileSync(next, 'new version');
  return { dir, exe, next, script: path.join(dir, 'swap.cmd') };
}

test('swap: waits for GetBox to exit, then replaces the exe and cleans up', async () => {
  const { exe, next, script } = setup();
  const app = fakeApp(2500);
  const started = Date.now();
  fs.writeFileSync(script, swapScript(app.pid, next, exe, false));
  await runScript(script);
  assert.ok(Date.now() - started >= 2000, 'the script did not wait for the process');
  assert.equal(fs.readFileSync(exe, 'utf8'), 'new version');
  assert.ok(!fs.existsSync(next), 'the download was not removed');
  assert.ok(!fs.existsSync(script), 'the script did not delete itself');
});

test('swap: a read-only exe stays as it was and the download is kept for another try', async () => {
  const { exe, next, script } = setup();
  fs.chmodSync(exe, 0o444);
  const app = fakeApp(500);
  fs.writeFileSync(script, swapScript(app.pid, next, exe, false));
  await runScript(script);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'old version');
  assert.ok(fs.existsSync(next));
  fs.chmodSync(exe, 0o666);
});

test('shell: arguments with spaces and package-id punctuation arrive unchanged through cmd.exe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getbox args '));
  const printer = path.join(dir, 'argv.js');
  fs.writeFileSync(printer, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  const args = ['visual studio code', 'Notepad++.Notepad++', 'extras/vlc@3.0.20', '--version', '1.2.3', 'телеграм'];
  const out = spawnSync(shellCommand(process.execPath, [printer, ...args]), { shell: true, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), args);
});

function which(cmd) {
  try {
    execFileSync('where', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('choco outdated: the real output parses', () => {
  if (!which('choco')) return console.log('    (choco not installed, skipped)');
  const out = execFileSync('choco', ['outdated', '--limit-output'], { encoding: 'utf8', timeout: 180_000 });
  const rows = out.split(/\r?\n/).filter((l) => /^[^|]+\|[^|]+\|[^|]+\|(true|false)$/i.test(l.trim()));
  const parsed = parseChocoOutdated(out);
  assert.ok(parsed.length <= rows.length);
  for (const u of parsed) assert.ok(u.packageId && u.installed && u.available && u.installed !== u.available, JSON.stringify(u));
  console.log(`    ${rows.length} rows, ${parsed.length} updates`);
});

test('winget upgrade: the real output parses', () => {
  if (!which('winget')) return console.log('    (winget not installed, skipped)');
  const res = spawnSync('winget', ['upgrade', '--accept-source-agreements', '--disable-interactivity'], { encoding: 'utf8', timeout: 180_000 });
  const parsed = parseWingetUpgrade(res.stdout || '');
  for (const u of parsed) assert.ok(u.packageId && u.installed && u.available, JSON.stringify(u));
  console.log(`    exit ${res.status}, ${parsed.length} updates`);
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}\n    ${err.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
