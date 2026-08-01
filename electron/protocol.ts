import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getImagesDir, getBundledIconsDir } from './paths.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function resolveMediaFile(filename: string): string | null {
  const safeName = path.basename(filename);
  const candidates = [
    path.join(getImagesDir(), safeName),
    path.join(getBundledIconsDir(), safeName),
  ];
  for (const filePath of candidates) {
    const resolved = path.resolve(filePath);
    const allowedRoots = [path.resolve(getImagesDir()), path.resolve(getBundledIconsDir())];
    if (allowedRoots.some((root) => resolved.startsWith(root)) && fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

export function registerMediaProtocol(): void {
  protocol.handle('getbox-media', (request) => {
    const url = new URL(request.url);
    // getbox-media://local/firefox.svg  OR  getbox-media://firefox.svg (legacy)
    const filename = decodeURIComponent(
      url.pathname && url.pathname !== '/'
        ? url.pathname.replace(/^\//, '')
        : url.hostname,
    );

    const filePath = resolveMediaFile(filename);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] ?? 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    return new Response(data, { headers: { 'Content-Type': mime } });
  });
}
