// =========================================================================
// 🤖 VAIMUP AUTONOMOUS AGENT CORE - UNIVERSAL TOOL-CALLING & REACT ENGINE
// Local-First Dexie.js + Supabase Multi-Tenant Architecture
// =========================================================================

// Inizializzazione sicura del contesto agente
if (!window._aiAgentContext) {
    window._aiAgentContext = {
        lastCustomer: null,
        lastCustomerId: null,
        lastProduct: null,
        lastDate: null,
        lastAppointmentId: null,
        pendingAction: null // Human-In-The-Loop safety gate state
    };
}

// -------------------------------------------------------------------------
// 1. KNOWLEDGE BASE OPERATIVA DI SISTEMA (MANUALE FUNZIONALITÀ GESTIONALE)
// -------------------------------------------------------------------------
const VAIMUP_APP_MANUAL = `
MANUALE OPERATIVO GESTIONALE VAIMUP PER IL PERSONALE E IL TITOLARE:
1. STORNO DI CASSA:
   - Si effettua da "📈 Report Vendite" nel menu laterale (sezione Gestione & Analisi).
   - Si individua la vendita da annullare tramite i filtri (data, cliente o operatore) e si clicca sul pulsante rosso "Storna" a destra.
   - Effetti automatici: le giacenze e i lotti FIFO di magazzino vengono ripristinati e l'incasso viene stornato dal bilancio del salone.
2. CARICO MAGAZZINO & LOTTI FIFO:
   - Si effettua da "📦 Magazzino Prodotti".
   - Per carico veloce con barcode: pulsante "⚡ Scan & Carico" in alto con pistola laser o fotocamera.
   - Per carico manuale da tabella: icona "📦" nella riga del prodotto.
   - Crea un lotto FIFO con costo d'acquisto storico e registra la spesa a bilancio se prodotto di proprietà.
3. PACCHETTI & CARNET:
   - Configurazione da "🎁 Pacchetti & Carnet" -> "+ Nuovo Pacchetto".
   - Vendita in "🛒 Cassa & POS" selezionando il cliente e il pacchetto.
   - Riscatto in Agenda: selezionando il cliente il sistema propone di scalare la seduta a € 0.00.
4. COWORKING & POSTAZIONI FISICHE:
   - Da "🏢 Spazi & Coworking" con blocco atomico anti-overbooking. Gli altri negozi vedono la postazione occupata senza poter leggere i dati anagrafici del cliente finale (privacy GDPR).
5. STAMPA LISTINI:
   - Da "🖨️ Stampa & Listini", formati A4, A5, A3 e Poster 50x70.
6. BOOKING ONLINE (SELF-BOOKING):
   - I clienti prenotano 24/7 dal link o QR code senza installare app.
`;

// -------------------------------------------------------------------------
// 2. GUIDA PROCEDURALE DETERMINISTICA
// -------------------------------------------------------------------------
function getDeterministicAppGuide(query) {
    const q = (query || '').toLowerCase().trim();

    if (q.includes('storno') || q.includes('stornare') || (q.includes('annulla') && q.includes('vendita')) || (q.includes('cancella') && q.includes('scontrino'))) {
        return `🛒 **Guida Ufficiale: Come Effettuare uno Storno di Cassa**\n\n` +
            `In VaiMUp lo storno è una procedura guidata con **effetto retroattivo automatico e completo**:\n\n` +
            `1. **Apri il Report**: Nel menu laterale clicca su **"📈 Report Vendite"** (sezione *Gestione & Analisi*).\n` +
            `2. **Individua la Vendita**: Cerca la transazione da annullare usando i filtri in alto (per Data, Cliente o Operatore).\n` +
            `3. **Premi "Storna"**: All'estrema destra della riga, clicca sul pulsante rosso **"Storna"**.\n` +
            `4. **Conferma l'Avviso**: Premi **"OK"** nella finestra di dialogo.\n\n` +
            `✨ **Cosa fa automaticamente il sistema in background:**\n` +
            `- **Magazzino & Lotti FIFO**: I prodotti fisici e i materiali consumabili dei servizi venduti vengono ripristinati istantaneamente nelle giacenze reali.\n` +
            `- **Bilancio & Incassi**: L'importo viene cancellato dal fatturato e i margini operativi netti vengono ricalcolati senza lasciare alcun disallineamento contabile.`;
    }

    if (q.includes('carico') && (q.includes('magazzino') || q.includes('merce') || q.includes('fifo') || q.includes('prodotto'))) {
        return `📦 **Guida Ufficiale: Carico Merce con Tracciamento Lotti FIFO**\n\n` +
            `In VaiMUp ogni carico genera un lotto di costo storico reale (First-In, First-Out):\n\n` +
            `1. **Vai al Magazzino**: Dal menu laterale apri **"📦 Magazzino Prodotti"**.\n` +
            `2. **Modalità Rapida con Barcode**:\n` +
            `   - Clicca sul pulsante verde in alto **"⚡ Scan & Carico"**.\n` +
            `   - Spara il codice a barre con il lettore laser o usa la fotocamera 📷 dello smartphone.\n` +
            `   - Inserisci la quantità ricevuta e il costo d'acquisto totale della fornitura.\n` +
            `3. **Carico da Tabella**:\n` +
            `   - Nella riga del prodotto clicca sull'icona **"📦" (Carico Merce)**.\n` +
            `   - Indica la quantità arrivata e la spesa complessiva.\n` +
            `4. **Conferma**: Premi **"Conferma e Registra Carico"**.\n\n` +
            `✨ **Cosa accade nel sistema:**\n` +
            `- Viene creato un lotto FIFO con data, ora e costo unitario d'acquisto esatto.\n` +
            `- Se il prodotto è di proprietà, il sistema genera in automatico la spesa a bilancio per coprire il costo fornitore.`;
    }

    if ((q.includes('pacchetto') || q.includes('carnet') || q.includes('sedute')) && (q.includes('come') || q.includes('funziona') || q.includes('creare') || q.includes('vendere'))) {
        return `🎁 **Guida Ufficiale: Gestione Pacchetti e Carnet Prepagati**\n\n` +
            `1. **Configurazione Pacchetto**: Vai in **"🎁 Pacchetti & Carnet"** ➔ Clicca **"+ Nuovo Pacchetto"**, assegna un prezzo totale e aggiungi i servizi inclusi con il numero di sedute.\n` +
            `2. **Vendita in Cassa**: In **"🛒 Cassa & POS"**, seleziona il cliente, tocca il pacchetto dal catalogo e registra l'incasso (anche parziale con rata).\n` +
            `3. **Riscatto in Agenda**: Quando fissi l'appuntamento per quel cliente, il sistema rileva in automatico il carnet attivo e ti propone di scalare 1 seduta a **€ 0.00**!`;
    }

    if ((q.includes('postazion') || q.includes('coworking') || q.includes('cabina') || q.includes('poltrona')) && (q.includes('come') || q.includes('funziona'))) {
        return `🏢 **Guida Ufficiale: Spazi & Coworking Multi-Tenant**\n\n` +
            `1. **Configura lo Spazio**: Vai in **"🏢 Spazi & Coworking"** ➔ Clicca **"+"** per creare cabine o poltrone e impostare i negozi partner abilitati.\n` +
            `2. **Blocco Automatico**: Quando inserisci un appuntamento che richiede una postazione specifica, il sistema riserva lo slot in modo atomico.\n` +
            `3. **Tutela della Privacy**: Gli altri saloni vedranno lo spazio occupato come *"Bloccato da Altro Salone"*, senza poter leggere i dati anagrafici del cliente finale.`;
    }

    if ((q.includes('stampa') || q.includes('listino')) && (q.includes('come') || q.includes('formato') || q.includes('pdf'))) {
        return `🖨️ **Guida Ufficiale: Print Studio & Cartelli Vetrina**\n\n` +
            `1. Dal menu laterale apri **"🖨️ Stampa & Listini"**.\n` +
            `2. Scegli la modalità: **Listino Trattamenti** oppure **Cartello QR Booking** per vetrine.\n` +
            `3. Seleziona il formato carta (A4, A5 compatto, A3 o Poster Maxi 50x70) e il tema grafico d'autore.\n` +
            `4. Puoi trascinare direttamente con il mouse il logo o le intestazioni per adattarli al millimetro prima di stampare o salvare in PDF!`;
    }

    return null;
}
window.getDeterministicAppGuide = getDeterministicAppGuide;

// -------------------------------------------------------------------------
// 3. RECUPERO CHIAVE IA DA SUPABASE (SILENZIOSO, ZERO ESPOSIZIONE UI)
// -------------------------------------------------------------------------
async function getOrLoadAiApiKey() {
    if (window._runtimeAiKey && window._runtimeAiKey.length > 15 && !window._runtimeAiKey.includes("INSERISCI")) {
        return window._runtimeAiKey;
    }
    if (typeof loadSecureAiKey === 'function') {
        const key = await loadSecureAiKey();
        if (key && key.length > 15) return key;
    }
    const storageKey = localStorage.getItem('vaimup_ai_runtime_key');
    if (storageKey && storageKey.length > 15 && !storageKey.includes("INSERISCI")) {
        window._runtimeAiKey = storageKey;
        return storageKey;
    }
    return null;
}
window.getOrLoadAiApiKey = getOrLoadAiApiKey;

// -------------------------------------------------------------------------
// 4. PIPELINE DI CHIAMATA LLM RESILIENTE
// -------------------------------------------------------------------------
async function callAgentBrain(messages) {
    const apiKey = await getOrLoadAiApiKey();
    if (!apiKey || apiKey.includes("INSERISCI")) {
        throw new Error("API_KEY_MISSING");
    }

    const isGoogleKey = apiKey.startsWith("AIza");

    // Endpoint Google Gemini Nativo
    if (isGoogleKey) {
        const geminiModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        for (const gModel of geminiModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: messages.map(m => ({
                            role: m.role === 'system' ? 'user' : (m.role === 'assistant' ? 'model' : 'user'),
                            parts: [{ text: (m.role === 'system' ? `[ISTRUZIONI DI SISTEMA]: ${m.content}\n\n` : '') + m.content }]
                        })),
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 1000,
                            responseMimeType: "application/json"
                        }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                }
            } catch (e) {}
        }
        throw new Error("Errore comunicazione Gemini nativo.");
    }

    // Endpoint OpenRouter
    const candidateModels = [
        "meta-llama/llama-3.3-70b-instruct",
        "openrouter/auto",
        "deepseek/deepseek-chat"
    ];

    for (const modelId of candidateModels) {
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'VaiMUp Autonomous Agent'
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: messages,
                    temperature: 0.1,
                    max_tokens: 1000
                })
            });
            if (res.ok) {
                const data = await res.json();
                return data.choices?.[0]?.message?.content || "";
            }
        } catch (e) {}
    }

    throw new Error("Tutti i provider OpenRouter hanno risposto con errore.");
}
window.callAgentBrain = callAgentBrain;

// -------------------------------------------------------------------------
// 5. PARSER E SANITIZZATORE JSON RESILIENTE
// -------------------------------------------------------------------------
function sanitizeJson(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw.trim());
    } catch (e) {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch (err) {}
        }
        return null;
    }
}
window.sanitizeJson = sanitizeJson;

// -------------------------------------------------------------------------
// 6. RISOLUTORE DETERMINISTICO DI DATE ED ORARI
// -------------------------------------------------------------------------
function resolveNaturalDate(dateInput) {
    if (!dateInput) return new Date().toISOString().split('T')[0];
    const clean = String(dateInput).toLowerCase().trim();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (clean === 'domani' || clean.includes('domani')) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return toYmd(d);
    }
    if (clean === 'dopodomani' || clean.includes('dopodomani')) {
        const d = new Date(now);
        d.setDate(d.getDate() + 2);
        return toYmd(d);
    }
    if (clean === 'oggi' || clean.includes('oggi')) {
        return toYmd(now);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return clean;
    }
    // Formato GG/MM o GG-MM
    const match = clean.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        let year = match[3] ? parseInt(match[3], 10) : now.getFullYear();
        if (year < 100) year += 2000;
        return `${year}-${pad(month)}-${pad(day)}`;
    }
    return toYmd(now);
}

function resolveNaturalTime(timeInput) {
    if (!timeInput) return "09:00";
    let clean = String(timeInput).toLowerCase().trim();
    // Se è solo un numero (es. "15" -> "15:00")
    if (/^\d{1,2}$/.test(clean)) {
        const h = parseInt(clean, 10);
        return `${String(h).padStart(2, '0')}:00`;
    }
    const match = clean.match(/([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])/);
    if (match) {
        return `${String(parseInt(match[1], 10)).padStart(2, '0')}:${match[2]}`;
    }
    return "09:00";
}

// -------------------------------------------------------------------------
// 7. REGISTRY DEI TOOL UNIVERSALI (ESECUZIONE DETERMINISTICA LOCALE DEXIE)
// -------------------------------------------------------------------------

/**
 * TOOL 1: Ricerca Universale sul Database Locale (Dexie)
 */
async function tool_query_db(rawParams = {}) {
    const params = rawParams || {};
    const table = params.table || 'appointments';

    const searchTarget = params.customer || params.customerName || params.cust_name || params.client || params.search || params.query || '';
    const timeline = params.timeline || (params.past ? 'past' : (params.future ? 'future' : 'all'));
    const specificDate = params.date || '';
    let dateFrom = params.date_from || params.startDate || '';
    let dateTo = params.date_to || params.endDate || '';
    const month = params.month || '';

    const todayStr = new Date().toISOString().split('T')[0];
    const nowTimeStr = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

    if (month === 'last_month' || params.period === 'last_month') {
        const d = new Date();
        const prevMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        const lastDay = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
        const pad = (n) => String(n).padStart(2, '0');
        dateFrom = `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-01`;
        dateTo = `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-${pad(lastDay)}`;
    } else if (month === 'this_month' || params.period === 'this_month') {
        const d = new Date();
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const pad = (n) => String(n).padStart(2, '0');
        dateFrom = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
        dateTo = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(lastDay)}`;
    } else if (/^\d{4}-\d{2}$/.test(month)) {
        const parts = month.split('-');
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const lastDay = new Date(y, m, 0).getDate();
        const pad = (n) => String(n).padStart(2, '0');
        dateFrom = `${y}-${pad(m)}-01`;
        dateTo = `${y}-${pad(m)}-${pad(lastDay)}`;
    }

    const records = await window.universalQuery({ action: 'GET_ALL', table: table }) || [];
    const customers = (table !== 'customers') ? (await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || []) : [];

    let results = records;

    // 🛑 1. FILTRO SULL'AGENDA: ESCLUDE TASSATIVAMENTE LE PAUSE E LE FERIE
    if (table === 'appointments') {
        results = results.filter(a => {
            const cust = (a.cust_name || '').toLowerCase();
            const srv = (a.service || '').toLowerCase();
            const isPausa = cust.includes('pausa') || cust.includes('pranzo') || srv.includes('pausa') || srv.includes('pranzo');
            const isChiusura = cust.includes('chiusura') || cust.includes('ferie') || srv.includes('chiusura') || srv.includes('ferie');
            return !isPausa && !isChiusura;
        });
    }

    // 2. RICERCA TOKENIZZATA CLIENTE (Cognome Nome, Nome Cognome, Frammenti, o ID relazionale)
    if (searchTarget) {
        const cleanSearch = String(searchTarget).toLowerCase().replace(/⭐\s*\[preview\]/gi, '').trim();
        const tokens = cleanSearch.split(/\s+/).filter(t => t.length > 1);

        results = results.filter(row => {
            if (table === 'customers') {
                const fn = (row.first_name || '').toLowerCase();
                const ln = (row.last_name || '').toLowerCase();
                const full1 = `${fn} ${ln}`;
                const full2 = `${ln} ${fn}`;
                if (full1.includes(cleanSearch) || full2.includes(cleanSearch)) return true;
                if (tokens.length > 0 && tokens.every(tok => full1.includes(tok) || full2.includes(tok))) return true;
                return false;
            }

            if (table === 'appointments') {
                const appCust = (row.cust_name || '').toLowerCase().replace(/⭐\s*\[preview\]/gi, '').trim();

                if (appCust.includes(cleanSearch) || cleanSearch.includes(appCust)) return true;
                if (tokens.length > 0 && tokens.every(tok => appCust.includes(tok))) return true;

                if (customers.length > 0) {
                    const matchedCustomer = customers.find(c => {
                        const fn = (c.first_name || '').toLowerCase();
                        const ln = (c.last_name || '').toLowerCase();
                        const full1 = `${fn} ${ln}`;
                        const full2 = `${ln} ${fn}`;
                        return full1 === cleanSearch || full2 === cleanSearch || (fn && ln && cleanSearch.includes(fn) && cleanSearch.includes(ln));
                    });
                    if (matchedCustomer) {
                        if (row.cust_id && String(row.cust_id).trim() === String(matchedCustomer.id).trim()) return true;
                        const fn = (matchedCustomer.first_name || '').toLowerCase();
                        const ln = (matchedCustomer.last_name || '').toLowerCase();
                        if (fn && ln && appCust.includes(fn) && appCust.includes(ln)) return true;
                    }
                }
                return false;
            }

            const rowText = JSON.stringify(row).toLowerCase();
            return rowText.includes(cleanSearch);
        });
    }

    if (specificDate) {
        results = results.filter(r => (r.date || '').substring(0, 10) === specificDate);
    }
    if (dateFrom) {
        results = results.filter(r => (r.date || '').substring(0, 10) >= dateFrom);
    }
    if (dateTo) {
        results = results.filter(r => (r.date || '').substring(0, 10) <= dateTo);
    }

    if (table === 'appointments') {
        const past = results.filter(a => a.date < todayStr || (a.date === todayStr && (a.time || '') < nowTimeStr))
            .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

        const future = results.filter(a => a.date > todayStr || (a.date === todayStr && (a.time || '') >= nowTimeStr))
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        return {
            query_table: "appointments",
            customer_searched: searchTarget,
            filter_date_range: (dateFrom && dateTo) ? `${dateFrom} -> ${dateTo}` : (specificDate || "Nessun vincolo data"),
            total_real_client_appointments: results.length,
            future_appointments_count: future.length,
            future_appointments: future.slice(0, 10),
            past_appointments_count: past.length,
            past_appointments: past.slice(0, 10),
            most_recent_past_appointment: past[0] || null
        };
    }

    return {
        query_table: table,
        total_found: results.length,
        items: results.slice(0, 15)
    };
}
window.tool_query_db = tool_query_db;

/**
 * TOOL 2: Calcolo Deterministico dei Margini di Competenza Reale
 */
async function tool_get_analytics({ type }) {
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonth = todayStr.substring(0, 7);

    const marginInsights = await window.universalQuery({ action: 'GET_MARGIN_INSIGHTS' }) || [];
    const expenses = await window.universalQuery({ action: 'GET_ALL', table: 'expenses' }) || [];
    const monthExpenses = expenses.filter(e => e.date && e.date.startsWith(currentMonth));
    const totalExp = monthExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const services = inventory.filter(i => i.type === 'servizio');

    const rankedServices = marginInsights.filter(m => services.some(s => s.name.toLowerCase() === m.item_name.toLowerCase()));

    const totalRevenue = marginInsights.reduce((sum, i) => sum + (parseFloat(i.total_revenue) || 0), 0);
    const totalMargin = marginInsights.reduce((sum, i) => sum + (parseFloat(i.total_margin) || 0), 0);

    return {
        current_month: currentMonth,
        total_turnover: totalRevenue,
        total_salon_margin: totalMargin,
        total_expenses: totalExp,
        net_operating_profit: totalMargin - totalExp,
        top_services_by_margin: rankedServices.slice(0, 5),
        top_services_by_volume: [...rankedServices].sort((a, b) => b.total_sold - a.total_sold).slice(0, 5)
    };
}
window.tool_get_analytics = tool_get_analytics;

/**
 * TOOL 3: Simulatore Matematico "What-If"
 */
async function tool_simulate_what_if({ target, value, unit, category }) {
    let marginInsights = await window.universalQuery({ action: 'GET_MARGIN_INSIGHTS' }) || [];
    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const services = inventory.filter(i => i.type === 'servizio');

    let matchedService = null;

    if (target === 'highest_margin') {
        const srvMargins = marginInsights.filter(m => services.some(s => s.name.toLowerCase() === m.item_name.toLowerCase()));
        matchedService = srvMargins[0] || null;
    } else if (target === 'highest_volume') {
        const srvVols = marginInsights.filter(m => services.some(s => s.name.toLowerCase() === m.item_name.toLowerCase()))
            .sort((a, b) => b.total_sold - a.total_sold);
        matchedService = srvVols[0] || null;
    } else if (category && category !== 'margine') {
        matchedService = marginInsights.find(m => m.item_name.toLowerCase().includes(category.toLowerCase())) || null;
    }

    let serviceName = '';
    let currentPrice = 0;
    let historicalSold = 0;
    let historicalMargin = 0;

    if (matchedService) {
        serviceName = matchedService.item_name;
        historicalSold = matchedService.total_sold || 1;
        historicalMargin = matchedService.total_margin || 0;
        currentPrice = historicalSold > 0 ? (matchedService.total_revenue / historicalSold) : 35;
    } else if (services.length > 0) {
        const first = services[0];
        serviceName = first.name;
        const pInfo = await window.universalQuery({ action: 'GET_CURRENT_PRICE', id: first.id });
        currentPrice = pInfo ? (parseFloat(pInfo.price) || 35) : 35;
        historicalSold = 30;
        historicalMargin = currentPrice * 30 * 0.7;
    } else {
        return { error: "Nessun servizio disponibile nel listino per la simulazione." };
    }

    const incVal = parseFloat(value) || 5;
    const isEuro = (unit === 'euro');
    const unitGain = isEuro ? incVal : (currentPrice * (incVal / 100));
    const newPrice = currentPrice + unitGain;
    const pctIncrease = (unitGain / currentPrice) * 100;

    const monthlyVolBase = Math.max(Math.round(historicalSold / 3), 1);
    const retentionRate = Math.max(1 - ((pctIncrease / 100) * 0.25), 0.90);
    const simulatedMonthlyVol = Math.round(monthlyVolBase * retentionRate);

    const netMonthlyGain = (simulatedMonthlyVol * newPrice) - (monthlyVolBase * currentPrice);
    const netYearlyGain = netMonthlyGain * 12;

    return {
        service_name: serviceName,
        current_price: currentPrice,
        new_price: newPrice,
        unit_gain_euro: unitGain,
        pct_increase: pctIncrease,
        historical_volume: historicalSold,
        monthly_volume_estimated: simulatedMonthlyVol,
        net_monthly_gain: netMonthlyGain,
        net_yearly_gain: netYearlyGain,
        retention_rate_pct: Math.round(retentionRate * 100)
    };
}
window.tool_simulate_what_if = tool_simulate_what_if;

/**
 * TOOL 4: Simulazione e Proposta di Scrittura con Gating HITL
 * Normalizza automaticamente date colloquiali, durata, orario di fine, operatore e prezzi
 */
async function tool_propose_write(rawParams = {}) {
    const params = rawParams || {};
    const action = params.action || 'INSERT';
    const table = params.table || 'appointments';
    let data = params.data || {};
    const id = params.id || null;

    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id) ? currentUser.salon_id : 'SALON_001';

    let warnings = [];
    let summaryText = "";

    // NORMALIZZAZIONE APPROFONDITA PER GLI APPUNTAMENTI
    if (table === 'appointments') {
        const rawCust = data.cust_name || data.customer || data.customerName || window._aiAgentContext.lastCustomer || 'Cliente';
        const rawDate = data.date || data.data || 'oggi';
        const rawTime = data.time || data.ora || data.orario || '09:00';
        const rawService = data.service || data.servizio || 'Trattamento';
        const rawOperator = data.assigned_user || data.operator || (currentUser ? currentUser.username : 'admin');

        const resolvedDate = resolveNaturalDate(rawDate);
        const resolvedTime = resolveNaturalTime(rawTime);

        // Risoluzione intelligente del servizio in magazzino (es. "piedi" -> "Pedicure")
        const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
        const cleanSrvQuery = String(rawService).toLowerCase().trim();
        
        let matchedService = inventory.find(i => i.type === 'servizio' && (
            i.name.toLowerCase() === cleanSrvQuery ||
            i.name.toLowerCase().includes(cleanSrvQuery) ||
            cleanSrvQuery.includes(i.name.toLowerCase())
        ));

        // Se cerca parole generiche legate all'estetica (es. "piedi", "mani", "unghie")
        if (!matchedService && cleanSrvQuery.includes('pied')) {
            matchedService = inventory.find(i => i.type === 'servizio' && (i.name.toLowerCase().includes('pedicure') || i.name.toLowerCase().includes('pied')));
        } else if (!matchedService && (cleanSrvQuery.includes('man') || cleanSrvQuery.includes('ungh'))) {
            matchedService = inventory.find(i => i.type === 'servizio' && (i.name.toLowerCase().includes('manicure') || i.name.toLowerCase().includes('semipermanente')));
        }

        const serviceFinalName = matchedService ? matchedService.name : rawService;
        const durationMin = matchedService && matchedService.duration_minutes ? parseInt(matchedService.duration_minutes, 10) : 60;

        // Calcolo orario di fine
        const [sH, sM] = resolvedTime.split(':').map(Number);
        const endTotal = (sH * 60 + sM) + durationMin;
        const resolvedEndTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;

        // Calcolo prezzo reale da listino
        let finalPrice = 0;
        if (matchedService) {
            const pInfo = await window.universalQuery({ action: 'GET_CURRENT_PRICE', id: matchedService.id });
            finalPrice = pInfo ? (parseFloat(pInfo.price) || 0) : (parseFloat(matchedService.price) || 0);
        } else if (data.price) {
            finalPrice = parseFloat(data.price) || 0;
        }

        // Verifica orari e turni dell'operatore
        const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
        const dateObj = new Date(resolvedDate + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();
        const sched = schedules.find(s => (s.username || '').toLowerCase() === rawOperator.toLowerCase() && Number(s.day_of_week) === dayOfWeek);

        if (!sched || Number(sched.is_working) !== 1) {
            warnings.push(`⚠️ L'operatore <b>${rawOperator}</b> risulta a riposo in data ${resolvedDate}.`);
        }

        // Verifica sovrapposizioni
        const existingApps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const conflict = existingApps.find(a => {
            if (id && a.id === id) return false;
            if (a.date !== resolvedDate) return false;
            if ((a.assigned_user || 'admin').toLowerCase() !== rawOperator.toLowerCase()) return false;
            const aStart = (a.time || '00:00').substring(0, 5);
            const aEnd = a.end_time ? a.end_time.substring(0, 5) : '23:59';
            return resolvedTime < aEnd && resolvedEndTime > aStart;
        });

        if (conflict) {
            warnings.push(`⚠️ Conflitto d'orario: <b>${rawOperator}</b> ha già un impegno con <b>${conflict.cust_name}</b> (${conflict.time} - ${conflict.end_time || ''}).`);
        }

        data = {
            cust_name: rawCust,
            date: resolvedDate,
            time: resolvedTime,
            end_time: resolvedEndTime,
            service: serviceFinalName,
            price: finalPrice,
            assigned_user: rawOperator,
            notes: data.notes || "Creato tramite Assistente IA (HITL Confermato)"
        };

        summaryText = `Creazione appuntamento per **${data.cust_name}** il **${data.date}** alle **${data.time} - ${data.end_time}** (*${data.service}*, Op: ${data.assigned_user}, Prezzo: € ${data.price.toFixed(2)})`;
    } 
    else if (table === 'expenses') {
        const amt = parseFloat(data.amount || data.importo) || 0;
        const desc = data.description || data.descrizione || 'Spesa gestionale';
        const expDate = resolveNaturalDate(data.date);

        data = {
            date: expDate,
            description: desc,
            amount: amt
        };
        summaryText = `Registrazione spesa "${desc}" di € ${amt.toFixed(2)} in data ${expDate}`;
    } else {
        summaryText = `${action} sulla tabella ${table}`;
    }

    const payload = {
        id: id || crypto.randomUUID(),
        salon_id: salonId,
        ...data
    };

    window._aiAgentContext.pendingAction = {
        action: action,
        table: table,
        payload: payload,
        id: id,
        summary: summaryText
    };

    return {
        simulation_status: "ARMED_FOR_CONFIRMATION",
        warnings: warnings,
        summary: summaryText,
        payload_details: payload
    };
}
window.tool_propose_write = tool_propose_write;

// -------------------------------------------------------------------------
// 8. DISPATCHER DEI TOOL
// -------------------------------------------------------------------------
async function executeAgentToolCall(toolCall) {
    const { tool, params } = toolCall;
    console.log(`⚡ [AGENT REASONING] Esecuzione Tool: ${tool}`, params);

    try {
        if (tool === 'query_db') return await tool_query_db(params);
        if (tool === 'get_analytics') return await tool_get_analytics(params);
        if (tool === 'simulate_what_if') return await tool_simulate_what_if(params);
        if (tool === 'propose_write') return await tool_propose_write(params);
    } catch (err) {
        console.error(`Errore tool ${tool}:`, err);
        return { error: err.message };
    }

    return { error: `Tool ${tool} non riconosciuto.` };
}
window.executeAgentToolCall = executeAgentToolCall;

// -------------------------------------------------------------------------
// 9. HELPER DI STAMPA MESSAGGI SUL DOM DELLA CHAT E DEL DRAWER
// -------------------------------------------------------------------------
function appendAgentMessage(content, isUser = false) {
    const chatBox = document.getElementById('ai-chat-messages');
    const drawerBox = document.getElementById('ai-drawer-messages');

    const formattedContent = String(content).replace(/\n/g, '<br>');

    const userHtml = `
        <div style="background: #ede9fe; color: #4338ca; padding: 12px 16px; border-radius: 12px; align-self: flex-end; max-width: 85%; font-size: 13px; line-height: 1.4; font-weight: 600; margin-top: 6px;">
            ${formattedContent}
        </div>
    `;

    const botHtml = `
        <div style="background: white; padding: 14px 16px; border-radius: 12px; border: 1px solid #e2e8f0; align-self: flex-start; max-width: 88%; font-size: 13px; line-height: 1.5; color: #1e1b4b; display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
            <div>🤖 ${formattedContent}</div>
            <button type="button" class="btn" style="align-self: flex-start; padding: 2px 6px; font-size: 10px; background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd; border-radius: 4px; cursor: pointer; min-height: unset;" onclick="window.speakAiResponse(this.previousElementSibling.innerText)">
                🔊 Ascolta
            </button>
        </div>
    `;

    const htmlToInsert = isUser ? userHtml : botHtml;

    if (chatBox) {
        chatBox.innerHTML += htmlToInsert;
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    if (drawerBox) {
        drawerBox.innerHTML += htmlToInsert;
        drawerBox.scrollTop = drawerBox.scrollHeight;
    }
}
window.appendAgentMessage = appendAgentMessage;

// -------------------------------------------------------------------------
// 10. CONTROLLER DIALOGICO MULTI-TURN AUTONOMO (REACT LOOP)
// -------------------------------------------------------------------------
async function processAiAgentQuery(userQuery) {
    const rawQuery = (userQuery || '').trim();
    const q = rawQuery.toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const daysItalian = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
    const dayOfWeek = daysItalian[now.getDay()];

    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id) ? currentUser.salon_id : 'SALON_001';

    // 1. Controllo Human-In-The-Loop per conferme testuali ("Sì", "Conferma")
    if (window._aiAgentContext.pendingAction) {
        const isYes = q === 'sì' || q === 'si' || q.includes('conferma') || q.includes('procedi') || q.includes('esegui') || q.includes('ok');
        const isNo = q === 'no' || q.includes('annulla') || q.includes('cancella') || q.includes('lascia stare');

        if (isYes) return await confirmAiPendingAction();
        if (isNo) return cancelAiPendingAction();

        return `⚠️ C'è un'operazione in attesa di conferma:\n*${window._aiAgentContext.pendingAction.summary}*\n\nRispondi **"Conferma"** per procedere oppure **"Annulla"**.`;
    }

    // 2. Intercettazione diretta delle domande procedurali
    const directGuide = (typeof window.getDeterministicAppGuide === 'function')
        ? window.getDeterministicAppGuide(q)
        : getDeterministicAppGuide(q);

    if (directGuide) {
        return directGuide;
    }

    // 3. Prompt di Sistema per l'Agente
    const systemPrompt = `Sei l'Agente Intelligente e Copilota Gestionale di "VaiMUp", utilizzato dallo STAFF E DAL TITOLARE del salone.
NON SEI un call center per clienti esterni: parli con il gestore del negozio. NON rivolgerti all'utente chiamandolo "Gentile cliente".
Oggi è ${dayOfWeek}, ${todayStr} (Orario attuale: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}).
Salone ID attivo: "${salonId}".
Memoria attiva: UltimoCliente="${window._aiAgentContext.lastCustomer || 'Nessuno'}".

HAI A DISPOSIZIONE QUESTI TOOL OPERATIVI:
1. "query_db": cerca nel database.
   Parametri: table ("appointments"|"customers"|"inventory"|"sales"|"expenses"), customer (nome cliente), date (YYYY-MM-DD), timeline ("future"|"past"|"all"), month ("last_month"|"this_month"|"YYYY-MM"), date_from, date_to.
2. "get_analytics": calcola margini reali, volumi e spese fisse.
3. "simulate_what_if": simula scenari (target="highest_margin"|"highest_volume"|"specific_service", value=5, unit="euro"|"percent").
4. "propose_write": prepara inserimenti/spostamenti con conferma HITL.
   Parametri: action ("INSERT"|"UPDATE"|"DELETE"), table ("appointments"|"expenses"|"customers"), data: { cust_name, date, time, service, assigned_user, price, amount, description }

MANUALE DIRETTO FUNZIONALITÀ APP:
${VAIMUP_APP_MANUAL}

ISTRUZIONI DI RAGIONAMENTO:
- Se l'utente ti chiede "COME FARE" qualcosa (es: come fare uno storno, come caricare merce, come funziona il coworking), rispondi direttamente usando il manuale SENZA chiamare tool.
- Se l'utente vuole CREARE, FISSARE, SPOSTARE o CANCELLARE un appuntamento, chiama SUBITO "propose_write" passando i campi necessari in data (cust_name, date, time, service).
- Se l'utente chiede appuntamenti di una persona, chiama "query_db" impostando customer e timeline ("future"|"past"|"all").
- Se l'utente chiede "che succede se aumento di 5 euro il servizio a più alta marginalità?", chiama "simulate_what_if" con target="highest_margin", value=5, unit="euro".

FORMATO RISPOSTA (SOLO JSON):
Per usare un tool:
{
  "thought": "Cosa devo fare",
  "tool": "query_db" | "get_analytics" | "simulate_what_if" | "propose_write",
  "params": { ...parametri... }
}

Per risposta diretta:
{
  "thought": "Risposta diretta",
  "answer": "Testo risposta in italiano professionale rivolto al gestore del salone..."
}`;

    // 4. FASE 1: RAGIONAMENTO E TOOL SELECTION
    let firstTurnRaw = "";
    try {
        firstTurnRaw = await callAgentBrain([
            { role: "system", content: systemPrompt },
            { role: "user", content: rawQuery }
        ]);
    } catch (err) {
        if (err.message === "API_KEY_MISSING") {
            return "🤖 Il servizio di intelligenza artificiale non è attivo sul database. Contatta l'amministratore per la configurazione.";
        }
        return `⚠️ Errore di comunicazione con il motore IA: ${err.message}`;
    }

    const firstDecision = sanitizeJson(firstTurnRaw);

    if (firstDecision && firstDecision.answer) {
        return firstDecision.answer;
    }

    // 5. FASE 2: ESECUZIONE TOOL E SINTESI DATI
    if (firstDecision && firstDecision.tool) {
        if (!firstDecision.params) firstDecision.params = {};

        // Pronomi o contesto sul cliente precedente
        if (!firstDecision.params.customer && !firstDecision.params.search && window._aiAgentContext.lastCustomer) {
            if (q.includes('suoi') || q.includes('completat') || q.includes('passat') || q.includes('lui') || q.includes('lei') || q.includes('tutti')) {
                firstDecision.params.customer = window._aiAgentContext.lastCustomer;
            }
        }

        const toolResult = await executeAgentToolCall(firstDecision);

        // Se è una proposta di scrittura con conferma HITL
        if (firstDecision.tool === 'propose_write') {
            const sim = toolResult;
            const details = sim.payload_details || {};
            let warnText = (sim.warnings && sim.warnings.length > 0) ? `<br><br>${sim.warnings.join('<br>')}` : '';

            return `📋 **Proposta Operativa (In attesa di tua conferma):**\n\n` +
                `• **Operazione:** ${sim.summary || 'Salvataggio dati'}\n` +
                (details.cust_name ? `• **Cliente:** ${details.cust_name}\n` : '') +
                (details.date ? `• **Data:** ${details.date}\n` : '') +
                (details.time ? `• **Orario:** ${details.time} - ${details.end_time || ''}\n` : '') +
                (details.service ? `• **Servizio:** ${details.service} (Prezzo: € ${parseFloat(details.price || 0).toFixed(2)})\n` : '') +
                (details.assigned_user ? `• **Operatore:** ${details.assigned_user}\n` : '') +
                warnText +
                `\n❓ Vuoi procedere con il salvataggio? Rispondi **"Conferma"** oppure tocca il pulsante:\n` +
                `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:10px;">` +
                `<button type="button" class="btn btn-s" style="padding:8px 16px; font-size:12px; font-weight:800; cursor:pointer;" onclick="window.confirmAiPendingAction(this)">✓ Conferma ed Esegui</button>` +
                `<button type="button" class="btn btn-d" style="padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer;" onclick="window.cancelAiPendingAction(this)">✕ Annulla</button>` +
                `</div>`;
        }

        // Sintesi finale con i dati estratti per le letture (READ)
        const synthesisPrompt = `Hai interrogato il database locale con il tool "${firstDecision.tool}".
Risultati reali estratti dal database:
${JSON.stringify(toolResult, null, 2)}

Richiesta dell'utente (staff del salone): "${rawQuery}"
Cliente di riferimento in memoria: "${window._aiAgentContext.lastCustomer || 'Nessuno'}"

ISTRUZIONI PER LA RISPOSTA FINALE:
- Ti stai rivolgendo al TITOLARE o allo STAFF del salone (NON al cliente finale!). Usa un tono da copilota aziendale.
- Se cercavi appuntamenti futuri e non ce ne sono (future_appointments_count = 0), ma ci sono appuntamenti passati (past_appointments_count > 0), fallo presente con precisione indicando la data dell'ultimo completato!
- Se chiedeva appuntamenti passati, elenca con chiarezza quelli trovati (data, orario, trattamento, operatore).
- Se chiedeva gli appuntamenti del mese scorso, elenca quelli trovati per quel periodo.
- Se è una simulazione What-If, spiega con precisione il servizio identificato, l'aumento proposto e il guadagno stimato.
- Non inventare mai dati non presenti nei risultati.`;

        try {
            const finalReply = await callAgentBrain([
                { role: "system", content: "Sei il copilota gestionale di VaiMUp per il titolare del salone." },
                { role: "user", content: synthesisPrompt }
            ]);

            const parsedFinal = sanitizeJson(finalReply);
            const textToReturn = (parsedFinal && (parsedFinal.answer || parsedFinal.message)) ? (parsedFinal.answer || parsedFinal.message) : finalReply;

            const detectedCust = firstDecision.params?.customer || firstDecision.params?.search;
            if (detectedCust && detectedCust !== 'all') {
                window._aiAgentContext.lastCustomer = detectedCust;
            }

            return textToReturn;

        } catch (synthErr) {
            console.error("Errore sintesi finale agente:", synthErr);
            return `📊 Risultati estratti (${toolResult.total_found || toolResult.total_real_client_appointments || 0} record trovati). Controlla la tabella corrispondente.`;
        }
    }

    return firstTurnRaw || "🤖 Ho elaborato la richiesta. Come posso esserti utile?";
}
window.processAiAgentQuery = processAiAgentQuery;

// -------------------------------------------------------------------------
// 11. ESECUZIONE FASE 2: GESTIONE CLICK E CONFERMA HUMAN-IN-THE-LOOP
// -------------------------------------------------------------------------
async function confirmAiPendingAction(btnElement = null) {
    const pending = window._aiAgentContext.pendingAction;
    if (!pending) {
        const msg = "⚠️ Nessuna operazione in attesa di conferma.";
        if (btnElement) appendAgentMessage(msg, false);
        return msg;
    }

    // Se cliccato da bottone, disabilita subito l'interfaccia
    if (btnElement) {
        const container = btnElement.closest('.ai-hitl-actions');
        if (container) {
            container.innerHTML = '<span style="font-size:11px; font-weight:800; color:#047857; background:#dcfce7; padding:4px 8px; border-radius:6px;">✓ Azione confermata</span>';
        }
    }

    window._aiAgentContext.pendingAction = null;

    try {
        const { action, table, payload, id } = pending;

        if (action === 'INSERT') {
            await window.universalQuery({ action: 'INSERT', table: table, data: payload });
        } else if (action === 'UPDATE') {
            await window.universalQuery({ action: 'UPDATE', table: table, data: payload, id: id });
        } else if (action === 'DELETE') {
            await window.universalQuery({ action: 'DELETE', table: table, id: id });
        }

        // Aggiorna istantaneamente l'interfaccia utente (agenda, dashboard)
        if (typeof refreshAllData === 'function') await refreshAllData();
        if (typeof renderCalendar === 'function') renderCalendar();
        if (typeof loadBalance === 'function') loadBalance();

        const successText = `✅ **Operazione completata con successo!**\n${pending.summary} registrato nel database.`;

        // Se invocato direttamente dal click sul pulsante HTML, stampa subito il messaggio nella chat
        if (btnElement) {
            appendAgentMessage(successText, false);
            speakAiResponse(successText);
        }

        return successText;

    } catch (err) {
        const errorText = `❌ Errore durante il salvataggio: ${err.message}`;
        if (btnElement) appendAgentMessage(errorText, false);
        return errorText;
    }
}
window.confirmAiPendingAction = confirmAiPendingAction;

function cancelAiPendingAction(btnElement = null) {
    window._aiAgentContext.pendingAction = null;

    if (btnElement) {
        const container = btnElement.closest('.ai-hitl-actions');
        if (container) {
            container.innerHTML = '<span style="font-size:11px; font-weight:800; color:#dc2626; background:#fee2e2; padding:4px 8px; border-radius:6px;">✕ Operazione annullata</span>';
        }
    }

    const cancelText = "❌ **Operazione revocata.** Nessuna modifica è stata effettuata al database.";
    if (btnElement) {
        appendAgentMessage(cancelText, false);
        speakAiResponse(cancelText);
    }
    return cancelText;
}
window.cancelAiPendingAction = cancelAiPendingAction;

// -------------------------------------------------------------------------
// 12. SPEECH SYNTHESIS & PUSH-TO-TALK
// -------------------------------------------------------------------------
function speakAiResponse(text) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();

    let clean = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_~`#]/g, ' ')
        .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length > 280) {
        const cut = clean.substring(0, 280).lastIndexOf('.');
        clean = cut > 60 ? clean.substring(0, cut + 1) : clean.substring(0, 280) + "...";
    }

    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'it-IT';
    u.rate = 0.98;

    const voices = window.speechSynthesis.getVoices();
    const it = voices.find(v => v.lang === 'it-IT' && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Cosimo')));
    if (it) u.voice = it;

    window.speechSynthesis.speak(u);
}
window.speakAiResponse = speakAiResponse;

function sendQuickAiPrompt(text) {
    const input = document.getElementById('ai-user-input');
    if (input) {
        input.value = text;
        if (typeof sendAIQuery === 'function') sendAIQuery();
    }
}
window.sendQuickAiPrompt = sendQuickAiPrompt;

function sendQuickAiPromptDrawer(text) {
    const input = document.getElementById('ai-drawer-input');
    if (input) {
        input.value = text;
        if (typeof sendAIDrawerQuery === 'function') sendAIDrawerQuery();
    }
}
window.sendQuickAiPromptDrawer = sendQuickAiPromptDrawer;

let pttSpeechRecognizer = null;
let isPttListening = false;

function togglePushToTalkVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        return alert("Il tuo browser non supporta il riconoscimento vocale nativo. Consigliamo l'uso di Google Chrome o Microsoft Edge.");
    }

    const micBtn = document.getElementById('ai-mic-btn');

    if (isPttListening) {
        if (pttSpeechRecognizer) {
            try { pttSpeechRecognizer.stop(); } catch (e) {}
        }
        if (micBtn) {
            micBtn.style.background = '#f1f5f9';
            micBtn.style.color = '#475569';
            micBtn.innerText = '🎙️';
        }
        isPttListening = false;
        return;
    }

    try {
        pttSpeechRecognizer = new SpeechRecognition();
        pttSpeechRecognizer.lang = 'it-IT';
        pttSpeechRecognizer.interimResults = false;
        pttSpeechRecognizer.maxAlternatives = 1;

        pttSpeechRecognizer.onstart = () => {
            isPttListening = true;
            if (micBtn) {
                micBtn.style.background = '#fee2e2';
                micBtn.style.color = '#dc2626';
                micBtn.innerText = '🔴 In ascolto...';
            }
        };

        pttSpeechRecognizer.onresult = (event) => {
            const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
            if (micBtn) {
                micBtn.style.background = '#f1f5f9';
                micBtn.style.color = '#475569';
                micBtn.innerText = '🎙️';
            }
            isPttListening = false;

            if (transcript.length > 1) {
                const inputField = document.getElementById('ai-user-input');
                const drawerInput = document.getElementById('ai-drawer-input');
                if (inputField) inputField.value = transcript;
                if (drawerInput) drawerInput.value = transcript;

                if (typeof sendAIQuery === 'function') sendAIQuery();
            }
        };

        pttSpeechRecognizer.onerror = () => {
            if (micBtn) {
                micBtn.style.background = '#f1f5f9';
                micBtn.style.color = '#475569';
                micBtn.innerText = '🎙️';
            }
            isPttListening = false;
        };

        pttSpeechRecognizer.onend = () => {
            if (micBtn) {
                micBtn.style.background = '#f1f5f9';
                micBtn.style.color = '#475569';
                micBtn.innerText = '🎙️';
            }
            isPttListening = false;
        };

        pttSpeechRecognizer.start();

    } catch (err) {
        console.error("Errore avvio Push-To-Talk:", err);
    }
}
window.togglePushToTalkVoice = togglePushToTalkVoice;