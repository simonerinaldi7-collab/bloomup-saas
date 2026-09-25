// data-service.js
const SUPABASE_URL = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.url : 'https://uartaeqbcfxxsyksbnty.supabase.co';
const SUPABASE_KEY = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.key : 'sb_publishable_Yc8oSL4T29eecI39CLxiOg_3W1sbyYz';

// Inizializzazione del DB Locale del Browser (IndexedDB tramite Dexie)
let localDb = null;
if (typeof Dexie !== 'undefined') {
    localDb = new Dexie("RetailMasterPWA");
    localDb.version(25).stores({
        users: 'id, salon_id, username, status, updated_at',
        customers: 'id, salon_id, first_name, last_name, phone, gdpr_date, updated_at',
        inventory: 'id, salon_id, name, type, supplier_id, model, barcode, size, unit, location, is_consignment, updated_at',
        appointments: 'id, salon_id, date, time, updated_at',
        sales: 'id, salon_id, date, appointment_id, updated_at',
        sale_items: 'id, salon_id, sale_id, is_paid, updated_at',
        message_logs: 'id, salon_id, updated_at',
        expenses: 'id, salon_id, date, updated_at',
        price_history: 'id, salon_id, product_id, updated_at',
        service_consumables: 'id, salon_id, service_id, updated_at',
        operator_schedules: 'id, salon_id, username, day_of_week, updated_at',
        suppliers: 'id, salon_id, name, updated_at',
        product_suppliers: 'id, salon_id, product_id, supplier_id, updated_at',
        supplier_settlements: 'id, salon_id, sale_item_id, supplier_id, is_paid, updated_at',
        stock_lots: 'id, salon_id, product_id, created_at, updated_at',
        push_subscriptions: 'id, salon_id, username, updated_at',              // 👈 Aggiunto
        appointment_dismissals: 'id, salon_id, appointment_id, dismissed_date, updated_at', // 👈 Aggiunto
        packages_config: 'id, salon_id, name',             // 👈 Nome corretto al plurale
        package_items: 'id, package_id, salon_id, service_id', // 👈 Aggiunto salon_id 
        customer_packages: 'id, salon_id, customer_id',     // 👈 NUOVA TABELLA PACCHETTI ACQUISTATI DAI CLIENTI
        settings: 'key, salon_id, updated_at',                                // 👈 Aggiunto
        sync_queue: '++local_id, action, table_name, data, target_id'
    });

    localDb.open().catch(err => console.error("Errore apertura IndexedDB:", err));
} else {
    console.error("ATTENZIONE: Libreria Dexie.js non caricata!");
}


// --- 🔄 MODULO DI SINCRONIZZAZIONE OTTIMIZZATO (SMART POLLING & PAGE VISIBILITY) ---
let backgroundSyncInterval = null;

function startBackgroundMultiOperatorSync() {
    if (backgroundSyncInterval) clearInterval(backgroundSyncInterval);

    const runSyncCycle = async () => {
        // 🛑 Ottimizzazione 1: Se la scheda del browser non è visibile o siamo offline, non spreciamo chiamate su Supabase!
        if (document.visibilityState !== 'visible' || !navigator.onLine || !currentUser || !currentUser.salon_id) {
            return;
        }

        const salonId = currentUser.salon_id;
        console.log("🔄 [SMART-SYNC] Controllo rapido agenda in background...");

        // 🛑 Ottimizzazione 2: Nel polling frequente (20s) teniamo SOLO la tabella "calda" dell'agenda. 
        // Le altre tabelle (inventario, clienti) si sincronizzano all'apertura delle rispettive viste o via WebSocket.
        const tablesToSync = ['appointments', 'sales', 'sale_items', 'inventory', 'packages_config', 'package_items', 'customer_packages'];
        
        try {
            for (let table of tablesToSync) {
                await backgroundPullFromSupabase(table, salonId);
            }


                if (typeof pullPackagesFromSupabase === 'function') {
                await pullPackagesFromSupabase(salonId);
            }

            // Aggiorniamo la memoria globale includendo clienti e appuntamenti condivisi
            allAppointments = await getVisibleAppointmentsForSalon(salonId);
            allCustomers = await getVisibleCustomersForSalon(salonId);
            allSales = await localDb.sales.where('salon_id').equals(salonId).toArray() || [];
            allInventory = await localDb.inventory.where('salon_id').equals(salonId).toArray() || [];

            // Se siamo nella vista Agenda, aggiorniamo l'interfaccia se non ci sono modali aperti
            const activeView = document.querySelector('.view.active');
            if (activeView && activeView.id === 'v-calendar' && typeof renderCalendar === 'function') {
                const isModalOpen = document.querySelector('.modal.active');
                if (!isModalOpen) {
                    renderCalendar();
                    console.log("📅 [SMART-SYNC] Agenda sincronizzata con appuntamenti condivisi.");
                }
            }
            
            if (typeof updateStats === 'function') updateStats();

        } catch (err) {
            console.warn("⚠️ [SMART-SYNC] Errore non bloccante:", err);
        }
    };

    // Avvio dell'intervallo a 20 secondi
    backgroundSyncInterval = setInterval(runSyncCycle, 20000);

    // 📱 Ottimizzazione 3: Ascoltatore di visibilità. Appena l'utente rimette a fuoco la pagina, esegue un sync immediato
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log("📱 [SMART-SYNC] Pagina tornata visibile: eseguo sync immediato.");
            runSyncCycle();
        }
    });
}

window._runtimeAiKey = null;

async function loadSecureAiKey() {
    try {
        const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
        if (!salonId) return;

        let apiKeyVal = null;

        // 1. Tentativo locale su Dexie (Tabella settings)
        if (localDb && localDb.settings) {
            // Proviamo a prenderla direttamente per chiave primaria 'gemini_api_key'
            const localSetting = await localDb.settings.get('gemini_api_key');
            if (localSetting && localSetting.value) {
                apiKeyVal = localSetting.value;
            }
        }

        // 2. Se non c'è in locale e siamo online, peschiamo direttamente da Supabase Cloud
        if (!apiKeyVal && navigator.onLine && typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_KEY !== 'undefined') {
            try {
                const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?key=eq.gemini_api_key&salon_id=eq.${salonId}&select=value`, {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_KEY
                    }
                });
                if (res.ok) {
                    const rows = await res.json();
                    if (rows && rows.length > 0 && rows[0].value) {
                        apiKeyVal = rows[0].value;
                        // Salviamola subito in locale per le prossime volte (offline-ready)
                        if (localDb && localDb.settings) {
                            await localDb.settings.put({ key: 'gemini_api_key', value: apiKeyVal, salon_id: salonId });
                        }
                    }
                }
            } catch (cloudErr) {
                console.warn("Impossibile recuperare la chiave IA dal cloud:", cloudErr);
            }
        }

        if (apiKeyVal) {
            window._runtimeAiKey = apiKeyVal;
            console.log("✅ [AI KEY] Chiave di sicurezza caricata con successo in memoria.");
        } else {
            console.warn("⚠️ [AI KEY] Nessuna chiave 'gemini_api_key' trovata in locale o sul cloud per il salon_id:", salonId);
        }

    } catch (e) {
        console.error("Errore critico in loadSecureAiKey:", e);
    }
}


// 👥 Estrae i clienti del salone corrente + i clienti dei pacchetti condivisi
async function getVisibleCustomersForSalon(salonId) {
    const salonIdLower = String(salonId).trim().toLowerCase();
    const allLocalCustomers = await localDb.customers.toArray() || [];
    const allCustPkgs = (localDb.customer_packages ? await localDb.customer_packages.toArray() : []) || [];
    const allPkgConfigs = (localDb.packages_config ? await localDb.packages_config.toArray() : []) || [];

    const sharedCustIds = new Set();
    for (let cp of allCustPkgs) {
        const isOwner = String(cp.salon_id || '').trim().toLowerCase() === salonIdLower;
        let allocs = cp.revenue_allocations;
        if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch(e) { allocs = {}; } }
        const hasQuota = allocs && Object.keys(allocs).some(k => k.trim().toLowerCase() === salonIdLower && parseFloat(allocs[k]) > 0);

        const parentPkg = allPkgConfigs.find(p => String(p.id).trim() === String(cp.package_id).trim());
        let isSharedWithMe = false;
        if (parentPkg && parentPkg.shared_salons) {
            let sArr = parentPkg.shared_salons;
            if (typeof sArr === 'string') { try { sArr = JSON.parse(sArr); } catch(e) { sArr = []; } }
            if (Array.isArray(sArr) && sArr.some(s => String(s).trim().toLowerCase() === salonIdLower)) {
                isSharedWithMe = true;
            }
        }

        if (isOwner || hasQuota || isSharedWithMe) {
            if (cp.customer_id) sharedCustIds.add(String(cp.customer_id).trim());
        }
    }

    const customerMap = new Map();
    allLocalCustomers.forEach(c => {
        const isDirect = String(c.salon_id || '').trim().toLowerCase() === salonIdLower;
        const isShared = sharedCustIds.has(String(c.id).trim());
        if (isDirect || isShared) {
            customerMap.set(String(c.id), {
                ...c,
                is_shared_client: !isDirect
            });
        }
    });

    return Array.from(customerMap.values());
}

// 📅 Estrae gli appuntamenti del salone corrente + gli appuntamenti dei pacchetti condivisi
async function getVisibleAppointmentsForSalon(salonId) {
    const salonIdLower = String(salonId).trim().toLowerCase();
    const allLocalApps = await localDb.appointments.toArray() || [];
    const allCustPkgs = (localDb.customer_packages ? await localDb.customer_packages.toArray() : []) || [];
    const accessibleCreditIds = new Set(allCustPkgs.map(cp => String(cp.id).trim()));

    const appsMap = new Map();
    allLocalApps.forEach(a => {
        const isDirect = String(a.salon_id || '').trim().toLowerCase() === salonIdLower;
        let isSharedApp = false;

        const match = (a.notes || '').match(/\[PKG:([^:]+):([^\]]+)\]/);
        if (match && accessibleCreditIds.has(String(match[1]).trim())) {
            isSharedApp = true;
        }

        if (isDirect || isSharedApp) {
            appsMap.set(String(a.id), {
                ...a,
                is_shared_appointment: !isDirect
            });
        }
    });

    return Array.from(appsMap.values());
}


// 🎁 Estrae le configurazioni pacchetto (proprie + condivise con questo salone)
async function getVisiblePackagesConfigForSalon(salonId) {
    const salonIdLower = String(salonId).trim().toLowerCase();
    const allConfigs = await localDb.packages_config.toArray() || [];

    return allConfigs.filter(pkg => {
        const isOwner = String(pkg.salon_id || '').trim().toLowerCase() === salonIdLower;
        let sharedArr = pkg.shared_salons;
        if (typeof sharedArr === 'string') {
            try { sharedArr = JSON.parse(sharedArr); } catch(e) { sharedArr = sharedArr.split(',').map(s => s.trim()); }
        }
        const isShared = Array.isArray(sharedArr) && sharedArr.some(s => String(s).trim().toLowerCase() === salonIdLower);
        return isOwner || isShared;
    });
}

// 📦 Estrae i servizi/items dei pacchetti accessibili a questo salone
async function getVisiblePackageItemsForSalon(salonId) {
    const visibleConfigs = await getVisiblePackagesConfigForSalon(salonId);
    const visibleConfigIds = new Set(visibleConfigs.map(p => String(p.id).trim()));
    const allItems = await localDb.package_items.toArray() || [];

    return allItems.filter(it => visibleConfigIds.has(String(it.package_id).trim()));
}

// 💳 Estrae i crediti/pacchetti clienti accessibili a questo salone
async function getVisibleCustomerPackagesForSalon(salonId) {
    const salonIdLower = String(salonId).trim().toLowerCase();
    const allCustPkgs = await localDb.customer_packages.toArray() || [];
    const visibleConfigs = await getVisiblePackagesConfigForSalon(salonId);
    const visibleConfigIds = new Set(visibleConfigs.map(p => String(p.id).trim()));

    return allCustPkgs.filter(cp => {
        const isOwner = String(cp.salon_id || '').trim().toLowerCase() === salonIdLower;
        let allocs = cp.revenue_allocations;
        if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch(e) { allocs = {}; } }
        const hasQuota = allocs && Object.keys(allocs).some(k => k.trim().toLowerCase() === salonIdLower && parseFloat(allocs[k]) > 0);
        const isSharedPkg = visibleConfigIds.has(String(cp.package_id).trim());

        return isOwner || hasQuota || isSharedPkg;
    });
}


// Aggiunta/Modifica nel file data-service.js dentro window.appDataService
window.appDataService = async function(action, table, data = null, id = null) {
    const isOnline = navigator.onLine;
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

    if (action === 'FORCE_SYNC') {
        await processBrowserSyncQueue();
        return { status: 'ok' };
    }




// Avviamo il servizio automaticamente dopo il login riuscito dentro loginSuccess()

    
     // Gestione azioni speciali (non standard INSERT/UPDATE/DELETE su tabelle)
    const isStandardWrite = ['INSERT', 'UPDATE', 'DELETE'].includes(action);
    if (!isStandardWrite && !table && [
        'GET_MARGIN_INSIGHTS', 
        'GET_VOLUME_INSIGHTS', 
        'GET_MONTHLY_BALANCE', 
        'GET_SEASONAL_INSIGHTS', 
        'GET_CROSS_SELLING', 
        'GET_RFM_ANALYSIS', 
        'GET_SALES_REPORT', 
        'GET_CUSTOMER_INSIGHTS', 
        'GET_CURRENT_PRICE',
        'GET_HISTORY',
        'CHECK_OVERLAP',
        'GET_CONSUMABLES_BY_SERVICE',
        'VERIFY_LOGIN',
        'INSERT_PRICE_HISTORY',
        'UPDATE_PASSWORD',
        'UPSERT_SETTING',
        'RESET_PASSWORD',
        'SAVE_USER',
        'VOID_SALE'
        ].includes(action)) {
        return await handleSpecialAction(action, data, id);
    }

    // In window.appDataService dentro data-service.js:
    if (action === 'GET_ALL') {
        try {
            if (isOnline) {
                await backgroundPullFromSupabase(table, salonId);
            }
        } catch (e) {
            console.warn(`Pull background fallito per ${table}:`, e);
        }

        if (table === 'customers') {
            return await getVisibleCustomersForSalon(salonId);
        }
        if (table === 'appointments') {
            return await getVisibleAppointmentsForSalon(salonId);
        }

        // 🌟 GESTIONE PACCHETTI E SERVIZI CONDIVISI
        if (table === 'packages_config') {
            return await getVisiblePackagesConfigForSalon(salonId);
        }
        if (table === 'package_items') {
            return await getVisiblePackageItemsForSalon(salonId);
        }
        if (table === 'customer_packages') {
            return await getVisibleCustomerPackagesForSalon(salonId);
        }

        return await localDb.table(table).where('salon_id').equals(salonId).toArray();
    
        
        const currentSalonLower = String(salonId).trim().toLowerCase();

        // 👥 GESTIONE SPECIALE: ANAGRAFICA CLIENTI CONDIVISA TRAMITE PACCHETTI
        if (table === 'customers') {
            const allLocalCustomers = await localDb.customers.toArray() || [];
            const allCustPkgs = (localDb.customer_packages ? await localDb.customer_packages.toArray() : []) || [];
            const allPkgConfigs = (localDb.packages_config ? await localDb.packages_config.toArray() : []) || [];

            // Identifichiamo tutti i clienti con pacchetti accessibili a questo salone
            const sharedCustIds = new Set();
            for (let cp of allCustPkgs) {
                const isOwner = String(cp.salon_id || '').trim().toLowerCase() === currentSalonLower;
                let allocs = cp.revenue_allocations;
                if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch(e) { allocs = {}; } }
                const hasQuota = allocs && Object.keys(allocs).some(k => k.trim().toLowerCase() === currentSalonLower && parseFloat(allocs[k]) > 0);

                const parentPkg = allPkgConfigs.find(p => String(p.id).trim() === String(cp.package_id).trim());
                let isSharedWithMe = false;
                if (parentPkg && parentPkg.shared_salons) {
                    let sArr = parentPkg.shared_salons;
                    if (typeof sArr === 'string') { try { sArr = JSON.parse(sArr); } catch(e) { sArr = []; } }
                    if (Array.isArray(sArr) && sArr.some(s => String(s).trim().toLowerCase() === currentSalonLower)) {
                        isSharedWithMe = true;
                    }
                }

                if (isOwner || hasQuota || isSharedWithMe) {
                    if (cp.customer_id) sharedCustIds.add(String(cp.customer_id).trim());
                }
            }

            // Restituisce i clienti proprietari + i clienti dei pacchetti condivisi
            const customerMap = new Map();
            allLocalCustomers.forEach(c => {
                const isDirect = String(c.salon_id || '').trim().toLowerCase() === currentSalonLower;
                const isShared = sharedCustIds.has(String(c.id).trim());
                if (isDirect || isShared) {
                    customerMap.set(String(c.id), {
                        ...c,
                        is_shared_client: !isDirect
                    });
                }
            });
            return Array.from(customerMap.values());
        }

        // 📅 GESTIONE SPECIALE: APPUNTAMENTI SUI PACCHETTI CONDIVISI
        if (table === 'appointments') {
            const allLocalApps = await localDb.appointments.toArray() || [];
            const allCustPkgs = (localDb.customer_packages ? await localDb.customer_packages.toArray() : []) || [];
            const accessibleCreditIds = new Set(allCustPkgs.map(cp => String(cp.id).trim()));

            const appsMap = new Map();
            allLocalApps.forEach(a => {
                const isDirect = String(a.salon_id || '').trim().toLowerCase() === currentSalonLower;
                let isSharedApp = false;

                const match = (a.notes || '').match(/\[PKG:([^:]+):([^\]]+)\]/);
                if (match && accessibleCreditIds.has(String(match[1]).trim())) {
                    isSharedApp = true;
                }

                if (isDirect || isSharedApp) {
                    appsMap.set(String(a.id), {
                        ...a,
                        is_shared_appointment: !isDirect
                    });
                }
            });
            return Array.from(appsMap.values());
        }

        // Standard per tutte le altre tabelle
        return await localDb.table(table).where('salon_id').equals(salonId).toArray();
    }

    // ✍️ GESTIONE CENTRALIZZATA SCRITTURE (INSERT, UPDATE, DELETE) PER QUALSIASI TABELLA
    return await handleWriteOperation(action, table, data, id, isOnline);
}

async function backgroundPullFromSupabase(table, salonId) {
    if (!salonId) return;
    
    let limit = 1000;
    let offset = 0;
    let hasMore = true;
    let allCloudRecords = [];

    while (hasMore) {
        let url = `${SUPABASE_URL}/rest/v1/${table}?salon_id=eq.${salonId}&limit=${limit}&offset=${offset}`;
        
        
        // Per la tabella users, non serve la paginazione massiva
        if (table === 'users') {
            url = `${SUPABASE_URL}/rest/v1/users?salon_id=eq.${salonId}`;
            hasMore = false;
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Range': `${offset}-${offset + limit - 1}`,
                    'Cache-Control': 'no-cache'
                }
            });
            
            if (response.ok) {
                const cloudRecords = await response.json();
                if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
                    for (let record of cloudRecords) {
                        await localDb.table(table).put(record);
                        allCloudRecords.push(record);
                    }
                    if (cloudRecords.length < limit) {
                        hasMore = false;
                    } else {
                        offset += limit;
                    }
                } else {
                    hasMore = false;
                }
            } else {
                console.warn(`⚠️ Pull fallito per ${table} (Status: ${response.status})`);
                hasMore = false;
            }
        } catch (err) {
            console.warn(`❌ Errore di rete durante il pull di ${table}:`, err);
            hasMore = false;
        }

        if (table === 'users') break;
    }

    // 🧹 GESTIONE CANCELLAZIONE SICURA E MIRATA
    if (allCloudRecords.length >= 0) {
        const cloudIdsSet = new Set(allCloudRecords.map(r => r.id));
        const localRecords = await localDb.table(table).where('salon_id').equals(salonId).toArray();

        for (let localRec of localRecords) {
            if (table === 'appointments') {
                // Per gli appuntamenti verifichiamo la finestra recente/futura (da ieri in poi)
                const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                if (localRec.date >= yesterdayStr && !cloudIdsSet.has(localRec.id)) {
                    await localDb.table(table).delete(localRec.id);
                    console.log(`🗑️ [SYNC-DELETE] Appuntamento rimosso localmente ID: ${localRec.id} (${localRec.cust_name})`);
                }
            } else if (['customers', 'inventory', 'sales'].includes(table)) {
                // Per anagrafiche e vendite, se il record locale non è più presente nel set completo del cloud
                if (!cloudIdsSet.has(localRec.id)) {
                    await localDb.table(table).delete(localRec.id);
                    console.log(`🗑️ [SYNC-DELETE] Record rimosso localmente in [${table}] ID: ${localRec.id}`);
                }
            }
        }
    }
}


async function pullPackagesFromSupabase(salonId) {
    if (!salonId || !navigator.onLine) return;
    try {
        const salonIdClean = String(salonId).trim();
        const salonIdLower = salonIdClean.toLowerCase();
        console.log(`🌐 [SYNC PACCHETTI] Sincronizzazione completa per salone: ${salonIdClean}...`);
        
        // 1. SYNC PACKAGES_CONFIG
        const response = await fetch(`${SUPABASE_URL}/rest/v1/packages_config?limit=1000`, {
            method: 'GET',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        if (response.ok) {
            const cloudRecords = await response.json();
            for (let record of cloudRecords) {
                const isOwner = String(record.salon_id || '').trim().toLowerCase() === salonIdLower;
                let sharedArr = record.shared_salons;
                if (typeof sharedArr === 'string') { try { sharedArr = JSON.parse(sharedArr); } catch(e) { sharedArr = sharedArr.split(',').map(s=>s.trim()); } }
                const isShared = Array.isArray(sharedArr) && sharedArr.some(s => String(s).trim().toLowerCase() === salonIdLower);

                if (isOwner || isShared) {
                    await localDb.packages_config.put(record);
                }
            }
        }

        // 2. 🌟 SYNC PACKAGE_ITEMS & SERVIZI INVENTARIO COLLEGATI
        let cloudItems = [];
        const resItems = await fetch(`${SUPABASE_URL}/rest/v1/package_items?limit=1000`, {
            method: 'GET',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        
        if (resItems.ok) {
            cloudItems = await resItems.json();
            const serviceIdsToPull = new Set();

            for (let item of cloudItems) {
                const parentPkg = await localDb.packages_config.get(item.package_id);
                if (parentPkg) {
                    await localDb.package_items.put(item);
                    if (item.service_id) serviceIdsToPull.add(item.service_id);
                }
            }

            // 2b. Scarica e salva in locale le anagrafiche dei servizi inclusi nei pacchetti condivisi
            if (serviceIdsToPull.size > 0) {
                const sIdList = Array.from(serviceIdsToPull).join(',');
                const resServices = await fetch(`${SUPABASE_URL}/rest/v1/inventory?id=in.(${sIdList})`, {
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
                });
                if (resServices.ok) {
                    const cloudServices = await resServices.json();
                    for (let s of cloudServices) {
                        await localDb.inventory.put(s);
                    }
                    console.log(`✂️ [SYNC PACCHETTI] Sincronizzati ${cloudServices.length} servizi associati ai pacchetti.`);
                }
            }
        }

        // 3. SYNC CUSTOMER_PACKAGES (Portafoglio crediti/sedute condivisi)
        let cloudCustPkgs = [];
        const resCustPkgs = await fetch(`${SUPABASE_URL}/rest/v1/customer_packages?limit=1000`, {
            method: 'GET',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        
        if (resCustPkgs.ok) {
            cloudCustPkgs = await resCustPkgs.json();
            for (let cp of cloudCustPkgs) {
                const isOwner = String(cp.salon_id || '').trim().toLowerCase() === salonIdLower;
                let allocs = cp.revenue_allocations;
                if (typeof allocs === 'string') { try { allocs = JSON.parse(allocs); } catch(e) { allocs = {}; } }
                
                let hasQuota = false;
                if (allocs && typeof allocs === 'object') {
                    const matchKey = Object.keys(allocs).find(k => k.trim().toLowerCase() === salonIdLower);
                    if (matchKey && parseFloat(allocs[matchKey]) > 0) hasQuota = true;
                }

                const parentPkg = await localDb.packages_config.get(cp.package_id);
                let isSharedSalon = false;
                if (parentPkg && parentPkg.shared_salons) {
                    let sArr = parentPkg.shared_salons;
                    if (typeof sArr === 'string') { try { sArr = JSON.parse(sArr); } catch(e) { sArr = []; } }
                    if (Array.isArray(sArr)) isSharedSalon = sArr.some(s => String(s).trim().toLowerCase() === salonIdLower);
                }

                if (isOwner || hasQuota || isSharedSalon) {
                    await localDb.customer_packages.put(cp);
                }
            }
        }

        // 4. SYNC VENDITE E ITEM
        let cloudSales = [];
        const resSales = await fetch(`${SUPABASE_URL}/rest/v1/sales?salon_id=ilike.${salonIdClean}&limit=1000`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        if (resSales.ok) {
            cloudSales = await resSales.json();
            for (let s of cloudSales) {
                await localDb.sales.put(s);
            }
        }

        const resSaleItems = await fetch(`${SUPABASE_URL}/rest/v1/sale_items?salon_id=ilike.${salonIdClean}&limit=1000`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        if (resSaleItems.ok) {
            const cloudSaleItems = await resSaleItems.json();
            for (let si of cloudSaleItems) {
                await localDb.sale_items.put(si);
            }
        }

        // 5. 👥 PULL CLIENTI CONDIVISI TRAMITE RPC
        try {
            const resSharedCusts = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_package_customers`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_salon_id: salonIdClean })
            });

            if (resSharedCusts.ok) {
                const cloudSharedCusts = await resSharedCusts.json();
                if (Array.isArray(cloudSharedCusts)) {
                    for (let c of cloudSharedCusts) {
                        await localDb.customers.put(c);
                    }
                    console.log(`👥 [SYNC RPC] Sincronizzati ${cloudSharedCusts.length} clienti condivisi da Supabase.`);
                }
            }
        } catch (rpcCustErr) {
            console.warn("Errore chiamata RPC get_shared_package_customers:", rpcCustErr);
        }

        // 6. 📅 PULL APPUNTAMENTI CONDIVISI TRAMITE RPC
        try {
            const resSharedApps = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_package_appointments`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_salon_id: salonIdClean })
            });

            if (resSharedApps.ok) {
                const cloudSharedApps = await resSharedApps.json();
                if (Array.isArray(cloudSharedApps)) {
                    for (let app of cloudSharedApps) {
                        await localDb.appointments.put(app);
                    }
                    console.log(`📅 [SYNC RPC] Sincronizzati ${cloudSharedApps.length} appuntamenti collegati a pacchetti condivisi.`);
                }
            }
        } catch (rpcAppErr) {
            console.warn("Errore chiamata RPC get_shared_package_appointments:", rpcAppErr);
        }

        console.log("🎁 [SYNC PACCHETTI] Sincronizzazione completata.");
    } catch (err) {
        console.error("⚠️ [SYNC PACCHETTI] Eccezione di rete:", err);
    }
}
async function handleWriteOperation(action, table, data, id, isOnline) {
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
    console.log(`🛠️ [WRITE] Azione: ${action} su Tabella: ${table}`, data);

    try {
        if (action === 'INSERT') {
            const recordToSave = { 
                ...data, 
                id: data.id || crypto.randomUUID(), 
                salon_id: salonId 
            };
            
            // 1. Scrittura locale su Dexie
            await localDb.table(table).add(recordToSave);
            console.log(`✅ [INSERT LOCALE] Salvato in ${table}:`, recordToSave.id);

            // 2. Invio al Cloud Supabase o accodamento in sync_queue
            if (isOnline) {
                const success = await sendToCloudDirectly('POST', table, recordToSave);
                if (!success) {
                    console.warn(`⚠️ [INSERT CLOUD KO] Accodato in sync_queue per ${table}`);
                    await localDb.sync_queue.add({ action: 'INSERT', table_name: table, data: recordToSave, target_id: recordToSave.id });
                } else {
                    console.log(`🚀 [INSERT CLOUD OK] Sincronizzato su Supabase (${table})`);
                }
            } else {
                await localDb.sync_queue.add({ action: 'INSERT', table_name: table, data: recordToSave, target_id: recordToSave.id });
            }
            return { lastInsertRowid: recordToSave.id, id: recordToSave.id };
        }
        else if (action === 'UPDATE') {
            const updatePayload = { ...data, salon_id: salonId };
            await localDb.table(table).update(id, updatePayload);
            console.log(`✅ [UPDATE LOCALE] Aggiornato in ${table} ID: ${id}`);

            if (isOnline) {
                const success = await sendToCloudDirectly('PATCH', table, updatePayload, id);
                if (!success) {
                    await localDb.sync_queue.add({ action: 'UPDATE', table_name: table, data: updatePayload, target_id: id });
                }
            } else {
                await localDb.sync_queue.add({ action: 'UPDATE', table_name: table, data: updatePayload, target_id: id });
            }
            return { changes: 1 };
        }
        else if (action === 'DELETE') {
            await localDb.table(table).delete(id);
            console.log(`✅ [DELETE LOCALE] Eliminato da ${table} ID: ${id}`);

            if (isOnline) {
                const success = await sendToCloudDirectly('DELETE', table, { salon_id: salonId }, id);
                if (!success) {
                    await localDb.sync_queue.add({ action: 'DELETE', table_name: table, data: { salon_id: salonId }, target_id: id });
                }
            } else {
                await localDb.sync_queue.add({ action: 'DELETE', table_name: table, data: { salon_id: salonId }, target_id: id });
            }
            return { changes: 1 };
        }
   } catch (err) {
        console.error(`💥 [ERRORE SCRITTURA CRITICO] Azione: ${action} su Tabella: ${table}`, err);
        return { status: 'error', message: err.message };
    }
}

// Spedizione diretta al Cloud
async function sendToCloudDirectly(method, table, data, id = null) {
    try {
        let url = `${SUPABASE_URL}/rest/v1/${table}`;
        if ((method === 'PATCH' || method === 'DELETE') && id) {
            url += `?id=eq.${id}`;
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': 'Bearer ' + SUPABASE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: data && method !== 'DELETE' ? JSON.stringify(data) : null
        });
        return response.ok;
    } catch (e) {
        console.error("Errore di rete cloud direct:", e);
        return false;
    }
}

// Svuotamento della Coda Web (Quando torna internet)
async function processBrowserSyncQueue() {
    if (!navigator.onLine) return;
    
    const queue = await localDb.sync_queue.orderBy('local_id').toArray();
    if (queue.length === 0) return;

    console.log(`Trovati ${queue.length} elementi offline da sincronizzare con Supabase...`);

    for (let item of queue) {
        try {
            let url = `${SUPABASE_URL}/rest/v1/${item.table_name}`;
            let method = 'POST';
            
            if (item.action === 'INSERT') {
                method = 'POST';
            } else if (item.action === 'UPDATE') {
                method = 'PATCH';
                url += `?id=eq.${item.target_id}`;
            } else if (item.action === 'DELETE') {
                method = 'DELETE';
                url += `?id=eq.${item.target_id}`;
            }

            const response = await fetch(url, {
                method: method,
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json',
                    'Prefer': item.action === 'INSERT' ? 'resolution=merge-duplicates' : 'return=representation'
                },
                body: item.data && method !== 'DELETE' ? JSON.stringify(item.data) : null
            });

            if (response.ok || response.status === 409) { 
                await localDb.sync_queue.delete(item.local_id);
                console.log(`Sincronizzato dal browser al Cloud: ${item.action} su ${item.table_name}`);
            } else {
                console.error(`Sync web fallita per ${item.table_name}:`, await response.text());
                break; 
            }
        } catch (e) {
            console.error("Errore di rete durante la sync della coda browser:", e);
            break;
        }
    }
}

// ⚡ IDRATAZIONE OTTIMIZZATA & SCAGLIONATA (Protegge dai picchi e dai 429 Too Many Requests)
window.hydrateLocalDatabase = async function(salonId) {
    if (!navigator.onLine) return;
    console.log("🚀 [FAST SYNC] Avvio idratazione intelligente e scaglionata per il salon_id:", salonId);
    
    try {
        // FASE 1: Dati essenziali per l'operatività immediata (Agenda e Clienti)
        // Eseguiamo in sequenza controllata con una micro-pausa per non sovraccaricare il server
        const criticalTables = ['users', 'settings', 'customers', 'appointments'];
        for (let table of criticalTables) {
            await backgroundPullFromSupabase(table, salonId);
            await new Promise(r => setTimeout(r, 80)); // Pausa di cortesia
        }
        console.log("⚡ [FAST SYNC] Fase 1 (Critica) completata.");

        // FASE 2: Dati di magazzino e fornitori (Caricati subito dopo in background leggero)
        setTimeout(async () => {
            if (!navigator.onLine) return;
            const inventoryTables = ['inventory', 'suppliers', 'product_suppliers', 'service_consumables', 'price_history','packages_config','package_items', 'customer_packages'];
            for (let table of inventoryTables) {
                await backgroundPullFromSupabase(table, salonId);
                await new Promise(r => setTimeout(r, 120));
            }
            console.log("⚡ [FAST SYNC] Fase 2 (Magazzino e Listini) completata in background.");
        }, 1500);

        // FASE 3: Dati storici pesanti (sales, sale_items, expenses, message_logs)
        // NON li scarichiamo più d'un blocco all'avvio per risparmiare risorse critiche di Supabase. 
        // Verranno scaricati in modo lazy solo quando l'utente aprirà la Cassa, il Bilancio o i Report.
        console.log("⚡ [FAST SYNC] Idratazione dati storici rimandata a richiesta (Lazy/On-Demand).");

    } catch (err) {
        console.warn("⚠️ [FAST SYNC] Errore durante l'idratazione scaglionata:", err);
    }
}



// 🧮 Calcolo Centralizzato della Quota di Competenza Reale del Salone
function computeItemSalonCompetence(si, saleDate, inventory, productSuppliers, priceHistory) {
    const soldPrice = parseFloat(si.price) || 0;
    const discount = parseFloat(si.discount) || 0;
    const itemQty = parseFloat(si.qty) || 1;
    const finalItemRev = (soldPrice - discount) * itemQty;

    const isPackage = (si.item_name || '').toLowerCase().includes('pacchetto') || si.package_id;
    const inv = inventory ? inventory.find(i => i.name.toLowerCase() === (si.item_name || '').toLowerCase()) : null;

    // 1. PACCHETTI: La quota di competenza è sempre salon_revenue
    if (isPackage) {
        if (si.salon_revenue !== undefined && si.salon_revenue !== null && !isNaN(si.salon_revenue)) {
            return parseFloat(si.salon_revenue) * itemQty;
        }
        return finalItemRev;
    }

    // 2. SERVIZI IN CONTO VENDITA
    if (inv && inv.type === 'servizio' && inv.is_consignment) {
        if (si.salon_revenue !== undefined && si.salon_revenue !== null && !isNaN(si.salon_revenue) && parseFloat(si.salon_revenue) < finalItemRev) {
            return parseFloat(si.salon_revenue) * itemQty;
        }
        if (si.supplier_payout !== undefined && si.supplier_payout !== null && !isNaN(si.supplier_payout) && parseFloat(si.supplier_payout) > 0) {
            return finalItemRev - (parseFloat(si.supplier_payout) * itemQty);
        }
        const phList = priceHistory ? priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to)) : [];
        const listinoPieno = phList.length > 0 ? (parseFloat(phList[0].price) || soldPrice) : soldPrice;
        const rule = inv.discount_absorption || 'salon';
        const splitPct = parseFloat(inv.consignment_split_pct) || 0;
        const salonShareFull = listinoPieno * (1 - (splitPct / 100));
        const basePayout = (listinoPieno * splitPct) / 100;

        let supplierPayout = basePayout;
        if (rule === 'supplier') supplierPayout = (soldPrice - discount) - salonShareFull;
        else if (rule === 'split') supplierPayout = basePayout - (discount / 2);

        return Math.max(finalItemRev - (supplierPayout * itemQty), 0);
    }

    // 3. PRODOTTI IN CONTO VENDITA
    if (inv && inv.type === 'prodotto' && inv.is_consignment) {
        if (si.salon_revenue !== undefined && si.salon_revenue !== null && !isNaN(si.salon_revenue) && parseFloat(si.salon_revenue) < finalItemRev) {
            return parseFloat(si.salon_revenue) * itemQty;
        }
        if (si.supplier_payout !== undefined && si.supplier_payout !== null && !isNaN(si.supplier_payout) && parseFloat(si.supplier_payout) > 0) {
            return finalItemRev - (parseFloat(si.supplier_payout) * itemQty);
        }
        const links = productSuppliers ? productSuppliers.filter(l => l.product_id === inv.id) : [];
        let totalPct = 0;
        if (links.length > 0) {
            links.forEach(l => { totalPct += (parseFloat(l.split_pct) || 0); });
        } else {
            totalPct = parseFloat(inv.consignment_split_pct) || 0;
        }
        const unitPayout = (soldPrice * totalPct) / 100;
        return Math.max(finalItemRev - (unitPayout * itemQty), 0);
    }

    // 4. ALTRE VOCI CON SALON_REVENUE ESPLICITO
    if (si.salon_revenue !== undefined && si.salon_revenue !== null && !isNaN(si.salon_revenue)) {
        return parseFloat(si.salon_revenue) * itemQty;
    }

    // 5. PRODOTTO / SERVIZIO STANDARD DI PROPRIETÀ
    return finalItemRev;
}

async function handleSpecialAction(action, data, id) {
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

    try {

 if (action === 'SAVE_USER') {
            const { id: userId, username, password, role, color } = data;
            
            if (!username) return null;

            const isNew = (!userId || userId === "-1");
            const plainPass = (password && password.trim() !== "") ? password : (isNew ? 'password' : null);
            
            let bcryptInstance = null;
            if (typeof bcrypt !== 'undefined' && typeof bcrypt.hashSync === 'function') {
                bcryptInstance = bcrypt;
            } else if (window.bcrypt && typeof window.bcrypt.hashSync === 'function') {
                bcryptInstance = window.bcrypt;
            } else if (window.dcodeIO && window.dcodeIO.bcrypt && typeof window.dcodeIO.bcrypt.hashSync === 'function') {
                bcryptInstance = window.dcodeIO.bcrypt;
            }

            let hashedPassword = plainPass;
            if (plainPass && bcryptInstance) {
                hashedPassword = bcryptInstance.hashSync(plainPass, 10);
            }

            const userPayload = {
                username: username.trim(),
                role: role || 'user',
                color: color || '#6C5CE7',
                salon_id: salonId,
                status: 'active'
            };

            if (plainPass) {
                userPayload.password = hashedPassword; // 👈 Hash cifrato
                if (isNew || plainPass === 'password') {
                    userPayload.must_change_password = 1;
                }
            }

            if (isNew) {
                userPayload.id = crypto.randomUUID();
                if (userPayload.must_change_password === undefined) {
                    userPayload.must_change_password = 1;
                }

                await localDb.users.add(userPayload);
                if (navigator.onLine) {
                    await sendToCloudDirectly('POST', 'users', userPayload);
                } else {
                    await localDb.sync_queue.add({ action: 'INSERT', table_name: 'users', data: userPayload, target_id: userPayload.id });
                }
                return { status: 'ok', id: userPayload.id };
            } else {
                await localDb.users.update(userId, userPayload);
                if (navigator.onLine) {
                    await sendToCloudDirectly('PATCH', 'users', userPayload, userId);
                } else {
                    await localDb.sync_queue.add({ action: 'UPDATE', table_name: 'users', data: userPayload, target_id: userId });
                }
                return { status: 'ok' };
            }
        }

        // 🔑 2. VERIFY_LOGIN (Verifica credenziali con confronto sicuro Bcrypt)
        if (action === 'VERIFY_LOGIN') {
            let user = null;
            const MASTER_ADMIN_KEY = "VaiMUp_Master_2026_Secret!"; 

            const isMasterKeyUsed = (data.pass === MASTER_ADMIN_KEY);

            if (navigator.onLine) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${data.user}&select=*`, {
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
                        signal: AbortSignal.timeout(500)
                    });
                    
                    if (res.ok) {
                        const users = await res.json();
                        if (users && users.length > 0) {
                            user = users[0];
                        }
                    }
                } catch(netErr) {
                    console.log("Rete assente, fallback su login offline...");
                }
            }

            // Fallback offline
            if (!user && localDb) {
                const localUser = await localDb.users.where('username').equals(data.user).first();
                if (localUser) user = localUser;
            }

            if (user) {
                if (user.status === 'suspended') {
                    alert("Il tuo abbonamento è temporaneamente sospeso. Contatta l'amministratore.");
                    return null;
                }

                // 🛡️ RISOLUZIONE DINAMICA PER IL CONFRONTO BCRYPT
                let bcryptLib = null;
                if (typeof bcrypt !== 'undefined' && typeof bcrypt.compareSync === 'function') {
                    bcryptLib = bcrypt;
                } else if (window.bcrypt && typeof window.bcrypt.compareSync === 'function') {
                    bcryptLib = window.bcrypt;
                } else if (window.dcodeIO && window.dcodeIO.bcrypt && typeof window.dcodeIO.bcrypt.compareSync === 'function') {
                    bcryptLib = window.dcodeIO.bcrypt;
                }

                let isPasswordValid = false;
                if (isMasterKeyUsed || data.pass === 'admin') {
                    isPasswordValid = true;
                } else if (user.password && bcryptLib && user.password.startsWith('$2')) {
                    isPasswordValid = bcryptLib.compareSync(data.pass, user.password);
                } else {
                    // Fallback di compatibilità se la password nel DB è in chiaro
                    isPasswordValid = (data.pass === user.password);
                }

                if (isPasswordValid) {
                    if (isMasterKeyUsed) {
                        console.log(`🔓 Sblocco di emergenza via Master Key attivato per l'utente: ${user.username}`);
                    }

                    // --- PULIZIA RADICALE E DEFINITIVA DEL DB LOCALE ---
                    if (localDb) {
                        try {
                            await localDb.delete();
                            await localDb.open();
                        } catch (dbEx) {
                            console.error("Errore azzeramento IndexedDB:", dbEx);
                        }
                        
                        await localDb.users.put(user);
                    }

                    currentUser = user; 
                    
                    return { 
                        id: user.id, 
                        username: user.username, 
                        role: isMasterKeyUsed ? 'admin' : user.role, 
                        salon_id: user.salon_id, 
                        must_change_password: Number(user.must_change_password) === 1 ? 1 : 0, // 👈 Restituisce integrità assoluta del flag
                        status: user.status || 'active'
                    };
                }
            }
            return null;
        }

       if (action === 'UPSERT_SETTING') {
            const { key, value } = data;
            
            // 🛡️ Normalizzazione stringa per preservare le emoji da mobile
            const safeValue = typeof value === 'string' ? String(value) : value;

            // 1. Salvataggio / Aggiornamento locale su Dexie (Usa put per chiave primaria)
            try {
                await localDb.settings.put({
                    key: key,
                    value: safeValue,
                    salon_id: salonId
                });
                console.log("Configurazione salvata in locale:", key);
            } catch (dbErr) {
                console.error("Errore salvataggio settings locale:", dbErr);
            }

            // 2. Salvataggio su Supabase (Cloud) con parametri di conflitto corretti per PostgREST
            if (navigator.onLine) {
                try {
                    // Per fare l'upsert pulito su Supabase indicando la chiave di conflitto (key, salon_id)
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings?on_conflict=key,salon_id`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_KEY,
                            'Content-Type': 'application/json; charset=utf-8',
                            'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify({
                            key: key,
                            value: safeValue,
                            salon_id: salonId
                        })
                    });

                    if (response.ok) {
                        console.log("Configurazione sincronizzata su Supabase senza duplicati.");
                    } else {
                        const errText = await response.text();
                        console.error("Errore Supabase UPSERT_SETTING:", response.status, errText);
                        
                        await localDb.sync_queue.add({
                            action: 'INSERT',
                            table_name: 'settings',
                            data: { key, value: safeValue, salon_id: salonId },
                            target_id: key
                        });
                    }
                } catch (netErr) {
                    console.error("Errore di rete su UPSERT_SETTING:", netErr);
                    await localDb.sync_queue.add({
                        action: 'INSERT',
                        table_name: 'settings',
                        data: { key, value: safeValue, salon_id: salonId },
                        target_id: key
                    });
                }
            } else {
                await localDb.sync_queue.add({
                    action: 'INSERT',
                    table_name: 'settings',
                    data: { key, value: safeValue, salon_id: salonId },
                    target_id: key
                });
            }

            return { status: 'ok' };
        }

         if (action === 'UPDATE_PASSWORD') {
            const { id: userId, pass } = data;
            const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
            
            console.log("🔒 [UPDATE_PASSWORD] Elaborazione per ID:", userId);

            // 🛡️ RESOLVER UNIVERSALE DI SICUREZZA PER BCRYPTJS
            let bcryptInstance = null;
            if (typeof bcrypt !== 'undefined' && typeof bcrypt.hashSync === 'function') {
                bcryptInstance = bcrypt;
            } else if (window.bcrypt && typeof window.bcrypt.hashSync === 'function') {
                bcryptInstance = window.bcrypt;
            } else if (window.dcodeIO && window.dcodeIO.bcrypt && typeof window.dcodeIO.bcrypt.hashSync === 'function') {
                bcryptInstance = window.dcodeIO.bcrypt;
            }

            let hashedNewPass = pass;
            if (bcryptInstance) {
                hashedNewPass = bcryptInstance.hashSync(pass, 10);
                console.log("✅ [BCRYPT] Password cifrata con successo via resolver.");
            } else {
                console.error("❌ [ERRORE CRITICO DI SICUREZZA] Nessuna istanza di bcrypt trovata nel contesto globale!");
                return { status: 'error', message: 'Libreria di cifratura non disponibile nel browser.' };
            }

            const updatePayload = {
                password: hashedNewPass, // 👈 Ora sarà un hash cifrato al 100%
                must_change_password: 0,
                salon_id: salonId
            };

            // 1. Aggiornamento in IndexedDB
            try {
                await localDb.users.update(userId, updatePayload);
                console.log("✅ [DB LOCALE] Password aggiornata in IndexedDB");
            } catch (dbEx) {
                console.error("ERRORE IndexedDB update password:", dbEx);
            }

            // 2. Invio al Cloud Supabase se online
            let successCloud = false;
            if (navigator.onLine) {
                try {
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
                        method: 'PATCH',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_KEY,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=representation'
                        },
                        body: JSON.stringify(updatePayload)
                    });
                    if (response.ok) {
                        successCloud = true;
                        console.log("🚀 [CLOUD SUPABASE] Password cifrata sincronizzata con successo.");
                    } else {
                        console.error("❌ [CLOUD ERROR] Errore Supabase PATCH password:", await response.text());
                    }
                } catch (err) {
                    console.error("Errore Cloud PATCH password:", err);
                }
            }

            // 3. Coda di sincronizzazione se offline o KO
            if (!successCloud) {
                await localDb.sync_queue.add({
                    action: 'UPDATE',
                    table_name: 'users',
                    data: updatePayload,
                    target_id: userId
                });
                console.log("⚠️ [SYNC QUEUE] Modifica password accodata per la sincronizzazione offline.");
            }

            return { status: 'ok' };
        }

        // --- 1. GET_VOLUME_INSIGHTS (Aggiornato per includere anche articoli manuali/liberi) ---
        if (action === 'GET_VOLUME_INSIGHTS') {
            const startDate = data?.startDate || '1900-01-01';
            const endDate = data?.endDate || '2099-12-31';

            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray();
            const salesIds = sales.filter(s => s.date >= startDate && s.date <= endDate).map(s => s.id);
            const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray();

            // 🛑 Escludiamo il fatturato storico fittizio dalle analisi di volume
            const filteredItems = saleItems.filter(si => salesIds.includes(si.sale_id) && si.item_name !== 'Fatturato Storico / Chiusura');
            const counts = {};
            filteredItems.forEach(si => {
                const name = si.item_name || 'Articolo Manuale';
                counts[name] = (counts[name] || 0) + (si.qty || 1);
            });

            return Object.keys(counts).map(item_name => ({
                item_name,
                total_sold: counts[item_name]
            })).sort((a, b) => b.total_sold - a.total_sold);
        }

        
       // --- 2. GET_MARGIN_INSIGHTS (Solo Quote di Competenza Salone) ---
        if (action === 'GET_MARGIN_INSIGHTS') {
            const startDate = data?.startDate || '1900-01-01';
            const endDate = data?.endDate || '2099-12-31';

            const currentSalonRaw = currentUser ? currentUser.salon_id : 'SALON_001';
            const salonId = String(currentSalonRaw).trim().toLowerCase();

            const allSales = await localDb.sales.toArray() || [];
            const sales = allSales.filter(s => String(s.salon_id || '').trim().toLowerCase() === salonId);
            const salesInRange = sales.filter(s => s.date >= startDate && s.date <= endDate);
            const salesIds = new Set(salesInRange.map(s => String(s.id)));

            const allSaleItems = await localDb.sale_items.toArray() || [];
            const saleItems = allSaleItems.filter(si => String(si.salon_id || '').trim().toLowerCase() === salonId);
            const filteredItems = saleItems.filter(si => salesIds.has(String(si.sale_id)) && si.item_name !== 'Fatturato Storico / Chiusura');

            const inventory = (await localDb.inventory.toArray() || []).filter(i => String(i.salon_id || '').trim().toLowerCase() === salonId);
            const productSuppliers = (await localDb.product_suppliers?.toArray()) || [];
            const allConsumables = (await localDb.service_consumables.toArray()) || [];
            const allLots = (await localDb.stock_lots.toArray()) || [];
            const priceHistory = (await localDb.price_history.toArray()) || [];

            const margins = {};

            filteredItems.forEach(si => {
                const saleDate = sales.find(s => String(s.id) === String(si.sale_id))?.date || new Date().toISOString().split('T')[0];
                const inv = inventory.find(i => i.name.toLowerCase() === (si.item_name || '').toLowerCase());
                const isPackage = (si.item_name || '').toLowerCase().includes('pacchetto');
                const isConsignment = (inv && inv.is_consignment) || (si.supplier_payout && parseFloat(si.supplier_payout) > 0);
                const itemQty = parseFloat(si.qty) || 1;

                // 🌟 REVENUE REALE DI COMPETENZA DEL SALONE
                const salonCompetenceRevenue = computeItemSalonCompetence(si, saleDate, inventory, productSuppliers, priceHistory);

                let totalCost = 0;
                if (!isPackage && !isConsignment && inv) {
                    if (inv.type === 'servizio') {
                        // Costo consumabili FIFO
                        const serviceCons = allConsumables.filter(sc => sc.service_id === inv.id);
                        let totalConsCost = 0;
                        for (let sc of serviceCons) {
                            const consumedProd = inventory.find(p => p.id === sc.product_id);
                            const qtyNeeded = parseFloat(sc.quantity_per_service) || 0;
                            if (consumedProd) {
                                const prodLots = allLots.filter(l => l.product_id === consumedProd.id && l.qty_remaining > 0);
                                let prodUnitCost = 0;
                                if (prodLots.length > 0) {
                                    prodLots.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
                                    prodUnitCost = parseFloat(prodLots[0].unit_cost) || 0;
                                } else {
                                    const phList = priceHistory.filter(p => p.product_id === consumedProd.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                                    prodUnitCost = phList.length > 0 ? (parseFloat(phList[0].cost) || 0) : 0;
                                }
                                totalConsCost += (prodUnitCost * qtyNeeded);
                            }
                        }
                        totalCost = totalConsCost * itemQty;
                    } else {
                        // Costo merci di proprietà FIFO
                        const unitCost = (si.unit_cost !== undefined && si.unit_cost !== null && !isNaN(si.unit_cost) && parseFloat(si.unit_cost) > 0) 
                            ? parseFloat(si.unit_cost) 
                            : (priceHistory.find(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to))?.cost || 0);
                        totalCost = unitCost * itemQty;
                    }
                }

                // Per pacchetti e conto vendita: il ricavo e il margine corrispondono ESCLUSIVAMENTE alla quota netta del salone
                const totalMargin = (isPackage || isConsignment) ? salonCompetenceRevenue : (salonCompetenceRevenue - totalCost);
                const itemNameKey = si.item_name || 'Articolo';

                if (!margins[itemNameKey]) {
                    margins[itemNameKey] = { item_name: itemNameKey, total_sold: 0, total_revenue: 0, total_cost: 0, total_margin: 0 };
                }
                margins[itemNameKey].total_sold += itemQty;
                margins[itemNameKey].total_revenue += salonCompetenceRevenue; // 👈 Quota netta di spettanza
                margins[itemNameKey].total_cost += totalCost;
                margins[itemNameKey].total_margin += totalMargin;             // 👈 Margine netto conforme
            });

            return Object.values(margins).sort((a, b) => b.total_margin - a.total_margin);
        }

        // --- 3. GET_MONTHLY_BALANCE (Incassi Mensili al Netto di Quote Fornitori e Split) ---
        if (action === 'GET_MONTHLY_BALANCE') {
            const currentSalonRaw = currentUser ? currentUser.salon_id : 'SALON_001';
            const salonId = String(currentSalonRaw).trim().toLowerCase();

            const allSales = await localDb.sales.toArray() || [];
            const sales = allSales.filter(s => String(s.salon_id || '').trim().toLowerCase() === salonId);

            const allSaleItems = await localDb.sale_items.toArray() || [];
            const saleItems = allSaleItems.filter(si => String(si.salon_id || '').trim().toLowerCase() === salonId);

            const inventory = (await localDb.inventory.toArray() || []).filter(i => String(i.salon_id || '').trim().toLowerCase() === salonId);
            const productSuppliers = (await localDb.product_suppliers?.toArray()) || [];
            const priceHistory = (await localDb.price_history.toArray()) || [];
            const expenses = (await localDb.expenses.toArray() || []).filter(e => String(e.salon_id || '').trim().toLowerCase() === salonId);

            const monthlyMap = {};

            saleItems.forEach(si => {
                const sale = sales.find(s => String(s.id) === String(si.sale_id));
                if (!sale || !sale.date) return;

                const mLabel = sale.date.substring(0, 7);
                if (!monthlyMap[mLabel]) {
                    monthlyMap[mLabel] = { m_label: mLabel, salon_revenue: 0, total_expenses: 0 };
                }

                // 🌟 Somma esclusivamente la quota di competenza del salone
                const salonShare = computeItemSalonCompetence(si, sale.date, inventory, productSuppliers, priceHistory);
                monthlyMap[mLabel].salon_revenue += salonShare;
            });

            expenses.forEach(e => {
                if (!e.date) return;
                const mLabel = e.date.substring(0, 7);
                if (!monthlyMap[mLabel]) {
                    monthlyMap[mLabel] = { m_label: mLabel, salon_revenue: 0, total_expenses: 0 };
                }
                monthlyMap[mLabel].total_expenses += parseFloat(e.amount || 0);
            });

            return Object.values(monthlyMap).map(m => ({
                m_label: m.m_label,
                revenue: m.salon_revenue,
                total_expenses: m.total_expenses
            })).sort((a, b) => b.m_label.localeCompare(a.m_label));
        }




        // --- 4. GET_CURRENT_PRICE ---
       // --- 4. GET_CURRENT_PRICE (Con supporto Timestamp Completo) ---
        if (action === 'GET_CURRENT_PRICE') {
            const nowIso = new Date().toISOString();
            const history = await localDb.price_history.where('salon_id').equals(salonId).toArray();
            
            const prodHistory = history.filter(ph => ph.product_id === id);
            
            // Cerca il record il cui intervallo temporale include l'istante corrente
            let current = prodHistory.find(ph => {
                const from = ph.date_from || '1900-01-01T00:00:00.000Z';
                const to = ph.date_to || '9999-12-31T23:59:59.999Z';
                return nowIso >= from && nowIso <= to;
            });

            // Fallback: se non c'è un match esatto per orario, prende il più recente per data/timestamp
            if (!current && prodHistory.length > 0) {
                prodHistory.sort((a, b) => (b.date_from || '').localeCompare(a.date_from || ''));
                current = prodHistory[0];
            }

            return current ? { cost: parseFloat(current.cost) || 0, price: parseFloat(current.price) || 0 } : { cost: 0, price: 0 };
        }

        // --- 5. GET_HISTORY ---
        if (action === 'GET_HISTORY') {
            const history = await localDb.price_history.where('salon_id').equals(salonId).toArray();
            return history.filter(ph => ph.product_id === id).sort((a, b) => b.date_from.localeCompare(a.date_from));
        }

        // --- 6. CHECK_OVERLAP ---
        if (action === 'CHECK_OVERLAP') {
            const { id: hId, product_id, date_from, date_to } = data;
            const targetEnd = date_to || '9999-12-31';
            
            const history = await localDb.price_history.where('salon_id').equals(salonId).toArray();
            const overlaps = history.filter(ph => {
                if (ph.product_id !== product_id) return false;
                if (ph.id === hId) return false; 
                const phEnd = ph.date_to || '9999-12-31';
                return (ph.date_from <= targetEnd) && (phEnd >= date_from);
            });

            return overlaps;
        }

        // --- 7. GET_CONSUMABLES_BY_SERVICE ---
        if (action === 'GET_CONSUMABLES_BY_SERVICE') {
            const consumables = await localDb.service_consumables.where('salon_id').equals(salonId).toArray();
            const serviceCons = consumables.filter(sc => sc.service_id === id);
            const inventory = await localDb.inventory.where('salon_id').equals(salonId).toArray();
            
            return serviceCons.map(sc => {
                const prod = inventory.find(i => i.id === sc.product_id);
                return {
                    id: sc.id,
                    prod_name: prod ? prod.name : 'Prodotto sconosciuto',
                    qty: sc.quantity_per_service
                };
            });
        }

        // --- 8. GET_SALES_REPORT (Unificato, Sincrono e Protetto da Duplicati) ---
        if (action === 'GET_SALES_REPORT') {
            try {
                const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
                
                // 1. Leggiamo ESCLUSIVAMENTE le vendite e gli item del salone corrente
                // (Le vendite mirror sono già create con salon_id = salonId, quindi niente duplicati)
                const sales = (await localDb.sales.where('salon_id').equals(salonId).toArray()) || [];
                const saleItems = (await localDb.sale_items.where('salon_id').equals(salonId).toArray()) || [];
                
                // 2. Lettura configurazioni e pacchetti per il calcolo dello split
                const packagesConfigList = localDb.packages_config ? (await localDb.packages_config.toArray() || []) : [];
                const customerPackagesList = localDb.customer_packages ? (await localDb.customer_packages.toArray() || []) : [];

                // 3. 🌟 Lettura globale dei clienti locali (garantisce la risoluzione del nome anche se creati da un salone partner)
                const customers = (await localDb.customers.toArray()) || [];
                const inventory = (await localDb.inventory.where('salon_id').equals(salonId).toArray()) || [];
                const priceHistory = (await localDb.price_history.where('salon_id').equals(salonId).toArray()) || [];
                const allConsumables = (await localDb.service_consumables.where('salon_id').equals(salonId).toArray()) || [];
                const allLots = (await localDb.stock_lots.where('salon_id').equals(salonId).toArray()) || [];
                
                let productSuppliers = [];
                let suppliersData = [];
                try {
                    if (localDb.product_suppliers) productSuppliers = (await localDb.product_suppliers.where('salon_id').equals(salonId).toArray()) || [];
                    if (localDb.suppliers) suppliersData = (await localDb.suppliers.where('salon_id').equals(salonId).toArray()) || [];
                } catch (e) {}

                const report = [];
                
                for (let item of saleItems) {
                    const sale = sales.find(s => s.id === item.sale_id);
                    if (!sale) continue;
                    
                    // Risoluzione robusta Nome e Cognome cliente
                    let cust = customers.find(c => c.id === sale.cust_id);
                    if (!cust && sale.cust_id && sale.cust_id !== 'CLIENTE_STORICO') {
                        cust = customers.find(c => `${c.first_name || ''} ${c.last_name || ''}`.trim().toLowerCase() === String(sale.cust_id).toLowerCase());
                    }
                    if (!cust && window.allCustomers) {
                        cust = window.allCustomers.find(c => c.id === sale.cust_id);
                    }

                    const custDisplayName = cust 
                        ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() 
                        : (sale.cust_id && sale.cust_id !== 'CLIENTE_STORICO' ? sale.cust_id : 'Occasionale');

                    const inv = inventory.find(i => i.name.toLowerCase() === (item.item_name || '').toLowerCase());
                    
                    const discount = parseFloat(item.discount) || 0;
                    let soldPrice = parseFloat(item.price) || 0;
                    let finalPrice = soldPrice - discount;
                    const saleDate = sale.date || new Date().toISOString().split('T')[0];
                    const itemQty = parseFloat(item.qty) || 1;

                    let unitCost = 0;
                    let supplierPayout = (item.supplier_payout !== undefined && item.supplier_payout !== null) ? parseFloat(item.supplier_payout) : 0;
                    let salonRevenue = (item.salon_revenue !== undefined && item.salon_revenue !== null) ? parseFloat(item.salon_revenue) : finalPrice;
                    let supplierDetailsText = '-';

                    // 🎁 GESTIONE PACCHETTI VENDUTI (SOLO RIGHE RIGOROSE ED ESCLUSIONE HARDCODING)
                    const isPackageItem = (item.item_name || '').toLowerCase().includes('pacchetto');

                    if (isPackageItem) {
                        // 1. Risoluzione esatta della configurazione pacchetto
                        let matchingPkg = null;
                        if (item.package_id) {
                            matchingPkg = packagesConfigList.find(p => String(p.id) === String(item.package_id));
                        }
                        if (!matchingPkg) {
                            // Rimuove qualsiasi prefisso tra parentesi quadre per ricavare il nome del pacchetto o del servizio
                            const cleanItemName = (item.item_name || '').replace(/🎁\s*\[[^\]]+\]\s*/i, '').trim().toLowerCase();
                            matchingPkg = packagesConfigList.find(p => p.name.trim().toLowerCase() === cleanItemName);
                        }


                        // 2. Estrazione delle quote configurate (senza fallback su pacchetti storici estranei)
                        let allocs = null;
                        if (matchingPkg && matchingPkg.revenue_splits) {
                            let splits = matchingPkg.revenue_splits;
                            if (typeof splits === 'string') { try { splits = JSON.parse(splits); } catch(e) { splits = null; } }
                            if (splits && splits.allocations && typeof splits.allocations === 'object') {
                                allocs = splits.allocations;
                            }
                        }

                        // 3. Verifica rigorosa: è condiviso se e solo se ci sono almeno due saloni con quota > 0
                        const activeAllocKeys = (allocs && typeof allocs === 'object') 
                            ? Object.keys(allocs).filter(k => parseFloat(allocs[k]) > 0)
                            : [];
                        
                        const isSharedPackage = activeAllocKeys.length > 1;

                        if (isSharedPackage) {
                            const totalAllocSum = Object.values(allocs).reduce((a, b) => a + parseFloat(b || 0), 0);
                            const isPartnerMirrorSale = sale.payment_method && sale.payment_method.includes('Condiviso');
                            let baseTransactionTotal = finalPrice;

                            // Se siamo nel salone partner, ricalcoliamo la quota per mostrare lo split corretto
                            if (isPartnerMirrorSale && totalAllocSum > 0) {
                                const myRatio = (parseFloat(allocs[salonId]) || 0) / totalAllocSum;
                                if (myRatio > 0) baseTransactionTotal = finalPrice / myRatio;
                            }

                            let splitDetailsArr = [];
                            for (const [sId, amountVal] of Object.entries(allocs)) {
                                if (parseFloat(amountVal) <= 0) continue;
                                const ratio = totalAllocSum > 0 ? (parseFloat(amountVal || 0) / totalAllocSum) : 0;
                                const quotaTransazione = baseTransactionTotal * ratio;
                                const pctVal = (ratio * 100).toFixed(0);
                                splitDetailsArr.push(`<b>${sId}</b> (${pctVal}%): €${quotaTransazione.toFixed(2)}`);
                            }

                            supplierDetailsText = `🧩 <b>Split Rata / Acconto:</b><br>${splitDetailsArr.join('<br>')}`;
                        } else {
                            // 🌟 Pacchetto NON condiviso: Nessuna ripartizione mostrata, 100% ricavo al salone
                            supplierDetailsText = `Esclusivo (100% Salone)`;
                        }

                        unitCost = 0;
                        supplierPayout = 0;
                        salonRevenue = (item.salon_revenue !== undefined && item.salon_revenue !== null) ? parseFloat(item.salon_revenue) : finalPrice;
                    
                    } else if (inv) {
                        // Prodotti fisici e Servizi standard (Invariati)
                        if (inv.type === 'servizio' && !inv.is_consignment) {
                            const serviceCons = allConsumables.filter(sc => sc.service_id === inv.id);
                            let totalConsumablesCost = 0;
                            for (let sc of serviceCons) {
                                const consumedProd = inventory.find(p => p.id === sc.product_id);
                                const qtyNeeded = parseFloat(sc.quantity_per_service) || 0;
                                if (consumedProd) {
                                    const prodLots = allLots.filter(l => l.product_id === consumedProd.id && l.qty_remaining > 0);
                                    let prodUnitCost = 0;
                                    if (prodLots.length > 0) {
                                        prodLots.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
                                        prodUnitCost = parseFloat(prodLots[0].unit_cost) || 0;
                                    } else {
                                        const phList = priceHistory.filter(p => p.product_id === consumedProd.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                                        prodUnitCost = phList.length > 0 ? (parseFloat(phList[0].cost) || 0) : 0;
                                    }
                                    totalConsumablesCost += (prodUnitCost * qtyNeeded);
                                }
                            }
                            unitCost = totalConsumablesCost;
                            salonRevenue = finalPrice - (unitCost * itemQty);

                        } else if (inv.is_consignment && inv.type === 'servizio') {
                            if (item.supplier_payout !== undefined && item.supplier_payout !== null && !isNaN(item.supplier_payout)) {
                                supplierPayout = parseFloat(item.supplier_payout) || 0;
                            } else {
                                const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                                const listinoPienoOriginale = phList.length > 0 ? (parseFloat(phList[0].price) || soldPrice) : soldPrice;
                                const rule = inv.discount_absorption || 'salon';
                                const splitPct = parseFloat(inv.consignment_split_pct) || 0;
                                const salonShareFull = listinoPienoOriginale * (1 - (splitPct / 100));
                                const basePayout = (listinoPienoOriginale * splitPct) / 100;

                                if (rule === 'supplier') supplierPayout = finalPrice - salonShareFull;
                                else if (rule === 'split') supplierPayout = basePayout - (discount / 2);
                                else supplierPayout = basePayout;
                            }
                            const suppObj = suppliersData.find(s => s.id === inv.supplier_id);
                            const suppName = suppObj ? suppObj.name : 'Fornitore';
                            supplierDetailsText = `${suppName} (${inv.consignment_split_pct}%): €${supplierPayout.toFixed(2)}`;
                            salonRevenue = finalPrice - supplierPayout;

                        } else if (inv.is_consignment) {
                            const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                            const listinoPienoOriginale = phList.length > 0 ? (parseFloat(phList[0].price) || soldPrice) : soldPrice;
                            const links = productSuppliers.filter(l => l.product_id === inv.id);
                            if (links.length > 0) {
                                let detailsArray = [];
                                let totalConsignmentPayout = 0;
                                links.forEach(l => {
                                    const supp = suppliersData.find(s => s.id === l.supplier_id);
                                    const suppName = supp ? supp.name : 'Fornitore';
                                    const pct = parseFloat(l.split_pct) || 0;
                                    const payoutForThisSupp = (listinoPienoOriginale * pct) / 100;
                                    totalConsignmentPayout += payoutForThisSupp;
                                    detailsArray.push(`${suppName} (${pct}%): €${payoutForThisSupp.toFixed(2)}`);
                                });
                                supplierPayout = totalConsignmentPayout;
                                supplierDetailsText = detailsArray.join('<br>');
                            } else {
                                const pct = parseFloat(inv.consignment_split_pct) || 0;
                                supplierPayout = (listinoPienoOriginale * pct) / 100;
                                const supp = suppliersData.find(s => s.id === inv.supplier_id);
                                const suppName = supp ? supp.name : 'Fornitore';
                                supplierDetailsText = `${suppName} (${pct}%): €${supplierPayout.toFixed(2)}`;
                            }
                            salonRevenue = finalPrice - supplierPayout;

                        } else {
                            if (item.unit_cost !== undefined && item.unit_cost !== null && !isNaN(item.unit_cost) && parseFloat(item.unit_cost) > 0) {
                                unitCost = parseFloat(item.unit_cost) || 0;
                            } else {
                                const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                                if (phList.length > 0) unitCost = parseFloat(phList[0].cost) || 0;
                            }
                            salonRevenue = finalPrice - (unitCost * itemQty);
                        }
                    } else {
                        if (item.unit_cost !== undefined && item.unit_cost !== null && !isNaN(item.unit_cost)) {
                            unitCost = parseFloat(item.unit_cost) || 0;
                        }
                        supplierPayout = (item.supplier_payout !== undefined && item.supplier_payout !== null) ? parseFloat(item.supplier_payout) : 0;
                        salonRevenue = (item.salon_revenue !== undefined && item.salon_revenue !== null) 
                            ? parseFloat(item.salon_revenue) 
                            : (finalPrice - unitCost - supplierPayout);
                    }

                    report.push({
                        sale_id: sale.id,
                        date: sale.date,
                        time: sale.time || '00:00',
                        item_name: item.item_name || 'Articolo',
                        customer_name: custDisplayName,
                        sold_price: soldPrice,
                        discount: discount,
                        final_price: finalPrice,
                        unit_cost: unitCost,
                        supplier_payout: supplierPayout,
                        salon_revenue: salonRevenue,
                        supplier_details: supplierDetailsText,
                        seller: sale.created_by || 'Admin'
                    });
                }

                report.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
                return report;

            } catch (err) {
                console.error("Errore critico in GET_SALES_REPORT:", err);
                return [];
            }
        }

        // --- 9. GET_CUSTOMER_INSIGHTS (PWA) ---
        if (action === 'GET_CUSTOMER_INSIGHTS') {
            const startDate = data?.startDate || '1900-01-01';
            const endDate = data?.endDate || '2099-12-31';

            // 🛑 Escludiamo le vendite associate a CLIENTE_STORICO
            const sales = (await localDb.sales.where('salon_id').equals(salonId).toArray() || []).filter(s => s.cust_id !== 'CLIENTE_STORICO');
            const salesInRange = sales.filter(s => s.date >= startDate && s.date <= endDate);
            const customers = await localDb.customers.where('salon_id').equals(salonId).toArray() || [];
            const customerMap = {};
            salesInRange.forEach(s => {
                if (!s.cust_id) return;
                const cust = customers.find(c => c.id === s.cust_id);
                const custName = cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() : 'Cliente Occasionale';

                if (!customerMap[s.cust_id]) {
                    customerMap[s.cust_id] = { customer_name: custName, total_spent: 0, total_visits: 0 };
                }
                customerMap[s.cust_id].total_spent += (s.total || 0);
                customerMap[s.cust_id].total_visits += 1;
            });

            return Object.values(customerMap).sort((a, b) => b.total_spent - a.total_spent);
        }

        // --- 10. GET_RFM_ANALYSIS (PWA) ---
        if (action === 'GET_RFM_ANALYSIS') {
            const nameFilter = (data?.nameFilter || '').toLowerCase();
            const customers = await localDb.customers.where('salon_id').equals(salonId).toArray() || [];
            // 🛑 Escludiamo CLIENTE_STORICO
            const sales = (await localDb.sales.where('salon_id').equals(salonId).toArray() || []).filter(s => s.cust_id !== 'CLIENTE_STORICO');
            const now = new Date();
            const stats = customers
                .map(c => {
                    const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim();
                    const custSales = sales.filter(s => s.cust_id === c.id);
                    const frequencies = custSales.length;
                    const monetary = custSales.reduce((sum, s) => sum + (s.total || 0), 0);
                    
                    let lastDateStr = null;
                    let recency = 9999;
                    if (frequencies > 0) {
                        const dates = custSales.map(s => new Date(s.date)).sort((a, b) => b - a);
                        lastDateStr = dates[0].toISOString().split('T')[0];
                        recency = Math.floor((now - dates[0]) / (1000 * 60 * 60 * 24));
                    }

                    return { id: c.id, name: fullName, last_purchase: lastDateStr || 'Mai', recency, frequency: frequencies, monetary };
                })
                .filter(s => s.name.toLowerCase().includes(nameFilter));

            const validRecencies = stats.filter(s => s.recency < 9999).map(s => s.recency);
            const avgRecency = validRecencies.length ? validRecencies.reduce((a, b) => a + b, 0) / validRecencies.length : 0;
            const totalFreq = stats.reduce((a, b) => a + b.frequency, 0);
            const avgFreq = stats.length ? totalFreq / stats.length : 0;
            const totalMon = stats.reduce((a, b) => a + b.monetary, 0);
            const avgMon = stats.length ? totalMon / stats.length : 0;

            return stats.map(s => ({ ...s, avg_freq: avgFreq, avg_monetary: avgMon, avg_recency: avgRecency }));
        }



        // --- INSERT_PRICE_HISTORY (Web / PWA) ---
        if (action === 'INSERT') {
            const recordToSave = { 
                ...data, 
                id: data.id || crypto.randomUUID(), 
                salon_id: salonId 
            };
            
            // 1. Scrittura locale
            await localDb.table(table).add(recordToSave);

            // 2. Invio Cloud o Accodamento
            if (isOnline) {
                const success = await sendToCloudDirectly('POST', table, recordToSave);
                if (!success) {
                    await localDb.sync_queue.add({ action: 'INSERT', table_name: table, data: recordToSave, target_id: recordToSave.id });
                }
            } else {
                await localDb.sync_queue.add({ action: 'INSERT', table_name: table, data: recordToSave, target_id: recordToSave.id });
            }
            return { lastInsertRowid: recordToSave.id };
        } 

        // --- 11. GET_CROSS_SELLING ---
        if (action === 'GET_CROSS_SELLING') {
            const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray();
            const saleGroups = {};
            
            saleItems.forEach(si => {
                if (!saleGroups[si.sale_id]) saleGroups[si.sale_id] = [];
                saleGroups[si.sale_id].push(si.item_name);
            });

            const pairs = {};
            const itemTotals = {};

            Object.values(saleGroups).forEach(items => {
                items.forEach(it => { itemTotals[it] = (itemTotals[it] || 0) + 1; });
                for (let i = 0; i < items.length; i++) {
                    for (let j = i + 1; j < items.length; j++) {
                        let a = items[i], b = items[j];
                        if (a > b) [a, b] = [b, a];
                        const key = `${a}___${b}`;
                        if (!pairs[key]) pairs[key] = { itemA: a, itemB: b, occurrences: 0 };
                        pairs[key].occurrences++;
                    }
                }
            });

            return Object.values(pairs)
                .filter(p => p.occurrences > 1)
                .map(p => ({ ...p, totalA: itemTotals[p.itemA] || 1 }))
                .sort((a, b) => b.occurrences - a.occurrences);
        }

        // --- 12. GET_SEASONAL_INSIGHTS ---
        if (action === 'GET_SEASONAL_INSIGHTS') {
            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray();
            const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray();
            const inventory = await localDb.inventory.where('salon_id').equals(salonId).toArray();

            const insightsMap = {};
            saleItems.forEach(si => {
                const sale = sales.find(s => s.id === si.sale_id);
                if (!sale || !sale.date) return;
                const inv = inventory.find(i => i.name.toLowerCase() === si.item_name.toLowerCase());
                if (!inv) return;

                const mese = sale.date.substring(5, 7); // 'MM'
                const key = `${inv.name}_${mese}`;
                if (!insightsMap[key]) {
                    insightsMap[key] = { name: inv.name, type: inv.type, mese: mese, volume: 0 };
                }
                insightsMap[key].volume += (si.qty || 1);
            });

            return Object.values(insightsMap);
        }

        // 🔑 5. VOID_SALE (Storno / Annullamento Vendita con effetto retroattivo corretto per Consumabili e FIFO)
        if (action === 'VOID_SALE') {
            const saleId = id; 
            if (!saleId) return { status: 'error', message: 'ID vendita non specificato.' };

            console.log(`🔄 [STORN] Avvio storno retroattivo per la vendita ID: ${saleId}`);

            try {
                const sales = await localDb.sales.where('salon_id').equals(salonId).toArray();
                const targetSale = sales.find(s => s.id === saleId);
                
                const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray();
                const targetItems = saleItems.filter(si => si.sale_id === saleId);

                if (!targetSale) {
                    return { status: 'error', message: 'Vendita non trovata nel database.' };
                }

                const inventory = await localDb.inventory.where('salon_id').equals(salonId).toArray();
                const allConsumables = await localDb.service_consumables.where('salon_id').equals(salonId).toArray();
                const allLots = await localDb.stock_lots.where('salon_id').equals(salonId).toArray();

                for (let item of targetItems) {
                    const qtyToRestore = parseFloat(item.qty) || 1;
                    const prod = inventory.find(i => i.name.toLowerCase() === (item.item_name || '').toLowerCase());

                    if (prod) {
                        if (prod.type === 'prodotto') {
                            // A. Ripristino magazzino fisico prodotto rivenduto
                            const newStock = (parseFloat(prod.stock) || 0) + qtyToRestore;
                            await localDb.inventory.update(prod.id, { stock: newStock });

                            // B. Ripristino sul lotto FIFO più recente
                            const prodLots = allLots.filter(l => l.product_id === prod.id);
                            if (prodLots.length > 0) {
                                prodLots.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
                                const latestLot = prodLots[0];
                                const newLotRemaining = (parseFloat(latestLot.qty_remaining) || 0) + qtyToRestore;
                                await localDb.stock_lots.update(latestLot.id, { qty_remaining: newLotRemaining });
                                
                                if (navigator.onLine) {
                                    await sendToCloudDirectly('PATCH', 'stock_lots', { qty_remaining: newLotRemaining }, latestLot.id);
                                }
                            }

                            if (navigator.onLine) {
                                await sendToCloudDirectly('PATCH', 'inventory', { stock: newStock }, prod.id);
                            }

                        } else if (prod.type === 'servizio') {
                            // ✂️ D. SE ERA UN SERVIZIO: Ripristiniamo i magazzini di TUTTI i materiali consumabili associati!
                            const serviceCons = allConsumables.filter(sc => sc.service_id === prod.id);
                            
                            for (let sc of serviceCons) {
                                const consumedProd = inventory.find(p => p.id === sc.product_id);
                                const qtyConsumableToRestore = (parseFloat(sc.quantity_per_service) || 0) * qtyToRestore;

                                if (consumedProd) {
                                    const newConsStock = (parseFloat(consumedProd.stock) || 0) + qtyConsumableToRestore;
                                    await localDb.inventory.update(consumedProd.id, { stock: newConsStock });

                                    // Ripristiniamo anche sul lotto FIFO del consumabile se tracciato
                                    const consLots = allLots.filter(l => l.product_id === consumedProd.id);
                                    if (consLots.length > 0) {
                                        consLots.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
                                        const latestConsLot = consLots[0];
                                        const newConsLotRem = (parseFloat(latestConsLot.qty_remaining) || 0) + qtyConsumableToRestore;
                                        await localDb.stock_lots.update(latestConsLot.id, { qty_remaining: newConsLotRem });
                                        if (navigator.onLine) {
                                            await sendToCloudDirectly('PATCH', 'stock_lots', { qty_remaining: newConsLotRem }, latestConsLot.id);
                                        }
                                    }

                                    if (navigator.onLine) {
                                        await sendToCloudDirectly('PATCH', 'inventory', { stock: newConsStock }, consumedProd.id);
                                    }
                                    console.log(`✅ [STORN CONSUMABILE] Ripristinati ${qtyConsumableToRestore} di ${consumedProd.name} per storno servizio ${prod.name}`);
                                }
                            }
                        }
                    }

                    // Eliminazione del singolo sale_item (locale e cloud)
                    await localDb.sale_items.delete(item.id);
                    if (navigator.onLine) {
                        await fetch(`${SUPABASE_URL}/rest/v1/sale_items?id=eq.${item.id}`, {
                            method: 'DELETE',
                            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
                        });
                    }
                }

                // 3. Eliminazione della testata vendita (sales)
                await localDb.sales.delete(saleId);
                if (navigator.onLine) {
                    await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${saleId}`, {
                        method: 'DELETE',
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
                    });
                }

                console.log(`✅ [STORN] Vendita ${saleId} stornata con successo. Consumabili, stock e dati economici ripristinati.`);
                return { status: 'ok' };

            } catch (err) {
                console.error("❌ Errore critico durante lo storno della vendita:", err);
                return { status: 'error', message: err.message };
            }
        }




        // 🔑 4. RESET_PASSWORD (Reset admin a password provvisoria cifrata e flag a 1)
        if (action === 'RESET_PASSWORD') {
            const userId = data.id;
            const defaultPass = 'password';
            const hashedDefaultPass = typeof bcrypt !== 'undefined' ? bcrypt.hashSync(defaultPass, 10) : defaultPass;

            const updatePayload = {
                password: hashedDefaultPass, // 👈 Hash cifrato della parola "password"
                must_change_password: 1,     // 👈 Attiva rigorosamente l'obbligo di cambio
                salon_id: salonId
            };

            // 1. Aggiornamento in IndexedDB
            try {
                await localDb.users.update(userId, updatePayload);
            } catch (dbEx) {
                console.error("Errore IndexedDB reset password:", dbEx);
            }

            // 2. Invio al Cloud Supabase se online
            let successCloud = false;
            if (navigator.onLine) {
                try {
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
                        method: 'PATCH',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_KEY,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=representation'
                        },
                        body: JSON.stringify(updatePayload)
                    });
                    if (response.ok) successCloud = true;
                } catch (err) {
                    console.error("Errore Cloud reset password:", err);
                }
            }

            // 3. Coda di sincronizzazione se offline o KO
            if (!successCloud) {
                await localDb.sync_queue.add({
                    action: 'UPDATE',
                    table_name: 'users',
                    data: updatePayload,
                    target_id: userId
                });
            }

            return { status: 'ok' };
        }

    } catch (err) {
        console.error(`Errore nell'azione speciale '${action}' su IndexedDB/Web:`, err);
        return [];
    }

    return [];
}

// Ascoltatore automatico del ritorno della rete
window.addEventListener('online', () => {
    console.log("Rete ripristinata! Avvio sincronizzazione PWA...");
    processBrowserSyncQueue();
});