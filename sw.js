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


// 🛑 BLOCCO 1: Se l'appuntamento è già passato, SCARTA la notifica push accodata
    const appDate = data.date || (data.data && data.data.date);
    const appTime = data.time || (data.data && data.data.time);

    if (appDate && appTime) {
        const timeClean = String(appTime).substring(0, 5);
        const appDateTime = new Date(`${appDate}T${timeClean}:00`);
        const now = new Date();

        // Se l'orario di inizio dell'appuntamento è già stato superato, non svegliare l'utente
        if (!isNaN(appDateTime.getTime()) && appDateTime.getTime() <= now.getTime()) {
            console.log("🛑 [SW PUSH BLOCKED] Notifica push accumulata scartata: l'appuntamento è già passato (" + appDate + " " + timeClean + ")");
            return;
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

// 🎯 CLICK NOTIFICA CON CONTROLLO DI VALIDITÀ TEMPORALE
self.addEventListener('notificationclick', function (event) {
    const notification = event.notification;
    const data = notification.data || {};
    const appId = data.appId;
    const appDate = data.date;
    const appTime = data.time;

    notification.close();

    // 🛑 BLOCCO 2: Se l'utente clicca una vecchia notifica di un appuntamento ormai passato
    let isPassed = false;
    if (appDate && appTime) {
        const timeClean = String(appTime).substring(0, 5);
        const appDateTime = new Date(`${appDate}T${timeClean}:00`);
        if (!isNaN(appDateTime.getTime()) && appDateTime.getTime() <= Date.now()) {
            isPassed = true;
        }
    }

    // Se è passato, apriamo semplicemente l'agenda pulita senza allarme
    let targetUrl = data.url || './index.html';
    if (isPassed) {
        targetUrl = './index.html?open_tab=calendar';
    } else if (appId) {
        const separator = targetUrl.includes('?') ? '&' : '?';
        targetUrl = `${targetUrl}${separator}alarm_action=true&open_alert=${appId}`;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if ('focus' in client) {
                    if (!isPassed && appId) {
                        client.postMessage({ type: 'FORCE_OPEN_ALARM', appId: appId });
                    }
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});