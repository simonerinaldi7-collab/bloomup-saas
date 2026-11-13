// =========================================================================
// 🤖 VAIMUP AUTONOMOUS AGENT - CONVERSATIONAL CHAT-HISTORY ENGINE
// Architettura Multi-Turn con Memoria Contestuale e Zero Hardcoding
// =========================================================================

// Inizializzazione sicura dello stato globale di memoria su window
if (!window._aiChatHistory) {
    window._aiChatHistory = [];
}

if (!window._aiAgentContext) {
    window._aiAgentContext = {
        lastCustomer: null,
        lastCustomerId: null,
        lastProduct: null,
        lastDate: null,
        lastAppointmentId: null,
        lastAppointment: null,
        pendingAction: null
    };
}

// -------------------------------------------------------------------------
// 1. KNOWLEDGE BASE OPERATIVA REGISTRATA SU WINDOW
// -------------------------------------------------------------------------
window.VAIMUP_APP_MANUAL = `
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
   - Da "🏢 Spazi & Coworking" con blocco atomico anti-overbooking. Gli altri saloni vedono la postazione occupata senza poter leggere i dati anagrafici del cliente finale (privacy GDPR).
5. STAMPA LISTINI:
   - Da "🖨️ Stampa & Listini", formati A4, A5, A3 e Poster 50x70.
6. BOOKING ONLINE (SELF-BOOKING):
   - I clienti prenotano 24/7 dal link o QR code senza installare app.
`;

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

    return null;
}
window.getDeterministicAppGuide = getDeterministicAppGuide;

// -------------------------------------------------------------------------
// 2. HELPER DI PARSING E RISOLUZIONE DETERMINISTICA (SUBITO DISPONIBILI)
// -------------------------------------------------------------------------
function parseDurationMinutesFromText(text) {
    if (!text) return null;
    const q = String(text).toLowerCase();

    if (q.includes("un'ora e mezza") || q.includes("1 ora e mezza") || q.includes("90 minuti") || q.includes("90 min") || q.includes("un ora e mezza")) {
        return 90;
    }
    if (q.includes("mezz'ora") || q.includes("mezza ora") || q.includes("30 minuti") || q.includes("30 min")) {
        return 30;
    }
    if (q.includes("due ore") || q.includes("2 ore") || q.includes("120 minuti") || q.includes("120 min")) {
        return 120;
    }
    if (q.includes("due ore e mezza") || q.includes("150 minuti")) {
        return 150;
    }
    if (q.includes("un'ora") || q.includes("1 ora") || q.includes("60 minuti") || q.includes("60 min") || q.includes("un ora")) {
        return 60;
    }
    const match = q.match(/(\d+)\s*(?:minut|min|ora|ore)/i);
    if (match) {
        const val = parseInt(match[1], 10);
        if (q.includes('ora') || q.includes('ore')) return val * 60;
        return val;
    }
    return null;
}
window.parseDurationMinutesFromText = parseDurationMinutesFromText;

function getMondayOfDate(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}
window.getMondayOfDate = getMondayOfDate;

function resolveNaturalDate(dateInput) {
    if (!dateInput) return new Date().toISOString().split('T')[0];
    const clean = String(dateInput).toLowerCase().trim();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // 🛑 "DOPODOMANI" HA PRECEDENZA ASSOLUTA SU "DOMANI"!
    if (clean.includes('dopodomani') || clean.includes('dopo domani')) {
        const d = new Date(now);
        d.setDate(d.getDate() + 2);
        return toYmd(d);
    }
    if (clean.includes('domani')) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return toYmd(d);
    }
    if (clean.includes('oggi') || clean.includes('stasera')) {
        return toYmd(now);
    }
    // Riconoscimento "del 14", "il 14", "del 12" riferito al mese corrente
    const singleDayMatch = clean.match(/(?:del|il|al)\s*(\d{1,2})(?!\d)/i);
    if (singleDayMatch) {
        const day = parseInt(singleDayMatch[1], 10);
        if (day >= 1 && day <= 31) {
            return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;
        }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
        return clean;
    }
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
window.resolveNaturalDate = resolveNaturalDate;

function resolveNaturalTime(timeInput) {
    if (!timeInput) return "09:00";
    let clean = String(timeInput).toLowerCase().trim();
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
window.resolveNaturalTime = resolveNaturalTime;

// -------------------------------------------------------------------------
// 3. RECUPERO CHIAVE IA DA SUPABASE (SILENZIOSO, ZERO INTERFACCIA)
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
// 4. SANITIZZATORE E CHIAMATA LLM CON MEMORIA MULTI-TURN
// -------------------------------------------------------------------------
function getCleanChatHistory() {
    if (!window._aiChatHistory || !Array.isArray(window._aiChatHistory)) {
        window._aiChatHistory = [];
    }

    const clean = [];
    for (let msg of window._aiChatHistory) {
        if (!msg || !msg.content || typeof msg.content !== 'string') continue;
        const text = msg.content.trim();
        if (!text) continue;
        const role = msg.role === 'assistant' ? 'assistant' : 'user';

        if (clean.length > 0 && clean[clean.length - 1].role === role) {
            clean[clean.length - 1].content += "\n\n" + text;
        } else {
            clean.push({ role, content: text });
        }
    }

    if (clean.length > 8) {
        window._aiChatHistory = clean.slice(-8);
    } else {
        window._aiChatHistory = clean;
    }
    return window._aiChatHistory;
}

async function callConversationalLLM(systemPrompt, userQuery) {
    const apiKey = await getOrLoadAiApiKey();
    if (!apiKey || apiKey.includes("INSERISCI")) {
        throw new Error("API_KEY_MISSING");
    }

    const history = getCleanChatHistory();

    const messagesPayload = [
        { role: "system", content: systemPrompt }
    ];

    for (let h of history) {
        messagesPayload.push({ role: h.role, content: h.content });
    }

    if (userQuery && userQuery.trim()) {
        const lastMsg = messagesPayload[messagesPayload.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
            lastMsg.content += "\n\n" + userQuery.trim();
        } else {
            messagesPayload.push({ role: "user", content: userQuery.trim() });
        }
    }

    const isGoogleKey = apiKey.startsWith("AIza");

    if (isGoogleKey) {
        const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        for (const m of models) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: messagesPayload.map(msg => ({
                            role: msg.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: (msg.role === 'system' ? `[ISTRUZIONI DI SISTEMA]: ${msg.content}\n\n` : '') + msg.content }]
                        })),
                        generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                }
            } catch (e) {}
        }
        throw new Error("Tutti i modelli Google Gemini hanno risposto con errore.");
    }

    // Provider OpenRouter: Modello Llama 3.3 70B verificato ed economico
    const candidateModels = [
        "meta-llama/llama-3.3-70b-instruct",
        "openrouter/auto"
    ];

    for (const modelId of candidateModels) {
        try {
            const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'VaiMUp AI Agent'
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: messagesPayload,
                    temperature: 0.1,
                    max_tokens: 1000
                })
            });

            if (res.ok) {
                const data = await res.json();
                return data.choices?.[0]?.message?.content || "";
            } else {
                const errText = await res.text();
                console.warn(`[OpenRouter Warning] Modello ${modelId} status ${res.status}:`, errText);
            }
        } catch (e) {}
    }

    throw new Error("Errore durante la chiamata ai provider IA.");
}
window.callConversationalLLM = callConversationalLLM;

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
// 5. REGISTRY DEI TOOL UNIVERSALI SUL DATABASE
// -------------------------------------------------------------------------

/**
 * TOOL 1: Ricerca Universale sul Database Locale (Dexie)
 */
async function tool_query_db(rawParams = {}) {
    const params = rawParams || {};
    const table = params.table || 'appointments';

    const searchTarget = params.customer || params.customerName || params.cust_name || params.client || params.search || params.query || '';
    const timeline = params.timeline || (params.past ? 'past' : (params.future ? 'future' : 'all'));
    const specificDate = params.date ? resolveNaturalDate(params.date) : '';
    let dateFrom = params.date_from || params.startDate || '';
    let dateTo = params.date_to || params.endDate || '';
    const period = params.period || '';

    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const now = new Date();
    const todayStr = toYmd(now);
    const nowTimeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    if (period === 'this_week' || period === 'week' || period === 'settimana') {
        const mon = getMondayOfDate(now);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        dateFrom = toYmd(mon);
        dateTo = toYmd(sun);
    } else if (period === 'next_week') {
        const mon = getMondayOfDate(now);
        mon.setDate(mon.getDate() + 7);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        dateFrom = toYmd(mon);
        dateTo = toYmd(sun);
    } else if (period === 'today' || period === 'oggi') {
        dateFrom = todayStr;
        dateTo = todayStr;
    } else if (period === 'tomorrow' || period === 'domani') {
        const tom = new Date(now);
        tom.setDate(now.getDate() + 1);
        dateFrom = toYmd(tom);
        dateTo = toYmd(tom);
    } else if (period === 'this_month') {
        dateFrom = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        dateTo = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`;
    } else if (period === 'last_month') {
        const prevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        dateFrom = `${prevM.getFullYear()}-${pad(prevM.getMonth() + 1)}-01`;
        dateTo = `${prevM.getFullYear()}-${pad(prevM.getMonth() + 1)}-${pad(lastDay)}`;
    }

    const records = await window.universalQuery({ action: 'GET_ALL', table: table }) || [];
    const customers = (table !== 'customers') ? (await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || []) : [];

    let results = records;

    // 🛑 FILTRO AGENDA: ESCLUDE TASSATIVAMENTE LE PAUSE E LE FERIE
    if (table === 'appointments') {
        results = results.filter(a => {
            const cust = (a.cust_name || '').toLowerCase();
            const srv = (a.service || '').toLowerCase();
            const isPausa = cust.includes('pausa') || cust.includes('pranzo') || srv.includes('pausa') || srv.includes('pranzo');
            const isChiusura = cust.includes('chiusura') || cust.includes('ferie') || srv.includes('chiusura') || srv.includes('ferie');
            return !isPausa && !isChiusura;
        });
    }

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
        results.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        const past = results.filter(a => a.date < todayStr || (a.date === todayStr && (a.time || '') < nowTimeStr))
            .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

        const future = results.filter(a => a.date > todayStr || (a.date === todayStr && (a.time || '') >= nowTimeStr))
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        return {
            query_table: "appointments",
            customer_searched: searchTarget,
            filter_date_range: (dateFrom && dateTo) ? `${dateFrom} -> ${dateTo}` : (specificDate || "Nessun vincolo data"),
            total_real_client_appointments: results.length,
            appointments_list: results.map(a => ({
                id: a.id,
                cliente: a.cust_name,
                data: a.date,
                orario: `${a.time ? a.time.substring(0,5) : ''} - ${a.end_time ? a.end_time.substring(0,5) : ''}`,
                servizio: a.service,
                operatore: a.assigned_user,
                prezzo: a.price
            })),
            future_appointments_count: future.length,
            future_appointments: future.slice(0, 10),
            past_appointments_count: past.length,
            past_appointments: past.slice(0, 10)
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
 * CONVALIDA DEI VINCOLI DI ORARIO, FASCE DI TURNO E CONFLITTI STAFF
 */
async function validateAppointmentStaffConstraints(dateStr, startTimeStr, endTimeStr, operatorName, excludeAppId = null) {
    const warnings = [];
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = dateObj.getDay();

    const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
    const sched = schedules.find(s => (s.username || '').toLowerCase() === operatorName.toLowerCase() && Number(s.day_of_week) === dayOfWeek);

    if (!sched || Number(sched.is_working) !== 1) {
        warnings.push(`⚠️ L'operatore <b>${operatorName}</b> risulta a riposo in data ${dateStr}.`);
    } else {
        const shifts = [];
        if (sched.start_time_1 && sched.end_time_1) {
            shifts.push({ start: sched.start_time_1.substring(0, 5), end: sched.end_time_1.substring(0, 5) });
        }
        if (sched.start_time_2 && sched.end_time_2) {
            shifts.push({ start: sched.start_time_2.substring(0, 5), end: sched.end_time_2.substring(0, 5) });
        }

        if (shifts.length > 0) {
            const [sH, sM] = startTimeStr.split(':').map(Number);
            const [eH, eM] = endTimeStr.split(':').map(Number);
            const appStartMin = sH * 60 + sM;
            const appEndMin = eH * 60 + eM;

            let fitsInShift = false;
            for (let sh of shifts) {
                const [shStartH, shStartM] = sh.start.split(':').map(Number);
                const [shEndH, shEndM] = sh.end.split(':').map(Number);
                const shiftStartMin = shStartH * 60 + shStartM;
                const shiftEndMin = shEndH * 60 + shEndM;

                if (appStartMin >= shiftStartMin && appEndMin <= shiftEndMin) {
                    fitsInShift = true;
                    break;
                }
            }

            if (!fitsInShift) {
                const shiftDesc = shifts.map(sh => `${sh.start} - ${sh.end}`).join(' e ');
                warnings.push(`⚠️ Fuori turno: l'orario <b>${startTimeStr} - ${endTimeStr}</b> non rientra nelle fasce lavorative di ${operatorName} (${shiftDesc}).`);
            }
        }
    }

    const existingApps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
    const conflict = existingApps.find(a => {
        if (excludeAppId && String(a.id) === String(excludeAppId)) return false;
        if (a.date !== dateStr) return false;
        if ((a.assigned_user || 'admin').toLowerCase() !== operatorName.toLowerCase()) return false;
        const aStart = (a.time || '00:00').substring(0, 5);
        const aEnd = a.end_time ? a.end_time.substring(0, 5) : '23:59';
        return startTimeStr < aEnd && endTimeStr > aStart;
    });

    if (conflict) {
        warnings.push(`⚠️ Conflitto agenda: l'operatore <b>${operatorName}</b> ha già un appuntamento con <b>${conflict.cust_name}</b> (${conflict.time} - ${conflict.end_time || ''}).`);
    }

    return warnings;
}
window.validateAppointmentStaffConstraints = validateAppointmentStaffConstraints;

/**
 * TOOL 4: Proposta di Scrittura con Gating HITL, Preservazione Prezzo e Risoluzione Precisa dell'Appuntamento
 */
async function tool_propose_write(rawParams = {}, rawUserQuery = '') {
    const params = rawParams || {};
    let action = (params.action || 'INSERT').toUpperCase();
    const table = params.table || 'appointments';
    
    let data = params.data || {};
    if (params.cust_name && !data.cust_name) data.cust_name = params.cust_name;
    if (params.customer && !data.cust_name) data.cust_name = params.customer;
    if (params.date && !data.date) data.date = params.date;
    if (params.time && !data.time) data.time = params.time;
    if (params.service && !data.service) data.service = params.service;
    if (params.assigned_user && !data.assigned_user) data.assigned_user = params.assigned_user;

    let targetId = params.id || params.appointment_id || null;
    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id) ? currentUser.salon_id : 'SALON_001';
    const lastApp = window._aiAgentContext.lastAppointment;
    const q = (rawUserQuery || '').toLowerCase();

    const isDeleteIntent = (action === 'DELETE') || q.includes('elimina') || q.includes('cancella') || q.includes('rimuov') || q.includes('disdici');
    if (isDeleteIntent) {
        action = 'DELETE';
    }

    if (table === 'appointments') {
        const isModifyOrDelete = (action === 'UPDATE' || action === 'DELETE') || q.includes('spost') || q.includes('durata') || q.includes('modifica') || q.includes('cambia');

        if (isModifyOrDelete) {
            const appointmentsInDb = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
            let realApp = null;

            // Riconoscimento data specifica nella frase dell'utente (es. "del 14", "il 14", "14/11")
            let explicitTargetDate = null;
            const matchDay = q.match(/(?:del|il|al)\s*(\d{1,2})(?!\d)/i);
            if (matchDay) {
                explicitTargetDate = resolveNaturalDate(`il ${matchDay[1]}`);
            }

            if (targetId) {
                realApp = appointmentsInDb.find(a => String(a.id) === String(targetId));
            }

            // Se l'utente specifica "quello del 14", cerca l'appuntamento del cliente in quella data specifica!
            const queryCust = data.cust_name || window._aiAgentContext.lastCustomer;
            if (!realApp && queryCust) {
                const clientApps = appointmentsInDb.filter(a => (a.cust_name || '').toLowerCase().includes(queryCust.toLowerCase()));
                if (explicitTargetDate) {
                    realApp = clientApps.find(a => a.date === explicitTargetDate);
                }
                if (!realApp) {
                    realApp = clientApps.sort((a,b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
                }
            }

            if (!realApp && lastApp) {
                realApp = appointmentsInDb.find(a => String(a.id) === String(lastApp.id)) || lastApp;
            }

            if (realApp) {
                targetId = realApp.id;

                data.cust_name = data.cust_name || realApp.cust_name;
                data.service = data.service || realApp.service;
                data.assigned_user = data.assigned_user || realApp.assigned_user;
                data.notes = realApp.notes;

                // Preservazione del prezzo reale dell'appuntamento esistente
                if (realApp.price !== undefined && realApp.price !== null && parseFloat(realApp.price) > 0) {
                    data.price = parseFloat(realApp.price);
                }

                // Calcolo durata dell'appuntamento esistente
                let baseDurationMin = 60;
                if (realApp.time && realApp.end_time) {
                    const [sH_prev, sM_prev] = realApp.time.split(':').map(Number);
                    const [eH_prev, eM_prev] = realApp.end_time.split(':').map(Number);
                    const diff = (eH_prev * 60 + eM_prev) - (sH_prev * 60 + sM_prev);
                    if (diff > 0) baseDurationMin = diff;
                }

                if (action === 'DELETE') {
                    data.date = realApp.date;
                    data.time = realApp.time;
                    data.end_time = realApp.end_time;
                    data.calculated_duration = baseDurationMin;
                } else {
                    // Risoluzione Data per Modifiche
                    if (q.includes('dopodomani') || q.includes('dopo domani')) {
                        data.date = resolveNaturalDate('dopodomani');
                    } else if (q.includes('domani')) {
                        data.date = resolveNaturalDate('domani');
                    } else if (params.new_date) {
                        data.date = resolveNaturalDate(params.new_date);
                    } else if (params.date && !explicitTargetDate) {
                        data.date = resolveNaturalDate(params.date);
                    } else {
                        data.date = realApp.date;
                    }

                    // Risoluzione Orario: se non specificato un orario diverso, preserva l'orario esistente!
                    if (params.new_start_time || params.new_time) {
                        data.time = resolveNaturalTime(params.new_start_time || params.new_time);
                    } else if (q.includes('alle 17') || q.includes('ore 17') || q.includes('alle ore 17')) {
                        data.time = "17:00";
                    } else if (params.time && !q.includes('stesso orario')) {
                        data.time = resolveNaturalTime(params.time);
                    } else {
                        data.time = realApp.time;
                    }

                    // Risoluzione Durata
                    const extractedDuration = parseDurationMinutesFromText(q) || parseDurationMinutesFromText(params.duration);
                    const finalDuration = extractedDuration ? extractedDuration : baseDurationMin;

                    const [sH, sM] = data.time.split(':').map(Number);
                    const endTotal = (sH * 60 + sM) + finalDuration;
                    data.end_time = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
                    data.calculated_duration = finalDuration;
                }
            }
        }
    }

    let summaryText = "";

    if (table === 'appointments') {
        const rawCust = data.cust_name || (lastApp ? lastApp.cust_name : window._aiAgentContext.lastCustomer) || 'Cliente';
        const rawDate = resolveNaturalDate(data.date || (lastApp ? lastApp.date : 'oggi'));
        const rawTime = resolveNaturalTime(data.time || (lastApp ? lastApp.time : '09:00'));
        const rawService = data.service || (lastApp ? lastApp.service : 'Trattamento');
        const rawOperator = data.assigned_user || (lastApp ? lastApp.assigned_user : (currentUser ? currentUser.username : 'admin'));

        let durationMin = data.calculated_duration || 60;
        if (!data.calculated_duration && action !== 'DELETE') {
            const extractedDur = parseDurationMinutesFromText(q);
            if (extractedDur) durationMin = extractedDur;
        }

        const [sH, sM] = rawTime.split(':').map(Number);
        const endTotal = (sH * 60 + sM) + durationMin;
        const resolvedEndTime = data.end_time || `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;

        // Risoluzione Prezzo Reale
        let resolvedFinalPrice = 0;
        if (data.price !== undefined && data.price !== null && parseFloat(data.price) > 0) {
            resolvedFinalPrice = parseFloat(data.price);
        }

        const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
        const cleanSrvQuery = String(rawService).toLowerCase().trim();

        let matchedService = inventory.find(i => i.type === 'servizio' && (
            i.name.toLowerCase() === cleanSrvQuery ||
            i.name.toLowerCase().includes(cleanSrvQuery) ||
            cleanSrvQuery.includes(i.name.toLowerCase())
        ));

        if (!matchedService && cleanSrvQuery.includes('pied')) {
            matchedService = inventory.find(i => i.type === 'servizio' && (i.name.toLowerCase().includes('pedicure') || i.name.toLowerCase().includes('pied')));
        } else if (!matchedService && (cleanSrvQuery.includes('man') || cleanSrvQuery.includes('ungh'))) {
            matchedService = inventory.find(i => i.type === 'servizio' && (i.name.toLowerCase().includes('manicure') || i.name.toLowerCase().includes('semipermanente')));
        }

        const serviceFinalName = matchedService ? matchedService.name : rawService;

        if (resolvedFinalPrice <= 0 && matchedService) {
            const pInfo = await window.universalQuery({ action: 'GET_CURRENT_PRICE', id: matchedService.id });
            if (pInfo && pInfo.price > 0) resolvedFinalPrice = parseFloat(pInfo.price);
            else if (matchedService.price > 0) resolvedFinalPrice = parseFloat(matchedService.price);
        }

        if (resolvedFinalPrice <= 0 && lastApp && lastApp.price > 0) {
            resolvedFinalPrice = parseFloat(lastApp.price);
        }

        let warnings = [];
        if (action !== 'DELETE') {
            warnings = await validateAppointmentStaffConstraints(rawDate, rawTime, resolvedEndTime, rawOperator, targetId);
        }

        data = {
            cust_name: rawCust,
            date: rawDate,
            time: rawTime,
            end_time: resolvedEndTime,
            service: serviceFinalName,
            price: resolvedFinalPrice,
            assigned_user: rawOperator,
            notes: data.notes || (action === 'DELETE' ? 'Cancellato da Assistente IA' : (action === 'UPDATE' ? 'Modificato tramite Assistente IA' : 'Creato tramite Assistente IA'))
        };

        if (action === 'DELETE') {
            summaryText = `Cancellazione definitiva appuntamento di **${data.cust_name}** del **${data.date}** alle ore **${data.time} - ${data.end_time}** (*${data.service}*)`;
        } else if (action === 'UPDATE') {
            summaryText = `Spostamento/Modifica appuntamento di **${data.cust_name}**: data **${data.date}**, orario **${data.time} - ${data.end_time}** (durata: ${durationMin} min)`;
        } else {
            summaryText = `Creazione appuntamento per **${data.cust_name}** il **${data.date}** alle **${data.time} - ${data.end_time}** (*${data.service}*, Op: ${data.assigned_user})`;
        }

        const payload = {
            id: targetId || crypto.randomUUID(),
            salon_id: salonId,
            ...data
        };

        window._aiAgentContext.pendingAction = {
            action: action,
            table: table,
            payload: payload,
            id: targetId,
            summary: summaryText
        };

        return {
            simulation_status: "ARMED_FOR_CONFIRMATION",
            action: action,
            warnings: warnings,
            summary: summaryText,
            payload_details: payload
        };
    }

    if (table === 'expenses') {
        const amt = parseFloat(data.amount || data.importo) || 0;
        const desc = data.description || data.descrizione || 'Spesa gestionale';
        const expDate = resolveNaturalDate(data.date);

        data = { date: expDate, description: desc, amount: amt };
        summaryText = `Registrazione spesa "${desc}" di € ${amt.toFixed(2)} in data ${expDate}`;

        const payload = { id: targetId || crypto.randomUUID(), salon_id: salonId, ...data };
        window._aiAgentContext.pendingAction = { action: action, table: table, payload: payload, id: targetId, summary: summaryText };

        return { simulation_status: "ARMED_FOR_CONFIRMATION", action: action, warnings: [], summary: summaryText, payload_details: payload };
    }

    return { simulation_status: "ERROR", error: "Tabella non supportata." };
}
window.tool_propose_write = tool_propose_write;

// -------------------------------------------------------------------------
// 6. DISPATCHER DEI TOOL
// -------------------------------------------------------------------------
async function executeAgentToolCall(toolCall, rawQuery = '') {
    const { tool, params } = toolCall;
    console.log(`⚡ [AGENT REASONING] Esecuzione Tool: ${tool}`, params);

    try {
        if (tool === 'query_db') return await tool_query_db(params);
        if (tool === 'get_analytics') return await tool_get_analytics(params);
        if (tool === 'simulate_what_if') return await tool_simulate_what_if(params);
        if (tool === 'propose_write') return await tool_propose_write(params, rawQuery);
    } catch (err) {
        console.error(`Errore tool ${tool}:`, err);
        return { error: err.message };
    }

    return { error: `Tool ${tool} non riconosciuto.` };
}
window.executeAgentToolCall = executeAgentToolCall;

// -------------------------------------------------------------------------
// 7. HELPER DI STAMPA MESSAGGI SUL DOM DELLA CHAT E DEL DRAWER
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
// 8. CONTROLLER DIALOGICO MULTI-TURN AUTONOMO (REACT LOOP)
// -------------------------------------------------------------------------
async function processAiAgentQuery(userQuery) {
    const rawQuery = (userQuery || '').trim();
    const q = rawQuery.toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const daysItalian = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
    const dayOfWeek = daysItalian[now.getDay()];

    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id) ? currentUser.salon_id : 'SALON_001';

    // 1. Controllo Human-In-The-Loop per conferme testuali esplicite
    if (window._aiAgentContext.pendingAction) {
        const isStrictApproval = q === 'sì' || q === 'si' || q === 'conferma' || q === 'procedi' || q === 'esegui' || q === 'ok';
        const isStrictCancel = q === 'no' || q === 'annulla' || q === 'cancella' || q === 'lascia stare';

        if (isStrictApproval) return await confirmAiPendingAction();
        if (isStrictCancel) return cancelAiPendingAction();

        if (q.includes('spost') || q.includes('durata') || q.includes('elimina') || q.includes('cancella') || q.includes('dopodomani') || q.includes('domani') || q.includes('invece')) {
            window._aiAgentContext.pendingAction = null;
        } else {
            return `⚠️ C'è un'operazione in attesa di conferma:\n*${window._aiAgentContext.pendingAction.summary}*\n\nRispondi **"Conferma"** per procedere oppure tocca i pulsanti a schermo.`;
        }
    }

    // 2. Intercettazione diretta delle guide procedurali
    const directGuide = (typeof window.getDeterministicAppGuide === 'function')
        ? window.getDeterministicAppGuide(q)
        : getDeterministicAppGuide(q);

    if (directGuide) {
        return directGuide;
    }

    const lastApp = window._aiAgentContext.lastAppointment;
    const lastAppInfo = lastApp ? `
- ULTIMO APPUNTAMENTO ATTIVO GESTITO:
  * ID: "${lastApp.id}"
  * Cliente: "${lastApp.cust_name}"
  * Data: "${lastApp.date}"
  * Orario: "${lastApp.time} - ${lastApp.end_time || ''}"
  * Servizio: "${lastApp.service}"
  * Operatore: "${lastApp.assigned_user || 'admin'}"
  * Prezzo: € ${lastApp.price || 0}
` : '- Nessun appuntamento attivo recente in memoria';

    // 3. Prompt di Sistema per l'Agente
    const systemPrompt = `Sei l'Agente Intelligente e Copilota Gestionale di "VaiMUp", utilizzato dallo STAFF E DAL TITOLARE del salone.
NON SEI un call center per clienti esterni: parli con il gestore del negozio. NON rivolgerti all'utente chiamandolo "Gentile cliente".
Oggi è ${dayOfWeek}, ${todayStr} (Orario attuale: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}).
Salone ID attivo: "${salonId}".
Memoria attiva contesto:
- Ultimo Cliente: "${window._aiAgentContext.lastCustomer || 'Nessuno'}"
${lastAppInfo}

HAI ACCESSO PIENO, DIRETTO E IN TEMPO REALE AL DATABASE DEL SALONE TRAMITE I TUOI TOOL.
NON DIRE MAI "NON HO ACCESSO AL DATABASE IN TEMPO REALE" O "CONTROLLA L'AGENDA".
Se l'utente ti chiede gli appuntamenti (di oggi, di domani, di questa settimana, del mese scorso, di un cliente), CHIAMA SEMPRE IL TOOL "query_db".

HAI A DISPOSIZIONE QUESTI TOOL OPERATIVI:
1. "query_db": interroga il database del salone.
   Parametri: table ("appointments"|"customers"|"inventory"|"sales"|"expenses"), period ("this_week"|"next_week"|"today"|"tomorrow"|"this_month"|"last_month"), customer (nome cliente), date (YYYY-MM-DD), timeline ("future"|"past"|"all").
2. "get_analytics": calcola margini reali, volumi e spese fisse.
3. "simulate_what_if": simula scenari (target="highest_margin"|"highest_volume"|"specific_service", value=5, unit="euro"|"percent").
4. "propose_write": prepara inserimenti, modifiche o cancellazioni di appuntamenti con conferma HITL.
   Parametri: action ("INSERT"|"UPDATE"|"DELETE"), table ("appointments"|"expenses"|"customers"), id (se modifica/delete), data: { cust_name, date, time, service, assigned_user, price, end_time, duration }

MANUALE DIRETTO FUNZIONALITÀ APP:
${window.VAIMUP_APP_MANUAL || ''}

ISTRUZIONI SEVERISSIME:
- Se l'utente chiede di spostare un appuntamento specifico (es: "spostami quello del 14 alle 17"), chiama "propose_write" impostando:
  action="UPDATE", table="appointments", data: { customer: "${window._aiAgentContext.lastCustomer || 'Simone Rinaldi'}", date: "2026-11-14", time: "17:00" }
- Se l'utente chiede gli appuntamenti di questa settimana, chiama "query_db" con: table="appointments", period="this_week".

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
  "answer": "Testo risposta in italiano professionale..."
}`;

    // 4. FASE 1: RAGIONAMENTO E TOOL SELECTION
    let firstTurnRaw = "";
    try {
        firstTurnRaw = await callConversationalLLM(systemPrompt, rawQuery);
    } catch (err) {
        if (err.message === "API_KEY_MISSING") {
            return "🤖 Il servizio di intelligenza artificiale non è attivo sul database. Contatta l'amministratore per la configurazione.";
        }
        return `⚠️ Errore di comunicazione con il motore IA: ${err.message}`;
    }

    const firstDecision = sanitizeJson(firstTurnRaw);

    if (firstDecision && firstDecision.answer) {
        window._aiChatHistory.push({ role: "user", content: rawQuery });
        window._aiChatHistory.push({ role: "assistant", content: firstDecision.answer });
        return firstDecision.answer;
    }

    // 5. FASE 2: ESECUZIONE TOOL E SINTESI DATI
    if (firstDecision && firstDecision.tool) {
        if (!firstDecision.params) firstDecision.params = {};

        if (!firstDecision.params.period) {
            if (q.includes('questa settimana') || q.includes('settimana')) firstDecision.params.period = 'this_week';
            else if (q.includes('oggi') || q.includes('stasera')) firstDecision.params.period = 'today';
            else if (q.includes('domani')) firstDecision.params.period = 'tomorrow';
            else if (q.includes('mese scorso')) firstDecision.params.period = 'last_month';
            else if (q.includes('questo mese')) firstDecision.params.period = 'this_month';
        }

        if (!firstDecision.params.customer && !firstDecision.params.search && window._aiAgentContext.lastCustomer) {
            if (q.includes('suoi') || q.includes('completat') || q.includes('passat') || q.includes('lui') || q.includes('lei') || q.includes('tutti') || q.includes('quello')) {
                firstDecision.params.customer = window._aiAgentContext.lastCustomer;
            }
        }

        const toolResult = await executeAgentToolCall(firstDecision, rawQuery);

        // Se è una proposta di scrittura con conferma HITL
        if (firstDecision.tool === 'propose_write') {
            const sim = toolResult;

            if (sim.simulation_status === "ERROR" || sim.error) {
                return `⚠️ Non è stato possibile elaborare la richiesta: ${sim.error || 'Dati non validi'}`;
            }

            const details = sim.payload_details || {};
            const actionType = sim.action;

            let confirmQuestion = "❓ Vuoi procedere con il salvataggio?";
            let confirmBtnLabel = "✓ Conferma ed Esegui";
            let confirmBtnClass = "btn-s";

            if (actionType === 'DELETE') {
                confirmQuestion = "⚠️ Sei sicuro di voler eliminare definitivamente questo appuntamento dall'agenda?";
                confirmBtnLabel = "🗑️ Conferma ed Elimina";
                confirmBtnClass = "btn-d";
            } else if (actionType === 'UPDATE') {
                confirmQuestion = "❓ Vuoi procedere con la modifica?";
                confirmBtnLabel = "✓ Conferma Modifica";
                confirmBtnClass = "btn-s";
            } else if (actionType === 'INSERT') {
                confirmQuestion = "❓ Vuoi procedere con l'inserimento?";
                confirmBtnLabel = "✓ Conferma ed Inserisci";
                confirmBtnClass = "btn-s";
            }

            const responseText = `📋 **Proposta Operativa (In attesa di tua conferma):**\n\n` +
                `• **Operazione:** ${sim.summary}\n` +
                (details.cust_name ? `• **Cliente:** ${details.cust_name}\n` : '') +
                (details.date ? `• **Data:** ${details.date}\n` : '') +
                (details.time ? `• **Orario:** ${details.time} - ${details.end_time || ''}\n` : '') +
                (details.service ? `• **Servizio:** ${details.service} (Prezzo: € ${parseFloat(details.price || 0).toFixed(2)})\n` : '') +
                (details.assigned_user ? `• **Operatore:** ${details.assigned_user}\n` : '') +
                `\n${confirmQuestion} Rispondi **"Conferma"** oppure tocca il pulsante:\n` +
                `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:10px;">` +
                `<button type="button" class="btn ${confirmBtnClass}" style="padding:8px 16px; font-size:12px; font-weight:800; cursor:pointer;" onclick="window.confirmAiPendingAction(this)">${confirmBtnLabel}</button>` +
                `<button type="button" class="btn btn-d" style="padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer; background:#f1f5f9; color:#475569;" onclick="window.cancelAiPendingAction(this)">✕ Annulla</button>` +
                `</div>`;

            window._aiChatHistory.push({ role: "user", content: rawQuery });
            window._aiChatHistory.push({ role: "assistant", content: responseText });
            return responseText;
        }

        // Sintesi finale per query di lettura
        const synthesisPrompt = `Hai interrogato il database del salone con il tool "${firstDecision.tool}".
Dati reali estratti direttamente dal database in tempo reale:
${JSON.stringify(toolResult, null, 2)}

Richiesta dell'utente (staff/titolare del salone): "${rawQuery}"
Memoria cliente attivo: "${window._aiAgentContext.lastCustomer || 'Nessuno'}"

ISTRUZIONI PER LA RISPOSTA FINALE:
- Parli con il GESTORE/STAFF del salone. Usa un tono da collega o assistente gestionale competente.
- Se l'utente ha chiesto gli appuntamenti della settimana o di un periodo, elencali in ordine cronologico indicando data, orario, cliente, trattamento ed operatore.
- Se la lista è vuota, specifica con chiarezza che non ci sono appuntamenti registrati per quel periodo o cliente.
- Non dire mai che non hai accesso al database.`;

        try {
            const finalReply = await callConversationalLLM(
                "Sei il copilota gestionale di VaiMUp. Sintetizza con precisione i dati estratti dal database.",
                synthesisPrompt
            );

            const parsedFinal = sanitizeJson(finalReply);
            const textToReturn = (parsedFinal && (parsedFinal.answer || parsedFinal.message)) ? (parsedFinal.answer || parsedFinal.message) : finalReply;

            const detectedCust = firstDecision.params?.customer || firstDecision.params?.search;
            if (detectedCust && detectedCust !== 'all') {
                window._aiAgentContext.lastCustomer = detectedCust;
            }

            window._aiChatHistory.push({ role: "user", content: rawQuery });
            window._aiChatHistory.push({ role: "assistant", content: textToReturn });

            return textToReturn;

        } catch (synthErr) {
            console.error("Errore sintesi finale agente:", synthErr);
            return `📊 Risultati estratti (${toolResult.total_found || toolResult.total_real_client_appointments || 0} record trovati). Controlla l'agenda per i dettagli.`;
        }
    }

    window._aiChatHistory.push({ role: "user", content: rawQuery });
    window._aiChatHistory.push({ role: "assistant", content: firstTurnRaw });
    return firstTurnRaw || "🤖 Ho elaborato la richiesta. Come posso esserti utile?";
}
window.processAiAgentQuery = processAiAgentQuery;

// -------------------------------------------------------------------------
// 9. ESECUZIONE FASE 2: CONFERMA E APPLICAZIONE HUMAN-IN-THE-LOOP
// -------------------------------------------------------------------------
async function confirmAiPendingAction(btnElement = null) {
    const pending = window._aiAgentContext.pendingAction;
    if (!pending) {
        const msg = "⚠️ Nessuna operazione in attesa di conferma.";
        if (btnElement) appendAgentMessage(msg, false);
        return msg;
    }

    if (btnElement) {
        const container = btnElement.closest('.ai-hitl-actions');
        if (container) {
            container.innerHTML = '<span style="font-size:11px; font-weight:800; color:#047857; background:#dcfce7; padding:4px 8px; border-radius:6px;">✓ Azione confermata</span>';
        }
    }

    window._aiAgentContext.pendingAction = null;

    try {
        const { action, table, payload, id } = pending;
        const targetId = id || payload?.id;
        let successText = "";

        if (action === 'DELETE') {
            await window.universalQuery({ action: 'DELETE', table: table, id: targetId });
            window._aiAgentContext.lastAppointment = null;
            window._aiAgentContext.lastAppointmentId = null;
            successText = `🗑️ **Appuntamento eliminato con successo!**\nL'appuntamento di **${payload.cust_name}** del **${payload.date}** (${payload.service}) è stato rimosso dall'agenda.`;
        } else if (action === 'UPDATE') {
            await window.universalQuery({ action: 'UPDATE', table: table, data: payload, id: targetId });
            window._aiAgentContext.lastAppointment = { ...payload, id: targetId };
            window._aiAgentContext.lastAppointmentId = targetId;
            window._aiAgentContext.lastCustomer = payload.cust_name;
            window._aiAgentContext.lastDate = payload.date;
            successText = `✅ **Appuntamento modificato con successo!**\n${pending.summary}.`;
        } else if (action === 'INSERT') {
            const res = await window.universalQuery({ action: 'INSERT', table: table, data: payload });
            const savedId = res?.lastInsertRowid || res?.id || targetId;
            payload.id = savedId;
            window._aiAgentContext.lastAppointment = { ...payload };
            window._aiAgentContext.lastAppointmentId = savedId;
            window._aiAgentContext.lastCustomer = payload.cust_name;
            window._aiAgentContext.lastDate = payload.date;
            successText = `✅ **Appuntamento registrato con successo!**\n${pending.summary}.`;
        }

        if (typeof refreshAllData === 'function') await refreshAllData();
        if (typeof renderCalendar === 'function') renderCalendar();
        if (typeof loadBalance === 'function') loadBalance();

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
// 10. SPEECH SYNTHESIS & PUSH-TO-TALK
// -------------------------------------------------------------------------
function speakAiResponse(text) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();

    if (!text) return;

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