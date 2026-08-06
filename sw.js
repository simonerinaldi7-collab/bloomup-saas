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


// --- SERVICE WORKER CON AZIONI INTERATTIVE (SNOOZE & DISMISS) ---

self.addEventListener('push', function (event) {
    let data = { title: '⏰ Appuntamento Imminente', body: 'Il trattamento sta per iniziare.', appId: 'gen_id' };
    if (event.data) {
        try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
    }

    const options = {
        body: data.body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: true, // Mantiene la notifica attiva finché l'utente non la tocca
        data: { appId: data.appId },
        actions: [
            { action: 'snooze_5', title: '⏳ Posticipa 5 min' },
            { action: 'dismiss', title: '✕ Interrompi' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Gestione dei click sui bottoni della notifica nativa
self.addEventListener('notificationclick', function (event) {
    const notification = event.notification;
    const action = event.action;
    const appId = notification.data ? notification.data.appId : null;

    notification.close();

    if (action === 'snooze_5') {
        // Comuniciamo al client (app aperta) di posticipare l'appuntamento di 5 minuti
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'SNOOZE_APPOINTMENT', appId: appId, minutes: 5 });
                });
            })
        );
    } else if (action === 'dismiss') {
        // L'utente ha interrotto/chiuso l'avviso
        console.log('Notifica interrotta dall\'operatore per app ID:', appId);
    } else {
        // Clic generico sul corpo della notifica -> apre l'app
        event.waitUntil(
            clients.openWindow('./index.html')
        );
    }
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