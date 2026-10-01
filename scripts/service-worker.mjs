import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const assets = await readdir('dist/assets')
const index = await readFile('dist/index.html', 'utf8')
const version = createHash('sha256').update(index + assets.join()).digest('hex').slice(0, 12)
const urls = ['./', 'index.html', 'icon.svg', 'manifest.webmanifest', ...assets.map(name => `assets/${name}`)]
await writeFile('dist/sw.js', `
const CACHE = 'video-editor-${version}';
const FILES = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('video-editor-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(new URL('index.html', scope).href, { ignoreVary: true })));
    return;
  }
  const path = url.pathname.slice(scope.pathname.length);
  if (!FILES.includes(path) && !path.startsWith('ffmpeg/')) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const stored = await cache.match(event.request, { ignoreVary: true });
    if (stored) return stored;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
`)
