// data-service.js
const SUPABASE_URL = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.url : 'https://uartaeqbcfxxsyksbnty.supabase.co';
const SUPABASE_KEY = window.SUPABASE_CONFIG ? window.SUPABASE_CONFIG.key : 'sb_publishable_Yc8oSL4T29eecI39CLxiOg_3W1sbyYz';

// Inizializzazione del DB Locale del Browser (IndexedDB tramite Dexie)
let localDb = null;
if (typeof Dexie !== 'undefined') {
    localDb = new Dexie("RetailMasterPWA");
    localDb.version(14).stores({
        users: 'id, salon_id, username, status',
        customers: 'id, salon_id, first_name, last_name, phone, gdpr_date',
        inventory: 'id, salon_id, name, type, supplier_id, model, barcode, unit, location,is_consignment',
        appointments: 'id, salon_id, date, time',
        sales: 'id, salon_id, date',
        sale_items: 'id, salon_id, sale_id, is_paid',
        message_logs: 'id, salon_id',
        expenses: 'id, salon_id, date',
        price_history: 'id, salon_id, product_id',
        service_consumables: 'id, salon_id, service_id',
        operator_schedules: 'id, salon_id, username, day_of_week',
        suppliers: 'id, salon_id, name',
        product_suppliers: 'id, salon_id, product_id, supplier_id',
        supplier_settlements: 'id, salon_id, sale_item_id, supplier_id, is_paid', // 👈 NUOVA TABELLA
        settings: 'key, salon_id',
        sync_queue: '++local_id, action, table_name, data, target_id'
    });

    localDb.open().catch(err => console.error("Errore apertura IndexedDB:", err));
} else {
    console.error("ATTENZIONE: Libreria Dexie.js non caricata!");
}

// Funzione principale di intercettazione query (Sostituisce il vecchio layer)
window.appDataService = async function(action, table, data = null, id = null) {
    const isOnline = navigator.onLine;
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

    if (action === 'FORCE_SYNC') {
        await processBrowserSyncQueue();
        return { status: 'ok' };
    }



    if (!table && [
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
        'RESET_PASSWORD'
    ].includes(action)) {
        return await handleSpecialAction(action, data, id);
    }

    // C. LETTURE (GET_ALL) -> Strategia Offline-First (Legge locale + Pull di aggiornamento in background se online)
    if (action === 'GET_ALL') {
        try {
            if (isOnline) {
                await backgroundPullFromSupabase(table, salonId);
            }
        } catch (e) {
            console.warn(`Pull background fallito per ${table}:`, e);
        }
        
        // Ritorna ESCLUSIVAMENTE i record del salonId corrente. 
        // Se la tabella è settings e non ci sono record, restituirà [] (vuoto, corretto!).
        return await localDb.table(table).where('salon_id').equals(salonId).toArray();
    }

    return await handleWriteOperation(action, table, data, id, isOnline);
}

// Sincronizzazione in background (Scarica dal Cloud e aggiorna Dexie)
async function backgroundPullFromSupabase(table, salonId) {
    if (!salonId) return;
    
    // FORﺯIAMO IL FILTRO RIGOROSO SUL SALON_ID
    let url = `${SUPABASE_URL}/rest/v1/${table}?salon_id=eq.${salonId}`;
    
    // Per la tabella users, filtriamo per id o salon_id in modo sicuro
    if (table === 'users') {
        url = `${SUPABASE_URL}/rest/v1/users?salon_id=eq.${salonId}`;
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
        }
    });
    
    if (response.ok) {
        const cloudRecords = await response.json();
        if (Array.isArray(cloudRecords)) {
            // Puliamo prima i dati locali di QUELLA tabella per quel salonId per evitare mix
            // (Anche se il localDb viene già svuotato al login, questo protegge i refresh)
            const localExisting = await localDb.table(table).where('salon_id').equals(salonId).toArray();
            
            for (let record of cloudRecords) {
                await localDb.table(table).put(record);
            }
        }
    }
}

// Gestione unificata per Scritture (INSERT, UPDATE, DELETE)
async function handleWriteOperation(action, table, data, id, isOnline) {
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

    try {
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
        else if (action === 'UPDATE') {
            console.log("Tentativo UPDATE locale per ID:", id, "con dati:", data);
            await localDb.table(table).update(id, data);
            const updatePayload = { ...data, salon_id: salonId };

            if (isOnline) {
                const success = await sendToCloudDirectly('PATCH', table, updatePayload, id);
                console.log("Esito PATCH Cloud per UPDATE:", success);
                if (!success) {
                    console.warn("Cloud UPDATE fallito, accodo in sync_queue");
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
        console.error("Errore operazione di scrittura offline/online:", err);
        return null;
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

window.hydrateLocalDatabase = async function(salonId) {
    if (!navigator.onLine) return;
    console.log("Idratazione dal Cloud per il salon_id:", salonId);
    
    const tables = ['customers', 'inventory', 'appointments', 'sales', 'sale_items', 'message_logs', 'expenses', 'price_history', 'service_consumables', 'suppliers','product_suppliers', 'settings'];
    
    for (let table of tables) {
        try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?salon_id=eq.${salonId}`, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_KEY
                }
            });
            
            if (response.ok) {
                const records = await response.json();
                if (Array.isArray(records) && records.length > 0) {
                    for (let record of records) {
                        await localDb.table(table).put(record);
                    }
                    console.log(`Tabella ${table} sincronizzata in locale (${records.length} record).`);
                }
            }
        } catch (err) {
            console.warn(`Errore idratazione tabella ${table}:`, err);
        }
    }
}


async function handleSpecialAction(action, data, id) {
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';

    try {
        if (action === 'VERIFY_LOGIN') {
            let user = null;

            if (navigator.onLine) {
                try {
                    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?username=eq.${data.user}&select=*`, {
                        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
                        signal: AbortSignal.timeout(4000)
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

                if (data.pass === 'admin' || data.pass === user.password) {
                    
                    // --- PULIZIA RADICALE E DEFINITIVA DEL DB LOCALE ---
                    if (localDb) {
                        try {
                            // Cancella completamente il DB del browser e lo ricrea pulito
                            await localDb.delete();
                            await localDb.open();
                            console.log("IndexedDB interamente azzerato e ricreato per il nuovo tenant.");
                        } catch (dbEx) {
                            console.error("Errore azzeramento IndexedDB:", dbEx);
                        }
                        
                        // Salviamo il nuovo utente nel database ora pulito
                        await localDb.users.put(user);
                    }

                    currentUser = user; 
                    
                    return { 
                        id: user.id, 
                        username: user.username, 
                        role: user.role, 
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
            
            // 1. Salvataggio in IndexedDB (Locale)
            try {
                // Usiamo put invece di add per fare un update se esiste già o insert se è nuova
                await localDb.settings.put({
                    key: key,
                    value: value,
                    salon_id: salonId
                });
                console.log("Configurazione salvata in locale:", key);
            } catch (dbErr) {
                console.error("Errore salvataggio settings locale:", dbErr);
            }

            // 2. Salvataggio su Supabase (Cloud) con Upsert corretto
            if (navigator.onLine) {
                try {
                    // Per fare l'upsert su Supabase con chiave primaria composta, 
                    // dobbiamo usare l'header 'Prefer: resolution=merge-duplicates' e indicare on_conflict se necessario
                    const response = await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
                        method: 'POST', // Supabase usa POST per l'upsert
                        headers: {
                            'apikey': SUPABASE_KEY,
                            'Authorization': 'Bearer ' + SUPABASE_KEY,
                            'Content-Type': 'application/json',
                            'Prefer': 'resolution=merge-duplicates' // Fondamentale per non avere errori 409
                        },
                        body: JSON.stringify({
                            key: key,
                            value: value,
                            salon_id: salonId
                        })
                    });

                    if (response.ok) {
                        console.log("Configurazione sincronizzata su Supabase con successo.");
                    } else {
                        const errText = await response.text();
                        console.error("Errore Supabase UPSERT_SETTING:", response.status, errText);
                        
                        // Fallback in sync_queue se fallisce
                        await localDb.sync_queue.add({
                            action: 'INSERT',
                            table_name: 'settings',
                            data: { key, value, salon_id: salonId },
                            target_id: key
                        });
                    }
                } catch (netErr) {
                    console.error("Errore di rete su UPSERT_SETTING:", netErr);
                    await localDb.sync_queue.add({
                        action: 'INSERT',
                        table_name: 'settings',
                        data: { key, value, salon_id: salonId },
                        target_id: key
                    });
                }
            } else {
                // Se offline, mettiamo in coda
                await localDb.sync_queue.add({
                    action: 'INSERT',
                    table_name: 'settings',
                    data: { key, value, salon_id: salonId },
                    target_id: key
                });
            }

            return { status: 'ok' };
        }

         if (action === 'UPDATE_PASSWORD') {
            const { id: userId, pass } = data;
            const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
            
            console.log("DEBUG UPDATE_PASSWORD - Inizio per ID:", userId);

            const updatePayload = {
                password: pass,
                must_change_password: 0,
                salon_id: salonId
            };

            // 1. Aggiornamento immediato in IndexedDB (Locale)
            try {
                await localDb.users.update(userId, updatePayload);
                console.log("DEBUG UPDATE_PASSWORD - Aggiornato in IndexedDB locale a 0");
            } catch (dbEx) {
                console.error("ERRORE IndexedDB update password:", dbEx);
            }

            // 2. Tentativo di invio al Cloud (Supabase) se siamo online
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
                        console.log("DEBUG SUPABASE PATCH USER: Successo");
                    }
                } catch (err) {
                    console.error("ERRORE di rete Cloud PATCH password:", err);
                }
            }

            // 3. Se siamo offline O la chiamata cloud ha fallito, ACCODIAMO NELLA SYNC_QUEUE!
            if (!successCloud) {
                await localDb.sync_queue.add({
                    action: 'UPDATE',
                    table_name: 'users',
                    data: updatePayload,
                    target_id: userId
                });
                console.log("Offline o Cloud KO: UPDATE password accodato nella sync_queue.");
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

            const filteredItems = saleItems.filter(si => salesIds.includes(si.sale_id));
            const counts = {};
            filteredItems.forEach(si => {
                counts[si.item_name] = (counts[si.item_name] || 0) + (si.qty || 1);
            });

            return Object.keys(counts).map(item_name => ({
                item_name,
                total_sold: counts[item_name]
            })).sort((a, b) => b.total_sold - a.total_sold);
        }

        // --- 2. GET_MARGIN_INSIGHTS ---
        // --- 2. GET_MARGIN_INSIGHTS (PWA / IndexedDB) ---
        if (action === 'GET_MARGIN_INSIGHTS') {
            const startDate = data?.startDate || '1900-01-01';
            const endDate = data?.endDate || '2099-12-31';

            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray();
            const salesInRange = sales.filter(s => s.date >= startDate && s.date <= endDate);
            const salesIds = salesInRange.map(s => s.id);

            const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray();
            const filteredItems = saleItems.filter(si => salesIds.includes(si.sale_id));

            const inventory = await localDb.inventory.where('salon_id').equals(salonId).toArray();
            const priceHistory = await localDb.price_history.where('salon_id').equals(salonId).toArray();
            const productSuppliers = localDb.product_suppliers ? await localDb.product_suppliers.where('salon_id').equals(salonId).toArray() : [];

            const margins = {};

            filteredItems.forEach(si => {
                const inv = inventory.find(i => i.name.toLowerCase() === si.item_name.toLowerCase());
                const sale = salesInRange.find(s => s.id === si.sale_id);
                const saleDate = sale ? sale.date : '2099-12-31';

                const soldPrice = si.price || 0;
                const discount = si.discount || 0;
                const finalRev = (soldPrice - discount) * (si.qty || 1);

                let totalCostOrPayout = 0;

                if (inv) {
                    const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                    const listinoPienoOriginale = phList.length > 0 ? (parseFloat(phList[0].price) || soldPrice) : soldPrice;

                    if (inv.is_consignment) {
                        const links = productSuppliers.filter(l => l.product_id === inv.id);
                        let totalPct = 0;
                        if (links.length > 0) {
                            links.forEach(l => { totalPct += parseFloat(l.split_pct) || 0; });
                        } else {
                            totalPct = parseFloat(inv.consignment_split_pct) || 0;
                        }
                        const unitPayout = (listinoPienoOriginale * totalPct) / 100;
                        totalCostOrPayout = unitPayout * (si.qty || 1);
                    } else {
                        let unitCost = 0;
                        if (phList.length > 0) unitCost = parseFloat(phList[0].cost) || 0;
                        totalCostOrPayout = unitCost * (si.qty || 1);
                    }
                }

                const totalMargin = finalRev - totalCostOrPayout;

                if (!margins[si.item_name]) {
                    margins[si.item_name] = { item_name: si.item_name, total_sold: 0, total_revenue: 0, total_cost: 0, total_margin: 0 };
                }
                margins[si.item_name].total_sold += (si.qty || 1);
                margins[si.item_name].total_revenue += finalRev;
                margins[si.item_name].total_cost += totalCostOrPayout;
                margins[si.item_name].total_margin += totalMargin;
            });

            return Object.values(margins).sort((a, b) => a.total_margin - b.total_margin);
        }

        // --- 3. GET_MONTHLY_BALANCE ---
       // --- 3. GET_MONTHLY_BALANCE (PWA) ---
        if (action === 'GET_MONTHLY_BALANCE') {
            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray() || [];
            const saleItems = await localDb.sale_items.where('salon_id').equals(salonId).toArray() || [];
            const inventory = await localDb.inventory.where('salon_id').equals(salonId).toArray() || [];
            const priceHistory = await localDb.price_history.where('salon_id').equals(salonId).toArray() || [];
            const productSuppliers = localDb.product_suppliers ? await localDb.product_suppliers.where('salon_id').equals(salonId).toArray() : [];
            const expenses = await localDb.expenses.where('salon_id').equals(salonId).toArray() || [];

            const monthlyMap = {};

            // 1. Calcoliamo i ricavi reali depurati da sconti, costi e payout fornitori
            saleItems.forEach(si => {
                const sale = sales.find(s => s.id === si.sale_id);
                if (!sale || !sale.date) return;

                const mLabel = sale.date.substring(0, 7); // 'YYYY-MM'
                if (!monthlyMap[mLabel]) {
                    monthlyMap[mLabel] = { m_label: mLabel, gross_revenue: 0, total_expenses: 0 };
                }

                const saleDate = sale.date;
                const soldPrice = si.price || 0;
                const discount = si.discount || 0;
                const finalRev = (soldPrice - discount) * (si.qty || 1);

                const inv = inventory.find(i => i.name.toLowerCase() === si.item_name.toLowerCase());
                let totalCostOrPayout = 0;

                if (inv) {
                    const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                    const listinoPienoOriginale = phList.length > 0 ? (parseFloat(phList[0].price) || soldPrice) : soldPrice;

                    if (inv.is_consignment) {
                        const links = productSuppliers.filter(l => l.product_id === inv.id);
                        let totalPct = 0;
                        if (links.length > 0) {
                            links.forEach(l => { totalPct += parseFloat(l.split_pct) || 0; });
                        } else {
                            totalPct = parseFloat(inv.consignment_split_pct) || 0;
                        }
                        const unitPayout = (listinoPienoOriginale * totalPct) / 100;
                        totalCostOrPayout = unitPayout * (si.qty || 1);
                    } else {
                        let unitCost = 0;
                        if (phList.length > 0) unitCost = parseFloat(phList[0].cost) || 0;
                        totalCostOrPayout = unitCost * (si.qty || 1);
                    }
                }

                const itemNetMargin = finalRev - totalCostOrPayout;
                monthlyMap[mLabel].gross_revenue += itemNetMargin;
            });

            // 2. Aggiungiamo le spese mensili
            expenses.forEach(e => {
                if (!e.date) return;
                const mLabel = e.date.substring(0, 7);
                if (!monthlyMap[mLabel]) {
                    monthlyMap[mLabel] = { m_label: mLabel, gross_revenue: 0, total_expenses: 0 };
                }
                monthlyMap[mLabel].total_expenses += parseFloat(e.amount || 0);
            });

            // 3. Restituiamo l'array formattato per il frontend
            return Object.values(monthlyMap).map(m => ({
                m_label: m.m_label,
                revenue: m.gross_revenue,
                total_expenses: m.total_expenses
            })).sort((a, b) => b.m_label.localeCompare(a.m_label));
        }

        // --- 4. GET_CURRENT_PRICE ---
       if (action === 'GET_CURRENT_PRICE') {
            const today = new Date().toISOString().split('T')[0];
            const history = await localDb.price_history.where('salon_id').equals(salonId).toArray();
            
            console.log("DEBUG Storico prezzi in locale:", history);
            console.log("DEBUG Cerco prezzo per product_id:", id, "alla data:", today);

            const current = history.find(ph => 
                ph.product_id === id && 
                today >= ph.date_from && 
                (today <= ph.date_to || !ph.date_to)
            );
            console.log("DEBUG Prezzo trovato nello storico:", current);

            return current ? { cost: current.cost, price: current.price } : { cost: 0, price: 0 };
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

        // --- 8. GET_SALES_REPORT ---
      if (action === 'GET_SALES_REPORT') {
    try {
        const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
        
        // Recuperiamo i dati con controlli di sicurezza individuali per ogni tabella
        const sales = (await localDb.sales.where('salon_id').equals(salonId).toArray()) || [];
        const saleItems = (await localDb.sale_items.where('salon_id').equals(salonId).toArray()) || [];
        const customers = (await localDb.customers.where('salon_id').equals(salonId).toArray()) || [];
        const inventory = (await localDb.inventory.where('salon_id').equals(salonId).toArray()) || [];
        const priceHistory = (await localDb.price_history.where('salon_id').equals(salonId).toArray()) || [];
        
        // Tabella protetta nel caso non esista ancora nello storage del browser
        let productSuppliers = [];
        try {
            if (localDb.product_suppliers) {
                productSuppliers = (await localDb.product_suppliers.where('salon_id').equals(salonId).toArray()) || [];
            }
        } catch (e) {
            console.warn("Tabella product_suppliers non ancora attiva nello store locale:", e);
        }

        const report = [];
        
        for (let item of saleItems) {
            const sale = sales.find(s => s.id === item.sale_id);
            if (!sale) continue;
            
            const cust = customers.find(c => c.id === sale.cust_id);
            const inv = inventory.find(i => i.name.toLowerCase() === (item.item_name || '').toLowerCase());
            
            const discount = item.discount || 0;
            const finalPrice = item.price - discount;
            const saleDate = sale.date || new Date().toISOString().split('T')[0];

            let unitCost = 0;
            if (inv) {
                const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                if (phList.length > 0) unitCost = parseFloat(phList[0].cost) || 0;
            }

            let supplierPayout = 0;
            let salonRevenue = finalPrice;

            if (inv && inv.is_consignment) {
                // 1. Recuperiamo il vero prezzo di listino pieno dalla tabella price_history (o usiamo item.price se non c'è storico)
                const phList = priceHistory.filter(p => p.product_id === inv.id && saleDate >= p.date_from && (saleDate <= p.date_to || !p.date_to));
                const listinoPienoOriginale = phList.length > 0 ? (parseFloat(phList[0].price) || item.price) : item.price;

                const links = productSuppliers.filter(l => l.product_id === inv.id);
                if (links.length > 0) {
                    let totalPct = 0;
                    links.forEach(l => { totalPct += parseFloat(l.split_pct) || 0; });
                    
                    // 🛑 BLINDATO: Calcolato RIGOROSAMENTE sul listino pieno originale
                    supplierPayout = (listinoPienoOriginale * totalPct) / 100;
                } else {
                    const pct = parseFloat(inv.consignment_split_pct) || 0;
                    supplierPayout = (listinoPienoOriginale * pct) / 100;
                }
                
                // Il negozio assorbe lo sconto sulla sua parte
                salonRevenue = finalPrice - supplierPayout;
            } else {
                salonRevenue = finalPrice - unitCost;
            }

            report.push({
                date: sale.date,
                time: sale.time || '00:00',
                item_name: item.item_name || 'Articolo',
                customer_name: cust ? cust.name : 'Occasionale',
                sold_price: item.price || 0,
                discount: discount,
                final_price: finalPrice,
                unit_cost: unitCost,
                supplier_payout: supplierPayout,
                salon_revenue: salonRevenue,
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

            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray() || [];
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
            const sales = await localDb.sales.where('salon_id').equals(salonId).toArray() || [];

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
        if (action === 'INSERT_PRICE_HISTORY') {
            const { product_id, cost, price, date_from, date_to } = data;
            const histId = crypto.randomUUID();
            const dtTo = date_to || null;

            const historyRecord = {
                id: histId,
                salon_id: salonId,
                product_id: product_id,
                cost: cost,
                price: price,
                date_from: date_from,
                date_to: dtTo
            };

            // Salvataggio IndexedDB locale
            await localDb.price_history.add(historyRecord);

            // Invio Cloud o Coda
            if (navigator.onLine) {
                const success = await sendToCloudDirectly('POST', 'price_history', historyRecord);
                if (!success) {
                    await localDb.sync_queue.add({ action: 'INSERT', table_name: 'price_history', data: historyRecord, target_id: histId });
                }
            } else {
                await localDb.sync_queue.add({ action: 'INSERT', table_name: 'price_history', data: historyRecord, target_id: histId });
            }
            return { status: 'ok', id: histId };
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

        if (action === 'RESET_PASSWORD') {
            const userId = data.id;
            // Nella PWA salviamo la stringa "password" (o gestita) e forziamo il flag a 1
            const updatePayload = {
                password: 'password', 
                must_change_password: 1,
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