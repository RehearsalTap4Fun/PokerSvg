import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// 图标与 manifest 走长缓存且文件名固定，地址带上图标内容哈希，换图后客户端才会重新拉取
const ICON_VERSION = createHash('sha1')
  .update(readFileSync(new URL('../public/icons/icon.svg', import.meta.url)))
  .digest('hex')
  .slice(0, 8)

/**
 * web 构建（--mode web）结束时生成 sw.js 与 version.json，并给 index.html 注入安装相关标签。
 * - 安装时预缓存全部产物（单文件 index.html + 图标 + manifest，不到 1MB）→ 首次打开后可离线
 * - 页面导航网络优先（联网总拿到最新版），断网回退缓存
 * - 其余同域资源缓存优先
 * - 缓存名带构建号，新版激活后清掉旧缓存
 */
export function swPlugin({ version }) {
  let outDir = 'dist-web'
  return {
    name: 'poker-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir
    },
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>
    <link rel="manifest" href="./manifest.webmanifest?v=${ICON_VERSION}" />
    <link rel="icon" href="./icons/icon.svg?v=${ICON_VERSION}" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="./icons/icon-180.png?v=${ICON_VERSION}" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="德州SNG" />
    <meta name="theme-color" content="#ffffff" />`,
      )
    },
    closeBundle() {
      const manifestPath = join(outDir, 'manifest.webmanifest')
      writeFileSync(
        manifestPath,
        readFileSync(manifestPath, 'utf8').replace(/("src":\s*"icons\/[^"?]+)"/g, `$1?v=${ICON_VERSION}"`),
      )
      const files = []
      const walk = (d) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f)
          if (statSync(p).isDirectory()) walk(p)
          else if (!/\.DS_Store$/.test(f)) files.push('./' + relative(outDir, p).split('\\').join('/'))
        }
      }
      walk(outDir)
      const precache = ['./', ...files.filter((f) => f !== './version.json' && f !== './sw.js')]
      const sw = `// 德州扑克 SNG service worker · build ${version}
const CACHE = 'poker-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (e) => {
  // cache: 'reload' 绕过浏览器 HTTP 缓存，否则长缓存的图标会把旧版本装进新缓存
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('poker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || new Response('离线且无缓存', { status: 503 }))),
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
`
      writeFileSync(join(outDir, 'sw.js'), sw)
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version }))
    },
  }
}
