const CACHE_NAME = 'warehouse-v4'; // Новая версия

const urlsToCache = [
  '.',
  'index.html',
  'app.js',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/pouchdb@8.0.1/dist/pouchdb.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
];

// Установка
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Активация — удаляем старый кэш
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
    }).then(() => self.clients.claim())
  );
});

// Перехват запросов
self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // НЕ кэшируем запросы к Google Scripts
  if (url.includes('script.google.com')) {
    return; // Браузер сделает обычный запрос
  }
  
  // НЕ кэшируем запросы к Google Images
  if (url.includes('google.com/search')) {
    return;
  }
  
  // Для всех остальных — кэш, потом сеть
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then(response => {
        // Кэшируем только успешные ответы и только наши файлы
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            // Кэшируем только если это наш файл или CDN
            if (urlsToCache.some(u => url.includes(u)) || url.includes('cdn.jsdelivr.net')) {
              cache.put(event.request, responseToCache);
            }
          });
        }
        return response;
      });
    })
  );
});
