/**
 * Renders the app icon from data/logo.svg (and data/logo-small.svg for 16–32 px):
 *   build/icon.ico, data/logo.ico — multi-size Windows icon for the exe and window
 *   build/icon.png, data/logo.png — 256×256 PNG
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');
const full = fs.readFileSync(path.join(root, 'data', 'logo.svg'));
const small = fs.readFileSync(path.join(root, 'data', 'logo-small.svg'));

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, png }, i) => {
    const e = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, e);
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const icon = ico(sizes.map((size) => ({ size, png: render(size <= 32 ? small : full, size) })));
const png256 = render(full, 256);

const out = [
  ['build/icon.ico', icon],
  ['data/logo.ico', icon],
  ['build/icon.png', png256],
  ['data/logo.png', png256],
];
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
for (const [file, data] of out) fs.writeFileSync(path.join(root, file), data);
console.log('app icon:', out.map(([f]) => f).join(', '));
