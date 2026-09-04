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

    // 🛑 NOTA: Abbiamo rimosso l'array 'actions' (Ho capito / Snooze) per evitare problemi di sync background mobile.
    // Ora l'utente clicca direttamente sulla notifica e apre l'app dove troverà il modale di gestione.
    const options = {
        body: data.body,
        icon: data.icon || './icon-192.png',
        badge: './icon-192.png',
        vibrate: [300, 100, 300, 100, 300],
        requireInteraction: true, 
        tag: data.tag || 'appointment-alert',
        data: data.data || { appId: null, url: './index.html' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// --- START OF FILE sw.js (Aggiornato per profonda reattività al click) ---
self.addEventListener('notificationclick', function (event) {
    const notification = event.notification;
    const data = notification.data || {};
    const appId = data.appId;
    
    // Costruiamo un URL con l'ID dell'appuntamento in chiaro nei parametri di ricerca
    let targetUrl = data.url || './index.html';
    if (appId) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}open_alert=${appId}`;
    }

    notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            // Se l'app è già aperta in una finestra, la portiamo in primo piano e navighiamo/forziamo l'apertura
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) {
                    // Inviamo anche un messaggio diretto al client attivo se la pagina è già aperta
                    client.postMessage({ type: 'FORCE_OPEN_ALARM', appId: appId });
                    return client.focus();
                }
            }
            // Altrimenti apriamo una nuova finestra passando l'URL con il parametro di avvio rapido
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});