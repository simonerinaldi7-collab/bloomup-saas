const CACHE_NAME = 'retailmaster-cache-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './config.js',
  './data-service.js',
  './api-bridge.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/dexie/dist/dexie.js'
];

// Installazione: scarica e memorizza i file in cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Salvataggio asset in cache');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Attivazione: pulisce le vecchie cache se aggiorni la versione
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Rimozione vecchia cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercettazione delle richieste (Network First, con fallback su Cache)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Escludiamo API esterne (Supabase, Google) e richieste di favicon/estensioni
  if (url.origin !== location.origin || url.pathname.includes('favicon.ico')) {
    return; 
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Verifichiamo che la risposta sia valida prima di metterla in cache
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Fallback su Cache se offline
        return caches.match(event.request);
      })
  );
});