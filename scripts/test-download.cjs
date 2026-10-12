/**
 * Integration tests for catalog downloadFile (abort, HTTP errors, fallbacks).
 * Run: node scripts/test-download.cjs
 */
const { strict: assert } = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadTsModule(entry, stubs = {}) {
  const { buildSync } = require('esbuild');
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['node:*', ...Object.keys(stubs)],
    define: { 'import.meta.url': JSON.stringify(require('node:url').pathToFileURL(entry).href) },
  });
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, req);
  return module.exports;
}

const electronStub = {
  app: {
    isPackaged: false,
    getAppPath: () => ROOT,
    getPath: () => ROOT,
  },
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
  })();
}

function tempFile(name) {
  return path.join(os.tmpdir(), `getbox-test-${Date.now()}-${name}`);
}

function unlinkQuiet(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const { downloadFile, detectInstallerKind } = loadTsModule(
  path.join(ROOT, 'electron', 'providers', 'catalog.ts'),
  { electron: electronStub },
);

function isInstallError(err, code) {
  return err && typeof err === 'object' && err.code === code;
}

console.log('\ndownload integration:');

(async () => {
  await test('slow download + abort removes .part file', async () => {
    await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': '500000', 'Content-Type': 'application/octet-stream' });
      let sent = 0;
      const tick = () => {
        if (sent >= 500000) {
          res.end();
          return;
        }
        res.write(Buffer.alloc(4096));
        sent += 4096;
        setTimeout(tick, 20);
      };
      tick();
    }, async (base) => {
      const dest = tempFile('abort.exe');
      const part = `${dest}.part`;
      unlinkQuiet(dest);
      unlinkQuiet(part);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 80);
      await assert.rejects(
        () => downloadFile(`${base}/slow`, dest, undefined, controller.signal),
        (err) => isInstallError(err, 'cancelled'),
      );
      assert.ok(!fs.existsSync(part), '.part should be cleaned up');
      assert.ok(!fs.existsSync(dest), 'dest should not exist');
    });
  });

  await test('HTTP 403 on all URLs yields forbidden', async () => {
    await withServer((_req, res) => {
      res.writeHead(403);
      res.end('blocked');
    }, async (base) => {
      const dest = tempFile('403.exe');
      unlinkQuiet(dest);
      await assert.rejects(
        () => downloadFile([`${base}/a`, `${base}/b`], dest),
        (err) => isInstallError(err, 'forbidden'),
      );
    });
  });

  await test('HTTP 404 on all URLs yields not_found', async () => {
    await withServer((_req, res) => {
      res.writeHead(404);
      res.end('missing');
    }, async (base) => {
      const dest = tempFile('404.exe');
      unlinkQuiet(dest);
      await assert.rejects(
        () => downloadFile(`${base}/missing`, dest),
        (err) => isInstallError(err, 'not_found'),
      );
    });
  });

  await test('primary 404 then fallback 200 succeeds', async () => {
    await withServer((req, res) => {
      if (req.url === '/bad') {
        res.writeHead(404);
        res.end();
        return;
      }
      const body = Buffer.from('fake-installer');
      res.writeHead(200, { 'Content-Length': String(body.length), 'Content-Type': 'application/octet-stream' });
      res.end(body);
    }, async (base) => {
      const dest = tempFile('fallback.exe');
      unlinkQuiet(dest);
      await downloadFile([`${base}/bad`, `${base}/good`], dest);
      assert.ok(fs.existsSync(dest));
      assert.equal(fs.readFileSync(dest).toString(), 'fake-installer');
      unlinkQuiet(dest);
    });
  });

  await test('redirect loop (>6) yields http error', async () => {
    await withServer((req, res) => {
      res.writeHead(302, { Location: req.url || '/loop' });
      res.end();
    }, async (base) => {
      const dest = tempFile('loop.exe');
      unlinkQuiet(dest);
      await assert.rejects(
        () => downloadFile(`${base}/loop`, dest),
        (err) => isInstallError(err, 'http'),
      );
    });
  });

  await test('forbidden download error carries structured code', async () => {
    await withServer((_req, res) => {
      res.writeHead(403);
      res.end('blocked');
    }, async (base) => {
      const dest = tempFile('403-code.exe');
      unlinkQuiet(dest);
      try {
        await downloadFile(`${base}/blocked`, dest);
        assert.fail('expected rejection');
      } catch (err) {
        assert.ok(isInstallError(err, 'forbidden'));
      }
    });
  });

  await test('redirect to plain http on another host is refused', async () => {
    await withServer((_req, res) => {
      res.writeHead(302, { Location: 'http://example.com/setup.exe' });
      res.end();
    }, async (base) => {
      const dest = tempFile('downgrade.exe');
      unlinkQuiet(dest);
      await assert.rejects(
        () => downloadFile(`${base}/start`, dest),
        (err) => isInstallError(err, 'untrusted'),
      );
      assert.ok(!fs.existsSync(dest));
    });
  });

  await test('non-https catalog url is refused before connecting', async () => {
    const dest = tempFile('plain.exe');
    unlinkQuiet(dest);
    await assert.rejects(
      () => downloadFile('http://example.com/setup.exe', dest),
      (err) => isInstallError(err, 'untrusted'),
    );
  });

  await test('detectInstallerKind reads magic bytes, not the name', async () => {
    const cases = [
      ['kind-pe.download', Buffer.from('4d5a900003000000', 'hex'), 'exe'],
      ['kind-msi.download', Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'msi'],
      ['kind-html.download', Buffer.from('<!DOCTYPE html>'), null],
      ['kind-msix.download', Buffer.from('504b030414000800', 'hex'), null],
      ['kind-empty.download', Buffer.alloc(0), null],
    ];
    for (const [name, bytes, expected] of cases) {
      const file = tempFile(name);
      fs.writeFileSync(file, bytes);
      assert.equal(detectInstallerKind(file), expected, name);
      unlinkQuiet(file);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
