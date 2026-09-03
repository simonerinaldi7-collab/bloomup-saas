// sw.js - Gestione PWA, Cache e Notifiche Push Reali (Anche ad app chiusa)

const CACHE_NAME = 'retailmaster-cache-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './config.js',
  './data-service.js',
  './api-bridge.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/dexie/dist/dexie.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// 📥 RICEZIONE EVENTO PUSH DAL SERVER (Supabase Edge Function)
self.addEventListener('push', function (event) {
    let data = { 
        title: '⏰ Appuntamento Imminente', 
        body: 'Hai un trattamento in agenda a breve.', 
        icon: './icon-192.png',
        url: './index.html' 
    };
    
    if (event.data) {
        try { 
            // Il server invia un pacchetto JSON formattato con i dettagli dell'appuntamento
            data = event.data.json(); 
        } catch (e) { 
            data.body = event.data.text(); 
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || './icon-192.png',
        badge: './icon-192.png',
        vibrate: [300, 100, 300, 100, 300], // 📳 Vibrazione stile Google Calendar
        requireInteraction: true,          // 📌 Mantiene la notifica attiva finché non viene letta
        data: { url: data.url || './index.html' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 👆 CLICK SULLA NOTIFICA NATIVA: Apre o porta in primo piano la PWA
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            // Se l'app è già aperta in qualche finestra, la portiamo in primo piano (focus)
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) {
                    return client.focus();
                }
            }
            // Altrimenti apriamo una nuova finestra della PWA
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url || './index.html');
            }
        })
    );
});