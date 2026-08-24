import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface WebAppManifest {
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons?: Array<{ src?: string; sizes?: string; purpose?: string }>;
}

const publicPath = (...parts: string[]) => resolve(process.cwd(), 'public', ...parts);
const readPngSize = (filename: string) => {
  const png = readFileSync(publicPath(filename));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

describe('PWA installability', () => {
  it('loads the private-site manifest from the current origin with credentials', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8');

    expect(layout).toContain(
      "<link rel='manifest' href='/manifest.json' crossOrigin='use-credentials' />",
    );
    expect(layout).not.toMatch(/\bmanifest:\s*['"]\/manifest\.json['"]/);
  });

  it('launches the installed app directly into the standalone library', () => {
    const manifest = JSON.parse(
      readFileSync(publicPath('manifest.json'), 'utf8'),
    ) as WebAppManifest;

    expect(manifest).toMatchObject({
      id: '/library',
      start_url: '/library',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512' }),
      ]),
    );
    expect(readPngSize('icon-192.png')).toEqual({ width: 192, height: 192 });
    expect(readPngSize('icon-512.png')).toEqual({ width: 512, height: 512 });
  });

  it('ships a root-scoped service worker with the installability lifecycle', () => {
    const serviceWorkerPath = publicPath('sw.js');

    expect(existsSync(serviceWorkerPath)).toBe(true);
    const serviceWorker = readFileSync(serviceWorkerPath, 'utf8');
    expect(serviceWorker).toContain("addEventListener('install'");
    expect(serviceWorker).toContain("addEventListener('activate'");
    expect(serviceWorker).toContain("addEventListener('fetch'");
  });
});
