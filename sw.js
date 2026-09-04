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

// 🌐 CONFIGURAZIONE SUPABASE DIRETTA PER IL SERVICE WORKER
const SUPABASE_URL = 'https://uartaeqbcfxxsyksbnty.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Yc8oSL4T29eecI39CLxiOg_3W1sbyYz';

// 👆 CLICK SULLA NOTIFICA O SUI BOTTONI DI AZIONE
self.addEventListener('notificationclick', function (event) {
    const notification = event.notification;
    const action = event.action;
    const appId = notification.data ? notification.data.appId : null;
    const targetUrl = notification.data ? notification.data.url : './index.html';

    notification.close();

    if (action === 'dismiss') {
        if (appId) {
            const todayKeyDate = new Date().toISOString().split('T')[0];
            const salonId = notification.data?.salonId || 'SALON_001';
            const username = notification.data?.username || 'system';

            // Salviamo in IndexedDB e registriamo il sync in background nativo
            event.waitUntil(
                storeDismissAndRegisterSync(salonId, appId, username, todayKeyDate)
            );
        }

        // Avvisiamo le finestre aperte (se l'app è aperta)
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'DISMISS_ALARM', appId });
                });
            })
        );
    } else if (action === 'snooze') {
        const snoozeUntil = new Date(new Date().getTime() + 5 * 60000).toISOString();
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
                clientList.forEach(client => {
                    client.postMessage({ type: 'SNOOZE_ALARM', appId, snoozeTime: snoozeUntil });
                });
            })
        );
    } else {
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

// 📦 1. Salva in IndexedDB e richiede il Background Sync al browser
function storeDismissAndRegisterSync(salonId, appId, username, todayKeyDate) {
    return new Promise((resolve) => {
        const request = indexedDB.open("RetailMasterPWA", 21);

        request.onsuccess = (event) => {
            const db = event.target.result;
            try {
                const transaction = db.transaction(['appointment_dismissals', 'sync_queue'], 'readwrite');
                
                // Salvataggio locale immediato per spegnere l'allarme ovunque
                const dismissalsStore = transaction.objectStore('appointment_dismissals');
                dismissalsStore.put({
                    id: `${salonId}_${appId}_${todayKeyDate}`,
                    salon_id: salonId,
                    appointment_id: appId,
                    username: username,
                    dismissed_date: todayKeyDate
                });

                // Coda di sincronizzazione per Supabase
                const syncQueueStore = transaction.objectStore('sync_queue');
                syncQueueStore.add({
                    action: 'INSERT',
                    table_name: 'appointment_dismissals',
                    data: {
                        salon_id: salonId,
                        appointment_id: appId,
                        username: username,
                        dismissed_date: todayKeyDate
                    },
                    target_id: appId
                });

                transaction.oncomplete = async () => {
                    // Chiediamo al browser di eseguire la sincronizzazione in background appena possibile
                    try {
                        if ('serviceWorker' in registration && 'sync' in registration) {
                            await registration.sync.register('sync-vaimup-dismissals');
                        }
                    } catch (e) {
                        console.log("Background Sync non supportato o fallito, verrà inviato alla prossima apertura.");
                    }
                    resolve();
                };
                transaction.onerror = () => resolve();
            } catch (err) {
                resolve();
            }
        };
        request.onerror = () => resolve();
    });
}

// 🌐 2. Evento di Background Sync nativo (Il browser risveglia il SW per inviare i dati)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-vaimup-dismissals') {
        event.waitUntil(processBackgroundSyncQueueDirectly());
    }
});

async function processBackgroundSyncQueueDirectly() {
    // Esegue lo svuotamento della sync_queue verso Supabase direttamente in background
    const SUPABASE_URL = 'https://uartaeqbcfxxsyksbnty.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_Yc8oSL4T29eecI39CLxiOg_3W1sbyYz';

    return new Promise((resolve) => {
        const request = indexedDB.open("RetailMasterPWA", 21);
        request.onsuccess = async (event) => {
            const db = event.target.result;
            try {
                const transaction = db.transaction(['sync_queue'], 'readwrite');
                const store = transaction.objectStore('sync_queue');
                const getAllReq = store.getAll();

                getAllReq.onsuccess = async () => {
                    const queue = getAllReq.result || [];
                    const dismissalsItems = queue.filter(item => item.table_name === 'appointment_dismissals');

                    for (let item of dismissalsItems) {
                        try {
                            const res = await fetch(`${SUPABASE_URL}/rest/v1/appointment_dismissals?on_conflict=salon_id,appointment_id,dismissed_date`, {
                                method: 'POST',
                                headers: {
                                    'apikey': SUPABASE_KEY,
                                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                                    'Content-Type': 'application/json',
                                    'Prefer': 'resolution=merge-duplicates'
                                },
                                body: JSON.stringify(item.data)
                            });

                            if (res.ok || res.status === 409) {
                                // Rimuoviamo l'elemento dalla coda locale se è andato a buon fine
                                const delTx = db.transaction(['sync_queue'], 'readwrite');
                                delTx.objectStore('sync_queue').delete(item.local_id);
                            }
                        } catch (netErr) {
                            console.log("Tentativo di sync in background fallito per assenza rete, riproverà più tardi.");
                        }
                    }
                    resolve();
                };
            } catch (e) {
                resolve();
            }
        };
        request.onerror = () => resolve();
    });
}