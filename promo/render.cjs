// Render a promo page frame by frame (deterministic) and pipe the frames into ffmpeg.
//   node promo/render.cjs video  [page.html]           → promo/<page>.mp4 (no audio)
//   node promo/render.cjs stills [page.html] t1 t2 …   → promo/still-<page>-<t>.png
// The page sets window.FORMAT = { width, height, fps, duration } and window.render(t).
// Playwright is not a project dependency: npx playwright, or point PLAYWRIGHT_MODULE at an install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const http = require('http'); const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const DIR = __dirname;
const ROOT = path.join(__dirname, '..');
const [mode = 'video', pageArg, ...rest] = process.argv.slice(2);
const pageFile = pageArg && pageArg.endsWith('.html') ? pageArg : 'promo.html';
const times = (pageArg && !pageArg.endsWith('.html') ? [pageArg, ...rest] : rest).map(Number);
const pageName = path.basename(pageFile, '.html');

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
  res.writeHead(200, { 'Content-Type': type[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/promo/${pageFile}`);
  const format = await page.evaluate(() => window.FORMAT ?? { width: 1920, height: 1080, fps: 30, duration: window.DURATION });
  await page.setViewportSize({ width: format.width, height: format.height });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.evaluate(() => document.fonts.ready);

  if (mode === 'stills') {
    for (const t of times) {
      await page.evaluate((t) => window.render(t), t);
      await page.screenshot({ path: path.join(DIR, `still-${pageName}-${t}.png`) });
    }
  } else {
    const out = path.join(DIR, `${pageName}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(format.fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const frames = Math.round(format.duration * format.fps);
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => window.render(t), i / format.fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 300 === 0) console.log(`frame ${i}/${frames}`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(out);
  }
  await browser.close(); server.close();
});
