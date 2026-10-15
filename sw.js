// Service Worker for PWA
const CACHE_NAME = 'city-empire-v1';
const urlsToCache = [
  './cities.html',
  './intro-loading.js',
  './auth.js',
  './login.js',
  './avatars.js',
  './profile.js',
  './social.js',
  './online-map-v2.js',
  './friends.js',
  './chat.js',
  './mock-api.js',
  './balance-config.js',
  './city3d.js',
  './world-city.js',
  './progression.js',
  './auction.js',
  './auction-fair.js',
  './world-city.css',
  './login.css',
  './city-hud.css',
  './social.css',
  './online-map.css',
  './friends.css',
  './chat.css',
  './vendor/leaflet.js',
  './vendor/three.min.js',
  './vendor/leaflet.css'
];

// 安装Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('缓存已打开');
        return cache.addAll(urlsToCache);
      })
  );
});

// 激活Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 拦截请求
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 缓存命中，返回缓存资源
        if (response) {
          return response;
        }
        // 否则请求网络
        return fetch(event.request);
      })
  );
});
