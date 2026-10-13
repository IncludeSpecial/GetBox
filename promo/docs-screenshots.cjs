// Builds docs/screenshots/*.webp (1440×900) from the promo/shots/13 captures,
// including the five-theme strip. Run after `node promo/capture13.cjs`.
// Encoding happens in Chromium (canvas → WebP), so no image library is needed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const fs = require('fs');
const path = require('path');

const SHOTS = path.join(__dirname, 'shots', '13');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

// docs name → capture name(s); several captures make vertical slices, left to right.
const MAP = {
  home: ['home-classic'],
  catalog: ['cat-tiles'],
  details: ['modal'],
  queue: ['install-queue'],
  updates: ['updates'],
  packages: ['feat-packages'],
  profiles: ['feat-profiles'],
  appearance: ['L-appearance'],
  themes: ['home-classic', 'home-light', 'home-oled', 'home-contrast', 'home-mica'],
};

const dataUrl = (name) => `data:image/png;base64,${fs.readFileSync(path.join(SHOTS, `${name}.png`)).toString('base64')}`;

(async () => {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();
  fs.mkdirSync(OUT, { recursive: true });
  for (const [doc, parts] of Object.entries(MAP)) {
    const webp = await page.evaluate(async (srcs) => {
      const W = 1440, H = 900;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const slice = W / srcs.length;
      for (let i = 0; i < srcs.length; i++) {
        const img = new Image();
        img.src = srcs[i];
        await img.decode();
        const k = img.width / W; // captures are 2× (2880×1800)
        ctx.drawImage(img, i * slice * k, 0, slice * k, img.height, i * slice, 0, slice, H);
      }
      return canvas.toDataURL('image/webp', 0.86);
    }, parts.map(dataUrl));
    fs.writeFileSync(path.join(OUT, `${doc}.webp`), Buffer.from(webp.split(',')[1], 'base64'));
    console.log('docs', `${doc}.webp`);
  }
  await browser.close();
})();
