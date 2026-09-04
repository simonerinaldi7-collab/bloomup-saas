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
        tag: 'general-alert',
        data: { appId: null, url: './index.html' }
    };
    
    if (event.data) {
        try { 
            data = event.data.json(); 
        } catch (e) { 
            data.body = event.data.text(); 
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || './icon-192.png',
        badge: './icon-192.png',
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: true, // Mantiene la notifica aperta finché l'utente non agisce
        tag: data.tag || 'appointment-alert',
        data: data.data || { appId: null, url: './index.html' },
        actions: [
            { action: 'dismiss', title: '✓ Ho capito' },
            { action: 'snooze', title: '⏳ Posticipa 5m' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 👆 CLICK SULLA NOTIFICA O SUI BOTTONI DI AZIONE
self.addEventListener('notificationclick', function (event) {
    const notification = event.notification;
    const action = event.action;
    const appId = notification.data ? notification.data.appId : null;
    const targetUrl = notification.data ? notification.data.url : './index.html';

    notification.close();

    if (action === 'dismiss') {
        // L'utente ha cliccato "Ho capito": salviamo subito nello storage condiviso e avvisiamo i client
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'DISMISS_ALARM', appId });
                });
            })
        );
    } else if (action === 'snooze') {
        // L'utente ha cliccato "Posticipa 5m"
        const snoozeUntil = new Date(new Date().getTime() + 5 * 60000).toISOString();
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'SNOOZE_ALARM', appId, snoozeTime: snoozeUntil });
                });
            })
        );
    } else {
        // Click normale sul corpo della notifica: apre l'app
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
                for (let i = 0; i < clientList.length; i++) {
                    let client = clientList[i];
                    if ('focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(targetUrl);
                }
            })
        );
    }
});