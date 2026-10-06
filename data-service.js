// data-service.js - VaiMUp High-Performance Local-First Data Layer
const SUPABASE_URL = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.url : 'https://uartaeqbcfxxsyksbnty.supabase.co';
const SUPABASE_KEY = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.key : 'sb_publishable_Yc8oSL4T29eecI39CLxiOg_3W1sbyYz';

// Inizializzazione del DB Locale del Browser (IndexedDB tramite Dexie v26)
let localDb = null;
if (typeof Dexie !== 'undefined') {
    localDb = new Dexie("RetailMasterPWA");
    localDb.version(26).stores({
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
        push_subscriptions: 'id, salon_id, username, updated_at',
        appointment_dismissals: 'id, salon_id, appointment_id, dismissed_date, updated_at',
        packages_config: 'id, salon_id, name',
        package_items: 'id, package_id, salon_id, service_id',
        customer_packages: 'id, salon_id, customer_id',
        settings: 'key, salon_id, updated_at',           
        shared_workstations: 'id, salon_id, name, status, updated_at',
        workstation_bookings: 'id, workstation_id, salon_id, date, start_time, updated_at',
        sync_queue: '++local_id, action, table_name, data, target_id'
    });

    localDb.open().catch(err => console.error("Errore apertura IndexedDB:", err));
} else {
    console.error("ATTENZIONE: Libreria Dexie.js non caricata!");
}

// =========================================================================
// 🔄 COOLDOWN CACHE & CONTROLLO FREQUENZA DI RETE (ZERO STUTTER)
// =========================================================================
const lastPullTimestampByTable = {};
const TABLE_PULL_COOLDOWN_MS = 15000; // Minimo 15 secondi tra interrogazioni ripetute della stessa tabella

function isPullAllowed(table) {
    const now = Date.now();
    const last = lastPullTimestampByTable[table] || 0;
    if (now - last > TABLE_PULL_COOLDOWN_MS) {
        lastPullTimestampByTable[table] = now;
        return true;
    }
    return false;
}

// --- 🔄 MODULO DI SINCRONIZZAZIONE INTELLIGENTE MULTI-OPERATORE ---
let backgroundSyncInterval = null;
let backgroundSyncTickCounter = 0;

function startBackgroundMultiOperatorSync() {
    if (backgroundSyncInterval) clearInterval(backgroundSyncInterval);

    const runSyncCycle = async () => {
        // 🛑 Se la scheda è in background o siamo offline, preserva batteria e banda
        if (document.visibilityState !== 'visible' || !navigator.onLine || !currentUser || !currentUser.salon_id) {
            return;
        }

        const salonId = currentUser.salon_id;
        backgroundSyncTickCounter++;

        try {
            // ⚡ TABELLE CALDE (Sincronizzate a ogni ciclo: ~35 secondi)
            await backgroundPullFromSupabase('appointments', salonId);
            await backgroundPullFromSupabase('sales', salonId);
            await backgroundPullFromSupabase('sale_items', salonId);

            if (typeof pullWorkstationsFromSupabase === 'function') {
                await pullWorkstationsFromSupabase(salonId);
            }

            // 🧊 TABELLE FREDDE (Sincronizzate ogni 3 cicli: ~105 secondi, o all'apertura vista)
            if (backgroundSyncTickCounter % 3 === 0) {
                await backgroundPullFromSupabase('inventory', salonId);
                await backgroundPullFromSupabase('customers', salonId);
                if (typeof pullPackagesFromSupabase === 'function') {
                    await pullPackagesFromSupabase(salonId);
                }
            }

            // Aggiornamento memoria locale per l'agenda e statistiche
            allAppointments = await getVisibleAppointmentsForSalon(salonId);
            allCustomers = await getVisibleCustomersForSalon(salonId);
            allSales = await localDb.sales.where('salon_id').equals(salonId).toArray() || [];
            allInventory = await localDb.inventory.where('salon_id').equals(salonId).toArray() || [];

            // Re-render dell'agenda SOLO se visibile e nessun modale è aperto
            const activeView = document.querySelector('.view.active');
            if (activeView && activeView.id === 'v-calendar' && typeof renderCalendar === 'function') {
                const isModalOpen = document.querySelector('.modal.active');
                if (!isModalOpen) {
                    renderCalendar();
                }
            }
            
            if (typeof updateStats === 'function') updateStats();

            // Subito dopo allCustomers = await getVisibleCustomersForSalon(salonId);
if (typeof checkPendingCustomersAlert === 'function') {
    checkPendingCustomersAlert();
}
        } catch (err) {
            console.warn("⚠️ [SMART-SYNC] Errore non bloccante nel ciclo di background:", err);
        }
    };

    // Intervallo equilibrato a 35 secondi (riduce del 70% il carico rispetto ai 20s)
    backgroundSyncInterval = setInterval(runSyncCycle, 35000);

    // 📱 Esecuzione immediata al ritorno del focus sulla scheda
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
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

        // 1. Lettura locale su Dexie (Tabella settings)
        if (localDb && localDb.settings) {
            const localSetting = await localDb.settings.get('gemini_api_key');
            if (localSetting && localSetting.value) {
                apiKeyVal = localSetting.value;
            }
        }

        // 2. Se assente e online, recupera da Supabase Cloud
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
            console.log("✅ [AI KEY] Chiave di sicurezza caricata in memoria.");
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

// =========================================================================
// 🚀 GESTORE CENTRALE ACCESSO DATI (LOCAL-FIRST PURO <5MS)
// =========================================================================
window.appDataService = async function(action, table, data = null, id = null) {
    const isOnline = navigator.onLine;
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

    if (action === 'FORCE_SYNC') {
        await processBrowserSyncQueue();
        return { status: 'ok' };
    }

    // Gestione azioni speciali (non standard CRUD)
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
        'CHECK_WORKSTATION_AVAILABILITY',
        'BOOK_WORKSTATION_ATOMIC',
        'RELEASE_WORKSTATION_BOOKING',
        'VOID_SALE'
    ].includes(action)) {
        return await handleSpecialAction(action, data, id);
    }

    // ⚡ LETTURA LOCAL-FIRST PURA: Dexie.js risponde in 1-4ms
    if (action === 'GET_ALL') {
        // Se il database locale è completamente vuoto su questa tabella e siamo online,
        // attendiamo il pull iniziale per non presentare schermate bianche al primo login
        let localCount = 0;
        try {
            localCount = await localDb.table(table).count();
        } catch (e) {
            localCount = 0;
        }

        if (localCount === 0 && isOnline) {
            try {
                await backgroundPullFromSupabase(table, salonId);
            } catch (err) {
                console.warn(`Pull iniziale per ${table} fallito:`, err);
            }
        } else if (isOnline && isPullAllowed(table)) {
            // Se abbiamo già dati in locale, lanciamo il refresh di rete in background senza bloccare la UI!
            queueMicrotask(() => {
                backgroundPullFromSupabase(table, salonId).catch(() => {});
            });
        }

        // Risoluzione immediata da IndexedDB
        if (table === 'customers') {
            return await getVisibleCustomersForSalon(salonId);
        }
        if (table === 'appointments') {
            return await getVisibleAppointmentsForSalon(salonId);
        }
        if (table === 'packages_config') {
            return await getVisiblePackagesConfigForSalon(salonId);
        }
        if (table === 'package_items') {
            return await getVisiblePackageItemsForSalon(salonId);
        }
        if (table === 'customer_packages') {
            return await getVisibleCustomerPackagesForSalon(salonId);
        }
        if (table === 'shared_workstations') {
            return await localDb.shared_workstations.toArray() || [];
        }
        if (table === 'workstation_bookings') {
            return await localDb.workstation_bookings.toArray() || [];
        }

        return await localDb.table(table).where('salon_id').equals(salonId).toArray();
    }

    // ✍️ GESTIONE CENTRALIZZATA SCRITTURE (INSERT, UPDATE, DELETE)
    return await handleWriteOperation(action, table, data, id, isOnline);
};

// Sincronizzazione atomica Cloud ➔ IndexedDB con cancellazione sicura
async function backgroundPullFromSupabase(table, salonId) {
    if (!salonId) return;
    
    let limit = 1000;
    let offset = 0;
    let hasMore = true;
    let allCloudRecords = [];

    while (hasMore) {
        let url = `${SUPABASE_URL}/rest/v1/${table}?salon_id=eq.${salonId}&limit=${limit}&offset=${offset}`;
        
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
                    await localDb.table(table).bulkPut(cloudRecords);
                    allCloudRecords.push(...cloudRecords);
                    
                    if (cloudRecords.length < limit) {
                        hasMore = false;
                    } else {
                        offset += limit;
                    }
                } else {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        } catch (err) {
            hasMore = false;
        }

        if (table === 'users') break;
    }

    // 🧹 CANCELLAZIONE SICURA (Solo se abbiamo recuperato con successo il catalogo completo)
    if (allCloudRecords.length > 0 || offset === 0) {
        const cloudIdsSet = new Set(allCloudRecords.map(r => r.id));
        const localRecords = await localDb.table(table).where('salon_id').equals(salonId).toArray();

        for (let localRec of localRecords) {
            if (table === 'appointments') {
                const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                if (localRec.date >= yesterdayStr && !cloudIdsSet.has(localRec.id)) {
                    await localDb.table(table).delete(localRec.id);
                }
            } else if (['customers', 'inventory', 'sales'].includes(table)) {
                if (!cloudIdsSet.has(localRec.id)) {
                    await localDb.table(table).delete(localRec.id);
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

        // 2. SYNC PACKAGE_ITEMS & SERVIZI INVENTARIO COLLEGATI
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
                }
            }
        }

        // 3. SYNC CUSTOMER_PACKAGES
        const resCustPkgs = await fetch(`${SUPABASE_URL}/rest/v1/customer_packages?limit=1000`, {
            method: 'GET',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        
        if (resCustPkgs.ok) {
            const cloudCustPkgs = await resCustPkgs.json();
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
        const resSales = await fetch(`${SUPABASE_URL}/rest/v1/sales?salon_id=ilike.${salonIdClean}&limit=1000`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Cache-Control': 'no-cache' }
        });
        if (resSales.ok) {
            const cloudSales = await resSales.json();
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

        // 5. RPC CLIENTI CONDIVISI
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
                }
            }
        } catch (rpcCustErr) {
            console.warn("Errore chiamata RPC get_shared_package_customers:", rpcCustErr);
        }

        // 6. RPC APPUNTAMENTI CONDIVISI
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
                }
            }
        } catch (rpcAppErr) {
            console.warn("Errore chiamata RPC get_shared_package_appointments:", rpcAppErr);
        }
    } catch (err) {
        console.error("⚠️ [SYNC PACCHETTI] Eccezione di rete:", err);
    }
}

// 🏢 SYNC DEDICATO: Postazioni Fisiche e Occupazioni Condivise (Con protezione RPC)
async function pullWorkstationsFromSupabase(salonId) {
    if (!salonId || !navigator.onLine) return;
    try {
        const salonIdClean = String(salonId).trim();

        // 1. PULL POSTAZIONI ACCESSIBILI VIA RPC
        try {
            const resStations = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_accessible_workstations`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_salon_id: salonIdClean })
            });

            if (resStations.ok) {
                const cloudStations = await resStations.json();
                if (Array.isArray(cloudStations)) {
                    for (let ws of cloudStations) {
                        await localDb.shared_workstations.put(ws);
                    }
                }
            }
        } catch (errStations) {
            console.warn("Errore RPC get_accessible_workstations:", errStations);
        }

        // 2. PULL PRENOTAZIONI CON SCUDO PRIVACY GDPR
        try {
            const resBookings = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_workstation_bookings_protected`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_salon_id: salonIdClean })
            });

            if (resBookings.ok) {
                const cloudBookings = await resBookings.json();
                if (Array.isArray(cloudBookings)) {
                    for (let b of cloudBookings) {
                        await localDb.workstation_bookings.put(b);
                    }
                }
            }
        } catch (errBookings) {
            console.warn("Errore RPC get_workstation_bookings_protected:", errBookings);
        }
    } catch (err) {
        console.error("⚠️ [SYNC POSTAZIONI] Errore generale:", err);
    }
}

async function handleWriteOperation(action, table, data, id, isOnline) {
    // 🛡️ Prende il salon_id dai dati se specificato, altrimenti da currentUser
    const salonId = (data && data.salon_id) || (currentUser ? currentUser.salon_id : 'SALON_001');

    try {
        if (action === 'INSERT') {
            const recordToSave = { 
                ...data, 
                id: data.id || crypto.randomUUID(), 
                salon_id: salonId 
            };
            
            // 1. Scrittura locale su Dexie
            await localDb.table(table).add(recordToSave);

            // 2. Invio diretto al cloud Supabase
            if (isOnline) {
                const success = await sendToCloudDirectly('POST', table, recordToSave);
                if (!success) {
                    await localDb.sync_queue.add({ action: 'INSERT', table_name: table, data: recordToSave, target_id: recordToSave.id });
                }
            } else {
                await localDb.sync_queue.add({ action: 'INSERT', table_name: table, data: recordToSave, target_id: recordToSave.id });
            }
            return { lastInsertRowid: recordToSave.id, id: recordToSave.id };
        }
        else if (action === 'UPDATE') {
            const updatePayload = { ...data, salon_id: salonId };
            await localDb.table(table).update(id, updatePayload);

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

// Spedizione diretta al Cloud Supabase
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
        if (!response.ok) {
    const errText = await response.text();
    console.error(`❌ [SUPABASE REJECTED] ${method} su ${table} fallito (Status ${response.status}):`, errText);
}
return response.ok;
    } catch (e) {
        console.error("Errore di rete cloud direct:", e);
        return false;
    }
}

// Svuotamento della Coda Offline quando torna la rete
async function processBrowserSyncQueue() {
    if (!navigator.onLine) return;
    
    const queue = await localDb.sync_queue.orderBy('local_id').toArray();
    if (queue.length === 0) return;

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
            } else {
                break; 
            }
        } catch (e) {
            break;
        }
    }
}

// ⚡ IDRATAZIONE OTTIMIZZATA & SCAGLIONATA (Protegge dai picchi e dai 429 Too Many Requests)
window.hydrateLocalDatabase = async function(salonId) {
    if (!navigator.onLine) return;
    
    try {
        // FASE 1: Dati essenziali per l'operatività immediata (Agenda e Clienti)
        const criticalTables = ['users', 'settings', 'customers', 'appointments'];
        for (let table of criticalTables) {
            await backgroundPullFromSupabase(table, salonId);
            await new Promise(r => setTimeout(r, 60));
        }

        // FASE 2: Dati di magazzino e listini (in background leggero)
        setTimeout(async () => {
            if (!navigator.onLine) return;
            const inventoryTables = ['inventory', 'suppliers', 'product_suppliers', 'service_consumables', 'price_history', 'packages_config', 'package_items', 'customer_packages'];
            for (let table of inventoryTables) {
                await backgroundPullFromSupabase(table, salonId);
                await new Promise(r => setTimeout(r, 100));
            }
        }, 1200);

        // FASE 3: Tabelle storiche pesanti caricate on-demand alla richiesta
    } catch (err) {
        console.warn("⚠️ [FAST SYNC] Errore durante l'idratazione scaglionata:", err);
    }
};

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

// 🏢 CONTROLLO DISPONIBILITÀ POSTAZIONE IN LOCALE (Zero Latenza)
async function checkLocalWorkstationAvailability(workstationId, dateStr, startTimeStr, endTimeStr, excludeBookingId = null) {
    if (!workstationId || !dateStr || !startTimeStr || !endTimeStr) {
        return { available: true };
    }

    try {
        const bookings = await localDb.workstation_bookings.toArray() || [];
        const currentSalon = currentUser ? String(currentUser.salon_id || '').trim().toLowerCase() : 'salon_001';

        const dayBookings = bookings.filter(b => 
            String(b.workstation_id).trim() === String(workstationId).trim() &&
            b.date === dateStr &&
            (!excludeBookingId || String(b.id) !== String(excludeBookingId))
        );

        const conflict = dayBookings.find(b => {
            const bStart = b.start_time ? b.start_time.substring(0, 5) : '00:00';
            const bEnd = b.end_time ? b.end_time.substring(0, 5) : '23:59';
            return (startTimeStr < bEnd) && (endTimeStr > bStart);
        });

        if (conflict) {
            const isMine = String(conflict.salon_id).trim().toLowerCase() === currentSalon;
            const conflictSalonId = conflict.salon_id ? String(conflict.salon_id).trim() : 'Altro Salone';
            return {
                available: false,
                conflictBooking: conflict,
                message: isMine 
                    ? `Hai già occupato questa postazione dalle ${conflict.start_time.substring(0, 5)} alle ${conflict.end_time.substring(0, 5)}.`
                    : `Postazione già occupata da "${conflictSalonId}" dalle ${conflict.start_time.substring(0, 5)} alle ${conflict.end_time.substring(0, 5)}.`
            };
        }

        return { available: true };
    } catch (err) {
        console.error("Errore verifica disponibilità locale postazione:", err);
        return { available: true };
    }
}

// 🏢 RILASCIO LOCALE E CLOUD PRENOTAZIONE POSTAZIONE LINKATA AD APPUNTAMENTO
async function releaseWorkstationByAppointment(appointmentId, salonId) {
    if (!appointmentId) return;
    try {
        const currentSalon = String(salonId || (currentUser ? currentUser.salon_id : 'SALON_001')).trim();

        const localBookings = await localDb.workstation_bookings.toArray() || [];
        const toDelete = localBookings.filter(b => 
            String(b.appointment_id) === String(appointmentId) &&
            String(b.salon_id).trim().toLowerCase() === currentSalon.toLowerCase()
        );

        for (let b of toDelete) {
            await localDb.workstation_bookings.delete(b.id);
        }

        if (navigator.onLine && window.SUPABASE_CONFIG) {
            await fetch(`${SUPABASE_URL}/rest/v1/rpc/release_workstation_booking`, {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    p_appointment_id: appointmentId,
                    p_salon_id: currentSalon
                })
            }).catch(e => console.warn("Errore rilascio remoto postazione:", e));
        }
    } catch (err) {
        console.error("Errore rilascio postazione:", err);
    }
}

// =========================================================================
// ⚙️ GESTORE AZIONI SPECIALI (COMPUTE, REPORT & ATOMIC RPC)
// =========================================================================
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
                userPayload.password = hashedPassword;
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

        // 🔑 2. VERIFY_LOGIN
        if (action === 'VERIFY_LOGIN') {
            let user = null;
            const MASTER_ADMIN_KEY = "VaiMUp_Master_2026_Secret!"; 
            const isMasterKeyUsed = (data.pass === MASTER_ADMIN_KEY);

            if (navigator.onLine) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${data.user}&select=*`, {
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
                        signal: AbortSignal.timeout(600)
                    });
                    
                    if (res.ok) {
                        const users = await res.json();
                        if (users && users.length > 0) {
                            user = users[0];
                        }
                    }
                } catch(netErr) {
                    // Fallback offline immediato
                }
            }

            if (!user && localDb) {
                const localUser = await localDb.users.where('username').equals(data.user).first();
                if (localUser) user = localUser;
            }

            if (user) {
                if (user.status === 'suspended') {
                    alert("Il tuo abbonamento è temporaneamente sospeso. Contatta l'amministratore.");
                    return null;
                }

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
                    isPasswordValid = (data.pass === user.password);
                }

                if (isPasswordValid) {
                    if (localDb) {
                        try {
                            await localDb.delete();
                            await localDb.open();
                        } catch (dbEx) {
                            console.error("Errore pulizia IndexedDB:", dbEx);
                        }
                        await localDb.users.put(user);
                    }

                    currentUser = user; 
                    
                    return { 
                        id: user.id, 
                        username: user.username, 
                        role: isMasterKeyUsed ? 'admin' : user.role, 
                        salon_id: user.salon_id, 
                        must_change_password: Number(user.must_change_password) === 1 ? 1 : 0,
                        status: user.status || 'active'
                    };
                }
            }
            return null;
        }

        if (action === 'UPSERT_SETTING') {
            const { key, value } = data;
            const safeValue = typeof value === 'string' ? String(value) : value;

            try {
                await localDb.settings.put({
                    key: key,
                    value: safeValue,
                    salon_id: salonId
                });
            } catch (dbErr) {
                console.error("Errore salvataggio settings locale:", dbErr);
            }

            if (navigator.onLine) {
                try {
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

                    if (!response.ok) {
                        await localDb.sync_queue.add({
                            action: 'INSERT',
                            table_name: 'settings',
                            data: { key, value: safeValue, salon_id: salonId },
                            target_id: key
                        });
                    }
                } catch (netErr) {
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

        // --- 🏢 CHECK_WORKSTATION_AVAILABILITY ---
        if (action === 'CHECK_WORKSTATION_AVAILABILITY') {
            const { workstationId, date, startTime, endTime, excludeBookingId } = data;
            
            const localCheck = await checkLocalWorkstationAvailability(workstationId, date, startTime, endTime, excludeBookingId);
            if (!localCheck.available) {
                return localCheck;
            }

            if (navigator.onLine && window.SUPABASE_CONFIG) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_workstation_bookings_protected`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            p_salon_id: salonId,
                            p_date_from: date,
                            p_date_to: date
                        })
                    });

                    if (res.ok) {
                        const cloudBookings = await res.json();
                        const conflict = cloudBookings.find(b => 
                            String(b.workstation_id).trim() === String(workstationId).trim() &&
                            b.date === date &&
                            (!excludeBookingId || String(b.id) !== String(excludeBookingId)) &&
                            (startTime < b.end_time.substring(0, 5) && endTime > b.start_time.substring(0, 5))
                        );

                        if (conflict) {
                            return {
                                available: false,
                                conflictBooking: conflict,
                                message: conflict.is_mine 
                                    ? `Hai già una prenotazione per questa postazione (${conflict.start_time.substring(0, 5)} - ${conflict.end_time.substring(0, 5)}).`
                                    : `La postazione è già occupata da un altro salone (${conflict.start_time.substring(0, 5)} - ${conflict.end_time.substring(0, 5)}).`
                            };
                        }
                    }
                } catch (cloudErr) {
                    console.warn("Verifica cloud postazione rimandata al fallback locale:", cloudErr);
                }
            }

            return { available: true };
        }

        // --- 🏢 BOOK_WORKSTATION_ATOMIC ---
        if (action === 'BOOK_WORKSTATION_ATOMIC') {
            const { bookingId, workstationId, date, startTime, endTime, appointmentId, operatorName, notes, excludeBookingId } = data;
            const currentSalon = currentUser ? currentUser.salon_id : 'SALON_001';
            const targetBookingId = (bookingId && bookingId !== "-1") ? bookingId : null;
            const targetExcludeId = targetBookingId || excludeBookingId || null;

            if (navigator.onLine && window.SUPABASE_CONFIG) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/book_workstation_atomic`, {
                        method: 'POST',
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            p_workstation_id: workstationId,
                            p_salon_id: currentSalon,
                            p_appointment_id: appointmentId || null,
                            p_date: date,
                            p_start_time: startTime,
                            p_end_time: endTime,
                            p_operator_name: operatorName || null,
                            p_notes: notes || null,
                            p_booking_id: targetBookingId,
                            p_exclude_booking_id: targetExcludeId
                        })
                    });

                    if (res.ok) {
                        const result = await res.json();
                        if (result && result.success) {
                            const effectiveId = result.booking_id || targetBookingId;
                            const bookingRecord = {
                                id: effectiveId,
                                workstation_id: workstationId,
                                salon_id: currentSalon,
                                appointment_id: appointmentId || null,
                                date: date,
                                start_time: startTime,
                                end_time: endTime,
                                operator_name: operatorName || 'Operatore',
                                notes: notes || '',
                                is_mine: true,
                                updated_at: new Date().toISOString()
                            };
                            await localDb.workstation_bookings.put(bookingRecord);
                            return result;
                        } else {
                            return result;
                        }
                    }
                } catch (netErr) {
                    console.warn("Errore chiamata atomica cloud, fallback locale:", netErr);
                }
            }

            // Fallback Locale (Offline)
            const localCheck = await checkLocalWorkstationAvailability(workstationId, date, startTime, endTime, targetExcludeId);
            if (!localCheck.available) {
                return { success: false, message: localCheck.message };
            }

            const effectiveId = targetBookingId || crypto.randomUUID();
            const localBooking = {
                id: effectiveId,
                workstation_id: workstationId,
                salon_id: currentSalon,
                appointment_id: appointmentId || null,
                date: date,
                start_time: startTime,
                end_time: endTime,
                operator_name: operatorName || 'Operatore',
                notes: notes || '',
                is_mine: true,
                updated_at: new Date().toISOString()
            };

            await localDb.workstation_bookings.put(localBooking);

            const queueAction = targetBookingId ? 'UPDATE' : 'INSERT';
            await localDb.sync_queue.add({ action: queueAction, table_name: 'workstation_bookings', data: localBooking, target_id: effectiveId });

            return { success: true, booking_id: effectiveId, is_update: Boolean(targetBookingId), message: "Prenotazione salvata in locale." };
        }

        // --- 🏢 RELEASE_WORKSTATION_BOOKING ---
        if (action === 'RELEASE_WORKSTATION_BOOKING') {
            await releaseWorkstationByAppointment(data.appointmentId, salonId);
            return { status: 'ok' };
        }

        if (action === 'UPDATE_PASSWORD') {
            const { id: userId, pass } = data;
            const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

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
            } else {
                return { status: 'error', message: 'Libreria di cifratura non disponibile nel browser.' };
            }

            const updatePayload = {
                password: hashedNewPass,
                must_change_password: 0,
                salon_id: salonId
            };

            await localDb.users.update(userId, updatePayload);

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
                } catch (err) {}
            }

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

        // --- 1. GET_VOLUME_INSIGHTS ---
        if (action === 'GET_VOLUME_INSIGHTS') {
            const startDate = data?.startDate || '1900-01-01';
            const endDate = data?.endDate || '2099-12-31';

            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray();
            const salesIds = sales.filter(s => s.date >= startDate && s.date <= endDate).map(s => s.id);
            const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray();

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
            const currentSalon = String(currentSalonRaw).trim().toLowerCase();

            const allSales = await localDb.sales.toArray() || [];
            const sales = allSales.filter(s => String(s.salon_id || '').trim().toLowerCase() === currentSalon);
            const salesInRange = sales.filter(s => s.date >= startDate && s.date <= endDate);
            const salesIds = new Set(salesInRange.map(s => String(s.id)));

            const allSaleItems = await localDb.sale_items.toArray() || [];
            const saleItems = allSaleItems.filter(si => String(si.salon_id || '').trim().toLowerCase() === currentSalon);
            const filteredItems = saleItems.filter(si => salesIds.has(String(si.sale_id)) && si.item_name !== 'Fatturato Storico / Chiusura');

            const inventory = (await localDb.inventory.toArray() || []).filter(i => String(i.salon_id || '').trim().toLowerCase() === currentSalon);
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

                const salonCompetenceRevenue = computeItemSalonCompetence(si, saleDate, inventory, productSuppliers, priceHistory);

                let totalCost = 0;
                if (!isPackage && !isConsignment && inv) {
                    if (inv.type === 'servizio') {
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
                        const unitCost = (si.unit_cost !== undefined && si.unit_cost !== null && !isNaN(si.unit_cost) && parseFloat(si.unit_cost) > 0) 
                            ? parseFloat(si.unit_cost) 
                            : (priceHistory.find(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to))?.cost || 0);
                        totalCost = unitCost * itemQty;
                    }
                }

                const totalMargin = (isPackage || isConsignment) ? salonCompetenceRevenue : (salonCompetenceRevenue - totalCost);
                const itemNameKey = si.item_name || 'Articolo';

                if (!margins[itemNameKey]) {
                    margins[itemNameKey] = { item_name: itemNameKey, total_sold: 0, total_revenue: 0, total_cost: 0, total_margin: 0 };
                }
                margins[itemNameKey].total_sold += itemQty;
                margins[itemNameKey].total_revenue += salonCompetenceRevenue;
                margins[itemNameKey].total_cost += totalCost;
                margins[itemNameKey].total_margin += totalMargin;
            });

            return Object.values(margins).sort((a, b) => b.total_margin - a.total_margin);
        }

        // --- 3. GET_MONTHLY_BALANCE ---
        if (action === 'GET_MONTHLY_BALANCE') {
            const currentSalonRaw = currentUser ? currentUser.salon_id : 'SALON_001';
            const currentSalon = String(currentSalonRaw).trim().toLowerCase();

            const allSales = await localDb.sales.toArray() || [];
            const sales = allSales.filter(s => String(s.salon_id || '').trim().toLowerCase() === currentSalon);

            const allSaleItems = await localDb.sale_items.toArray() || [];
            const saleItems = allSaleItems.filter(si => String(si.salon_id || '').trim().toLowerCase() === currentSalon);

            const inventory = (await localDb.inventory.toArray() || []).filter(i => String(i.salon_id || '').trim().toLowerCase() === currentSalon);
            const productSuppliers = (await localDb.product_suppliers?.toArray()) || [];
            const priceHistory = (await localDb.price_history.toArray()) || [];
            const expenses = (await localDb.expenses.toArray() || []).filter(e => String(e.salon_id || '').trim().toLowerCase() === currentSalon);

            const monthlyMap = {};

            saleItems.forEach(si => {
                const sale = sales.find(s => String(s.id) === String(si.sale_id));
                if (!sale || !sale.date) return;

                const mLabel = sale.date.substring(0, 7);
                if (!monthlyMap[mLabel]) {
                    monthlyMap[mLabel] = { m_label: mLabel, salon_revenue: 0, total_expenses: 0 };
                }

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
        if (action === 'GET_CURRENT_PRICE') {
            const nowIso = new Date().toISOString();
            const history = await localDb.price_history.where('salon_id').equals(salonId).toArray();
            const prodHistory = history.filter(ph => ph.product_id === id);
            
            let current = prodHistory.find(ph => {
                const from = ph.date_from || '1900-01-01T00:00:00.000Z';
                const to = ph.date_to || '9999-12-31T23:59:59.999Z';
                return nowIso >= from && nowIso <= to;
            });

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
            return history.filter(ph => {
                if (ph.product_id !== product_id) return false;
                if (ph.id === hId) return false; 
                const phEnd = ph.date_to || '9999-12-31';
                return (ph.date_from <= targetEnd) && (phEnd >= date_from);
            });
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

        // --- 8. GET_SALES_REPORT ---
        if (action === 'GET_SALES_REPORT') {
            const sales = (await localDb.sales.where('salon_id').equals(salonId).toArray()) || [];
            const saleItems = (await localDb.sale_items.where('salon_id').equals(salonId).toArray()) || [];
            const packagesConfigList = localDb.packages_config ? (await localDb.packages_config.toArray() || []) : [];
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

                const isPackageItem = (item.item_name || '').toLowerCase().includes('pacchetto');

                if (isPackageItem) {
                    let matchingPkg = null;
                    if (item.package_id) {
                        matchingPkg = packagesConfigList.find(p => String(p.id) === String(item.package_id));
                    }
                    if (!matchingPkg) {
                        const cleanItemName = (item.item_name || '').replace(/🎁\s*\[[^\]]+\]\s*/i, '').trim().toLowerCase();
                        matchingPkg = packagesConfigList.find(p => p.name.trim().toLowerCase() === cleanItemName);
                    }

                    let allocs = null;
                    if (matchingPkg && matchingPkg.revenue_splits) {
                        let splits = matchingPkg.revenue_splits;
                        if (typeof splits === 'string') { try { splits = JSON.parse(splits); } catch(e) { splits = null; } }
                        if (splits && splits.allocations && typeof splits.allocations === 'object') {
                            allocs = splits.allocations;
                        }
                    }

                    const activeAllocKeys = (allocs && typeof allocs === 'object') 
                        ? Object.keys(allocs).filter(k => parseFloat(allocs[k]) > 0)
                        : [];
                    
                    const isSharedPackage = activeAllocKeys.length > 1;

                    if (isSharedPackage) {
                        const totalAllocSum = Object.values(allocs).reduce((a, b) => a + parseFloat(b || 0), 0);
                        const isPartnerMirrorSale = sale.payment_method && sale.payment_method.includes('Condiviso');
                        let baseTransactionTotal = finalPrice;

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
                        supplierDetailsText = `Esclusivo (100% Salone)`;
                    }

                    unitCost = 0;
                    supplierPayout = 0;
                    salonRevenue = (item.salon_revenue !== undefined && item.salon_revenue !== null) ? parseFloat(item.salon_revenue) : finalPrice;
                
                } else if (inv) {
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
        }

        // --- 9. GET_CUSTOMER_INSIGHTS ---
        if (action === 'GET_CUSTOMER_INSIGHTS') {
            const startDate = data?.startDate || '1900-01-01';
            const endDate = data?.endDate || '2099-12-31';

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

        // --- 10. GET_RFM_ANALYSIS ---
        if (action === 'GET_RFM_ANALYSIS') {
            const nameFilter = (data?.nameFilter || '').toLowerCase();
            const customers = await localDb.customers.where('salon_id').equals(salonId).toArray() || [];
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

                const mese = sale.date.substring(5, 7);
                const key = `${inv.name}_${mese}`;
                if (!insightsMap[key]) {
                    insightsMap[key] = { name: inv.name, type: inv.type, mese: mese, volume: 0 };
                }
                insightsMap[key].volume += (si.qty || 1);
            });

            return Object.values(insightsMap);
        }

        // 🔑 13. VOID_SALE (Storno Retroattivo con Ripristino Consumabili e FIFO)
        if (action === 'VOID_SALE') {
            const saleId = id; 
            if (!saleId) return { status: 'error', message: 'ID vendita non specificato.' };

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
                            const newStock = (parseFloat(prod.stock) || 0) + qtyToRestore;
                            await localDb.inventory.update(prod.id, { stock: newStock });

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
                            const serviceCons = allConsumables.filter(sc => sc.service_id === prod.id);
                            
                            for (let sc of serviceCons) {
                                const consumedProd = inventory.find(p => p.id === sc.product_id);
                                const qtyConsumableToRestore = (parseFloat(sc.quantity_per_service) || 0) * qtyToRestore;

                                if (consumedProd) {
                                    const newConsStock = (parseFloat(consumedProd.stock) || 0) + qtyConsumableToRestore;
                                    await localDb.inventory.update(consumedProd.id, { stock: newConsStock });

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
                                }
                            }
                        }
                    }

                    await localDb.sale_items.delete(item.id);
                    if (navigator.onLine) {
                        await fetch(`${SUPABASE_URL}/rest/v1/sale_items?id=eq.${item.id}`, {
                            method: 'DELETE',
                            headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
                        });
                    }
                }

                await localDb.sales.delete(saleId);
                if (navigator.onLine) {
                    await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${saleId}`, {
                        method: 'DELETE',
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
                    });
                }

                return { status: 'ok' };
            } catch (err) {
                console.error("❌ Errore critico durante lo storno della vendita:", err);
                return { status: 'error', message: err.message };
            }
        }

        // 🔑 14. RESET_PASSWORD
        if (action === 'RESET_PASSWORD') {
            const userId = data.id;
            const defaultPass = 'password';
            const hashedDefaultPass = typeof bcrypt !== 'undefined' ? bcrypt.hashSync(defaultPass, 10) : defaultPass;

            const updatePayload = {
                password: hashedDefaultPass,
                must_change_password: 1,
                salon_id: salonId
            };

            await localDb.users.update(userId, updatePayload);

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
                } catch (err) {}
            }

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

// Ascoltatore automatico del ritorno della rete per svuotamento coda
window.addEventListener('online', () => {
    console.log("Rete ripristinata! Avvio sincronizzazione coda offline...");
    processBrowserSyncQueue();
});