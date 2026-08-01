/**
 * Renders data/logo.svg → build/icon.png and data/logo.png (256×256)
 * for electron-builder and BrowserWindow.
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'data', 'logo.svg');
const outBuild = path.join(root, 'build', 'icon.png');
const outData = path.join(root, 'data', 'logo.png');

const svg = fs.readFileSync(svgPath);
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 256 },
});
const png = resvg.render().asPng();

fs.mkdirSync(path.dirname(outBuild), { recursive: true });
fs.writeFileSync(outBuild, png);
fs.writeFileSync(outData, png);
console.log('app icon:', path.relative(root, outBuild), path.relative(root, outData));
