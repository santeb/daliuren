/* 大六壬 PWA Service Worker（2026-11-19）
 * 策略要点：
 *  1. HTML 走 network-first —— 线上永远是最新版（此站频繁更新，cache-first 会让用户卡在旧版）；
 *     仅当网络失败（离线）才回落缓存，实现「离线可用」。
 *  2. 同源静态资源走 cache-first（图标/封面/manifest 等不常变，秒开）。
 *  3. 只处理同源 GET。AI 代理(SCF)、Google Fonts、51.la 统计等都是跨域，一律放行不拦截，
 *     避免把动态请求或第三方脚本缓存坏。
 *  4. 升级 CACHE 版本即触发 activate 清旧缓存；skipWaiting + clients.claim 让新 SW 立即接管。
 */
var CACHE = 'dlr-v1';
var PRECACHE = [
  './', './index.html', './manifest.json',
  './assets/icon-192.png', './assets/icon-512.png', './assets/og.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 单个资源失败不拖垮整体（GitHub Pages 偶发抖动）
      return Promise.all(PRECACHE.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // 跨域一律放行

  var accept = req.headers.get('accept') || '';
  var isHTML = req.mode === 'navigate' || accept.indexOf('text/html') >= 0;

  if (isHTML) {
    // network-first：先取网络，成功就刷新缓存；失败（离线）才用缓存
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { return c.put('./index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  // 同源静态：cache-first，命中即回；未命中回源并写入
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { return c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
