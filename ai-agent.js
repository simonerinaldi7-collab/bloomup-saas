// =========================================================================
// 🤖 VAIMUP AGENT CORE - ZERO-HALLUCINATION AUTONOMOUS BUSINESS ENGINE
// Local-First Dexie.js + Supabase Multi-Tenant Architecture
// =========================================================================

if (!window._aiAgentContext) {
    window._aiAgentContext = {
        lastCustomer: null,
        lastCustomerId: null,
        lastProduct: null,
        lastDate: null,
        lastAppointmentId: null,
        lastService: null,
        pendingAction: null // Human-In-The-Loop safety gate
    };
}

/**
 * Sanitizza ed estrae oggetti JSON dall'output dell'LLM in modo resiliente
 */
function extractAndSanitizeJson(rawText) {
    if (!rawText) return null;
    try {
        return JSON.parse(rawText.trim());
    } catch (e) {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (innerErr) {
                console.error("❌ [AI Core] Parsing JSON fallito:", innerErr, rawText);
                return null;
            }
        }
        return null;
    }
}

/**
 * Risolutore deterministico di orari e durate in italiano
 */
function parseNaturalTimeAndDuration(queryStr) {
    const q = (queryStr || '').toLowerCase();
    let time = null;
    let durationMinutes = 60;

    const timeMatch = q.match(/(?:alle|ore|dalle)\s*([0-1]?[0-9]|2[0-3])(?:[:.]([0-5][0-9]))?/i);
    if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = timeMatch[2] ? timeMatch[2] : '00';
        if ((q.includes('del pomeriggio') || q.includes('di sera') || q.includes('pomeriggio')) && h < 12) {
            h += 12;
        }
        time = `${String(h).padStart(2, '0')}:${m}`;
    }

    if (q.includes("un'ora e mezza") || q.includes('90 minuti') || q.includes('1 ora e mezza')) {
        durationMinutes = 90;
    } else if (q.includes("mezz'ora") || q.includes('30 minuti') || q.includes('mezza ora')) {
        durationMinutes = 30;
    } else if (q.includes('due ore') || q.includes('2 ore') || q.includes('120 minuti')) {
        durationMinutes = 120;
    } else if (q.includes("tre quarti d'ora") || q.includes('45 minuti')) {
        durationMinutes = 45;
    } else {
        const durMatch = q.match(/(\d+)\s*(?:minut|min)/i);
        if (durMatch) durationMinutes = parseInt(durMatch[1], 10);
    }

    return { time, durationMinutes };
}

/**
 * Risolutore deterministico del calendario in italiano (Temporal Grounding)
 */
function resolveItalianNaturalDate(queryStr, referenceDate = new Date()) {
    const q = (queryStr || '').toLowerCase();
    const pad = (n) => String(n).padStart(2, '0');
    const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (q.includes('dopodomani') || q.includes('dopo domani')) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() + 2);
        return toYmd(d);
    }
    if (q.includes('domani')) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() + 1);
        return toYmd(d);
    }
    if (q.includes('ieri')) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 1);
        return toYmd(d);
    }
    if (q.includes('oggi') || q.includes('stasera')) {
        return toYmd(referenceDate);
    }

    const inDaysMatch = q.match(/tra\s+(\d+)\s+giorn/i);
    if (inDaysMatch) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
        return toYmd(d);
    }

    if (q.includes('tra due settimane') || q.includes('tra 2 settimane')) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() + 14);
        return toYmd(d);
    }
    if (q.includes('prossima settimana') || q.includes('settimana prossima')) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() + 7);
        return toYmd(d);
    }

    const daysMap = {
        'domenica': 0, 'lunedi': 1, 'lunedì': 1, 'martedi': 2, 'martedì': 2,
        'mercoledi': 3, 'mercoledì': 3, 'giovedi': 4, 'giovedì': 4,
        'venerdi': 5, 'venerdì': 5, 'sabato': 6
    };

    for (let dayName in daysMap) {
        if (q.includes(dayName)) {
            const targetDay = daysMap[dayName];
            const currentDay = referenceDate.getDay();
            let diff = targetDay - currentDay;
            if (q.includes('prossim') || diff <= 0) {
                diff += 7;
            }
            const d = new Date(referenceDate);
            d.setDate(d.getDate() + diff);
            return toYmd(d);
        }
    }

    const itMonths = {
        'gen': 1, 'gennaio': 1, 'feb': 2, 'febbraio': 2, 'mar': 3, 'marzo': 3,
        'apr': 4, 'aprile': 4, 'mag': 5, 'maggio': 5, 'giu': 6, 'giugno': 6,
        'lug': 7, 'luglio': 7, 'ago': 8, 'agosto': 8, 'set': 9, 'settembre': 9,
        'ott': 10, 'ottobre': 10, 'nov': 11, 'novembre': 11, 'dic': 12, 'dicembre': 12
    };

    const explicitDateMatch = q.match(/(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?/);
    if (explicitDateMatch) {
        const day = parseInt(explicitDateMatch[1], 10);
        const month = parseInt(explicitDateMatch[2], 10);
        let year = explicitDateMatch[3] ? parseInt(explicitDateMatch[3], 10) : referenceDate.getFullYear();
        if (year < 100) year += 2000;
        return `${year}-${pad(month)}-${pad(day)}`;
    }

    for (let mName in itMonths) {
        const matchNamed = q.match(new RegExp(`(\\d{1,2})\\s+${mName}(?:\\s+(\\d{4}))?`, 'i'));
        if (matchNamed) {
            const day = parseInt(matchNamed[1], 10);
            const month = itMonths[mName];
            const year = matchNamed[2] ? parseInt(matchNamed[2], 10) : referenceDate.getFullYear();
            return `${year}-${pad(month)}-${pad(day)}`;
        }
    }

    return null;
}

// =========================================================================
// 📚 BASE DI CONOSCENZA PROCEDURALE DETERMINISTICA (ZERO ALLUCINAZIONI)
// =========================================================================

function getDeterministicAppGuide(query) {
    const q = (query || '').toLowerCase().trim();

    // 1. STORNO DI CASSA
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

    // 2. CARICO MAGAZZINO CON FIFO
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

    // 3. PACCHETTI E CARNET SEDUTE
    if ((q.includes('pacchetto') || q.includes('carnet') || q.includes('sedute')) && (q.includes('come') || q.includes('funziona') || q.includes('creare') || q.includes('vendere'))) {
        return `🎁 **Guida Ufficiale: Gestione Pacchetti e Carnet Prepagati**\n\n` +
            `I pacchetti consentono di vendere percorsi di trattamenti con pagamento unico o a rate e riscatto a costo zero:\n\n` +
            `1. **Configurazione Pacchetto**: Vai in **"🎁 Pacchetti & Carnet"** ➔ Clicca **"+ Nuovo Pacchetto"**, assegna un prezzo totale e aggiungi i servizi inclusi con il numero di sedute.\n` +
            `2. **Vendita in Cassa**: In **"🛒 Cassa & POS"**, seleziona il cliente, tocca il pacchetto dal catalogo e registra l'incasso (anche parziale con rata).\n` +
            `3. **Riscatto in Agenda**: Quando fissi l'appuntamento per quel cliente, il sistema rileva in automatico il carnet attivo e ti propone di scalare 1 seduta a **€ 0.00**!`;
    }

    // 4. POSTAZIONI & COWORKING
    if ((q.includes('postazion') || q.includes('coworking') || q.includes('cabina') || q.includes('poltrona')) && (q.includes('come') || q.includes('funziona'))) {
        return `🏢 **Guida Ufficiale: Spazi & Coworking Multi-Tenant**\n\n` +
            `Permette di condividere cabine, poltrone o macchinari laser evitando l'overbooking:\n\n` +
            `1. **Configura lo Spazio**: Vai in **"🏢 Spazi & Coworking"** ➔ Clicca **"+"** per creare cabine o poltrone e impostare i negozi partner abilitati.\n` +
            `2. **Blocco Automatico**: Quando inserisci un appuntamento che richiede una postazione specifica, il sistema riserva lo slot in modo atomico.\n` +
            `3. **Tutela della Privacy**: Gli altri saloni vedranno lo spazio occupato come *"Bloccato da Altro Salone"*, senza poter leggere i dati anagrafici del cliente finale.`;
    }

    // 5. STAMPA LISTINI & BARCODE
    if ((q.includes('stampa') || q.includes('listino')) && (q.includes('come') || q.includes('formato') || q.includes('pdf'))) {
        return `🖨️ **Guida Ufficiale: Print Studio & Cartelli Vetrina**\n\n` +
            `1. Dal menu laterale apri **"🖨️ Stampa & Listini"**.\n` +
            `2. Scegli la modalità: **Listino Trattamenti** oppure **Cartello QR Booking** per vetrine.\n` +
            `3. Seleziona il formato carta (A4, A5 compatto, A3 o Poster Maxi 50x70) e il tema grafico d'autore.\n` +
            `4. Puoi trascinare direttamente con il mouse il logo o le intestazioni per adattarli al millimetro prima di stampare o salvare in PDF!`;
    }

    return null;
}

/**
 * Risoluzione trasparente della chiave API dal database
 */
async function resolveAndLoadAiKey() {
    if (window._runtimeAiKey && window._runtimeAiKey.length > 15 && !window._runtimeAiKey.includes("INSERISCI")) {
        return window._runtimeAiKey;
    }
    if (typeof loadSecureAiKey === 'function') {
        const key = await loadSecureAiKey();
        if (key) return key;
    }
    const storageKey = localStorage.getItem('vaimup_ai_runtime_key');
    if (storageKey && storageKey.length > 15 && !storageKey.includes("INSERISCI")) {
        window._runtimeAiKey = storageKey;
        return storageKey;
    }
    return null;
}

/**
 * Pipeline LLM Multi-Provider Resiliente
 */
async function callAiModelWithFallback(systemPrompt, userQuery) {
    const apiKey = await resolveAndLoadAiKey();

    if (!apiKey || apiKey.includes("INSERISCI")) {
        throw new Error("API_KEY_MISSING");
    }

    const isGoogleKey = apiKey.startsWith("AIza");

    // =========================================================================
    // CASO A: Endpoint Google Gemini Nativo (AIza...)
    // =========================================================================
    if (isGoogleKey) {
        const geminiModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        for (const gModel of geminiModels) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${apiKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: systemPrompt }] },
                        contents: [{ parts: [{ text: userQuery }] }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 800,
                            responseMimeType: "application/json"
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                }
            } catch (gErr) {
                console.warn(`Tentativo Gemini ${gModel} fallito:`, gErr.message);
            }
        }
        throw new Error("Tutti gli endpoint Google Gemini nativi hanno risposto con errore.");
    }

    // =========================================================================
    // CASO B: Endpoint OpenRouter con Modelli Verificati e Funzionanti
    // Priorità al modello Llama 3.3 70B (testato con successo sulla tua chiave)
    // =========================================================================
    const openRouterModels = [
        "meta-llama/llama-3.3-70b-instruct",
        "openrouter/auto",
        "google/gemini-2.5-flash",
        "deepseek/deepseek-chat"
    ];

    for (const targetModel of openRouterModels) {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'VaiMUp Agent Core'
                },
                body: JSON.stringify({
                    model: targetModel,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userQuery }
                    ],
                    temperature: 0.1,
                    max_tokens: 800
                })
            });

            if (response.ok) {
                const data = await response.json();
                return data.choices?.[0]?.message?.content || "";
            }
        } catch (netErr) {
            console.warn(`Tentativo con ${targetModel} fallito:`, netErr.message);
        }
    }

    throw new Error("Tutti i provider OpenRouter hanno risposto con errore.");
}

/**
 * Gestore principale delle query per VaiMUp Agent Core
 */
async function processAiAgentQuery(userQuery) {
    const rawQuery = (userQuery || '').trim();
    const q = rawQuery.toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const daysItalian = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
    const dayOfWeekName = daysItalian[now.getDay()];

    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id)
        ? currentUser.salon_id
        : 'SALON_001';

    // 1. Controllo Human-In-The-Loop per azioni pendenti
    if (window._aiAgentContext.pendingAction) {
        return await handlePendingConfirmationInput(rawQuery);
    }

    // 2. ⚡ INTERCETTAZIONE DIRETTA DOMANDE PROCEDURALI E GUIDE (Zero Latenza & Zero Allucinazioni)
    const directGuide = getDeterministicAppGuide(q);
    if (directGuide) {
        return directGuide;
    }

    // 3. ⚡ INTERCETTAZIONE RAPIDA PULSANTE "ANALIZZA I MIEI MARGINI E STRATEGIE"
    if (q.includes('analizza') && (q.includes('margini') || q.includes('strategi') || q.includes('consigli'))) {
        return await generateStrategicAdvisorReport(salonId, todayStr);
    }

    // 4. Risoluzione temporale deterministica locale
    const deterministicDate = resolveItalianNaturalDate(q, now);
    const { time: deterministicTime, durationMinutes: deterministicDuration } = parseNaturalTimeAndDuration(q);

    // 5. Idratazione indici locali per prompt grounding
    const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
    const customerNames = customers.map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim()).filter(Boolean);

    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const services = inventory.filter(i => i.type === 'servizio');
    const products = inventory.filter(i => i.type === 'prodotto');

    const users = await window.universalQuery({ action: 'GET_ALL', table: 'users' }) || [];
    const operatorNames = users.map(u => u.username).filter(Boolean);

    const systemPrompt = `Sei l'assistente NLU del gestionale saloni "VaiMUp".
Oggi è ${dayOfWeekName}, ${todayStr} (Ore ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}).
Salone ID attivo: "${salonId}".
Memoria attiva: UltimoCliente="${window._aiAgentContext.lastCustomer || 'Nessuno'}", UltimoProdotto="${window._aiAgentContext.lastProduct || 'Nessuno'}".

REGOLE ASSOLUTE:
1. NON tentare di eseguire calcoli matematici o scritture nel testo.
2. Rispondi ESCLUSIVAMENTE con un oggetto JSON valido privo di testo o commenti extra:
{
  "action": "APP_GUIDE" | "CREATE_APPOINTMENT" | "MOVE_APPOINTMENT" | "DELETE_APPOINTMENT" | "GET_APPOINTMENTS" | "CREATE_EXPENSE" | "GET_EXPENSES" | "STOCK_ADJUSTMENT" | "GET_STOCK_STATUS" | "ANALYTICS_QUERY" | "WHAT_IF_SIMULATION" | "UNKNOWN",
  "customerName": string o null,
  "serviceName": string o null,
  "productName": string o null,
  "operatorName": string o null,
  "date": "YYYY-MM-DD" o null,
  "time": "HH:MM" o null,
  "durationMinutes": number o null,
  "expenseDescription": string o null,
  "expenseAmount": number o null,
  "stockQty": number o null,
  "stockMovementType": "carico" | "scarico" | null,
  "analyticsType": "MARGINS" | "RFM" | "BREAK_EVEN" | "LOW_STOCK" | "TOP_CLIENTS" | null,
  "simulationType": "PRICE_SENSITIVITY" | "EXPENSE_IMPACT" | "STAFF_CAPACITY" | null,
  "simulationParam": number o null,
  "simulationCategory": string o null,
  "guideTopic": string o null
}

IMPORTANTE: Se l'utente chiede "come fare...", "spiegami...", "come si fa..." imposta SEMPRE action: "APP_GUIDE" e NON un'azione operativa come CREATE_EXPENSE.
Clienti noti: ${JSON.stringify(customerNames.slice(0, 30))}.
Servizi noti: ${JSON.stringify(services.map(s => s.name).slice(0, 25))}.
Operatori disponibili: ${JSON.stringify(operatorNames)}.`;

    let parsed = null;
    try {
        const rawResponse = await callAiModelWithFallback(systemPrompt, rawQuery);
        parsed = extractAndSanitizeJson(rawResponse);
    } catch (err) {
        if (err.message === "API_KEY_MISSING") {
            return "🤖 Il servizio di intelligenza artificiale non è al momento abilitato sul database. Contatta l'amministratore per verificare la chiave nei settings di Supabase.";
        }
        console.warn("⚠️ [AI Pipeline Fallback]:", err.message);
        parsed = fallbackHeuristicIntentClassifier(q, todayStr);
    }

    if (!parsed) {
        parsed = fallbackHeuristicIntentClassifier(q, todayStr);
    }

    if (deterministicDate && (!parsed.date || parsed.date === 'null')) {
        parsed.date = deterministicDate;
    }
    if (deterministicTime && (!parsed.time || parsed.time === 'null')) {
        parsed.time = deterministicTime;
    }
    if (deterministicDuration && !parsed.durationMinutes) {
        parsed.durationMinutes = deterministicDuration;
    }

    if (!parsed.customerName && window._aiAgentContext.lastCustomer && (q.includes('suoi') || q.includes('di lui') || q.includes('di lei') || q.includes('spost') || q.includes('elimin'))) {
        parsed.customerName = window._aiAgentContext.lastCustomer;
    }

    if (parsed.customerName) window._aiAgentContext.lastCustomer = parsed.customerName;
    if (parsed.serviceName) window._aiAgentContext.lastService = parsed.serviceName;
    if (parsed.productName) window._aiAgentContext.lastProduct = parsed.productName;
    if (parsed.date) window._aiAgentContext.lastDate = parsed.date;

    return await dispatchDeterministicAgentAction(parsed, rawQuery, todayStr, salonId);
}

/**
 * Dispatcher deterministico con Human-In-The-Loop
 */
async function dispatchDeterministicAgentAction(parsed, rawQuery, todayStr, salonId) {
    const action = parsed.action || 'UNKNOWN';

    // GUIDA OPERATIVA
    if (action === 'APP_GUIDE') {
        const guide = getDeterministicAppGuide(rawQuery) || getDeterministicAppGuide(parsed.guideTopic || '');
        if (guide) return guide;
        return `📖 Per supporto sulle funzionalità di VaiMUp puoi chiedermi ad esempio:\n` +
            `- *"Come faccio a fare uno storno di cassa?"*\n` +
            `- *"Come carico un prodotto in magazzino con FIFO?"*\n` +
            `- *"Come funziona la condivisione delle postazioni coworking?"*\n` +
            `- *"Come creo un pacchetto o carnet sedute?"*`;
    }

    // 1. WRITE: APPOINTMENT CREATION (HITL Gate)
    if (action === 'CREATE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) {
            return "⚠️ Per quale cliente desideri fissare l'appuntamento? Specificane il nome.";
        }

        const targetDate = parsed.date || todayStr;
        const targetTime = parsed.time || "09:00";
        const durationMinutes = parsed.durationMinutes || 60;
        const serviceName = parsed.serviceName || "Trattamento Generico";
        const assignedOperator = parsed.operatorName || (typeof currentUser !== 'undefined' && currentUser ? currentUser.username : 'admin');

        const [h, m] = targetTime.split(':').map(Number);
        const endTotalMin = (h * 60 + m) + durationMinutes;
        const targetEndTime = `${String(Math.floor(endTotalMin / 60) % 24).padStart(2, '0')}:${String(endTotalMin % 60).padStart(2, '0')}`;

        // Verifica orari turni
        const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
        const dateObj = new Date(targetDate + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();
        const opSchedule = schedules.find(s => (s.username || '').trim().toLowerCase() === assignedOperator.trim().toLowerCase() && Number(s.day_of_week) === dayOfWeek);

        let warnings = [];
        if (!opSchedule || Number(opSchedule.is_working) !== 1) {
            warnings.push(`⚠️ L'operatore <b>${assignedOperator}</b> risulta a riposo in data ${targetDate}.`);
        }

        const existingApps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const overlap = existingApps.find(a => {
            if (a.date !== targetDate) return false;
            if ((a.assigned_user || 'admin').toLowerCase() !== assignedOperator.toLowerCase()) return false;
            const aStart = a.time ? a.time.substring(0, 5) : '00:00';
            const aEnd = a.end_time ? a.end_time.substring(0, 5) : '23:59';
            return targetTime < aEnd && targetEndTime > aStart;
        });

        if (overlap) {
            warnings.push(`⚠️ Conflitto d'orario: <b>${assignedOperator}</b> è già impegnato con <b>${overlap.cust_name}</b> (${overlap.time} - ${overlap.end_time || ''}).`);
        }

        const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
        const matchedServ = inventory.find(i => i.type === 'servizio' && i.name.toLowerCase().includes(serviceName.toLowerCase()));
        let estimatedPrice = 0;
        if (matchedServ) {
            const pInfo = await window.universalQuery({ action: 'GET_CURRENT_PRICE', id: matchedServ.id });
            estimatedPrice = pInfo ? (parseFloat(pInfo.price) || 0) : (parseFloat(matchedServ.price) || 0);
        }

        const appPayload = {
            id: crypto.randomUUID(),
            salon_id: salonId,
            cust_name: custName,
            date: targetDate,
            time: targetTime,
            end_time: targetEndTime,
            service: matchedServ ? matchedServ.name : serviceName,
            price: estimatedPrice,
            assigned_user: assignedOperator,
            notes: "Creato tramite Assistente IA (HITL Confermato)"
        };

        window._aiAgentContext.pendingAction = {
            type: 'CREATE_APPOINTMENT',
            payload: appPayload,
            summary: `Appuntamento per **${custName}** il **${targetDate}** dalle **${targetTime}** alle **${targetEndTime}** (${appPayload.service}, Op: ${assignedOperator})`
        };

        let reply = `📋 **Simulazione Creazione Appuntamento:**\n` +
            `- **Cliente:** ${custName}\n` +
            `- **Data:** ${targetDate}\n` +
            `- **Orario:** ${targetTime} - ${targetEndTime} (${durationMinutes} min)\n` +
            `- **Servizio:** ${appPayload.service}\n` +
            `- **Operatore:** ${assignedOperator}\n` +
            `- **Prezzo Stimato:** € ${estimatedPrice.toFixed(2)}\n`;

        if (warnings.length > 0) reply += `\n${warnings.join('\n')}\n`;

        reply += `\n❓ Vuoi inserire l'appuntamento? Rispondi **"Sì" / "Conferma"** oppure tocca il pulsante:\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma ed Inserisci</button>` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:700;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;

        return reply;
    }

    // 2. WRITE: MOVE APPOINTMENT (HITL Gate)
    if (action === 'MOVE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Di quale cliente desideri spostare l'appuntamento?";

        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const upcomingApps = appointments.filter(a => {
            const matchName = (a.cust_name || '').toLowerCase().includes(custName.toLowerCase());
            return matchName && a.date >= todayStr;
        }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        if (upcomingApps.length === 0) {
            return `⚠️ Non ho trovato appuntamenti futuri in agenda per **${custName}**.`;
        }

        const targetApp = upcomingApps[0];
        const newDate = parsed.date || targetApp.date;
        const newTime = parsed.time || targetApp.time;

        let durationMin = 60;
        if (targetApp.time && targetApp.end_time) {
            const [sH, sM] = targetApp.time.split(':').map(Number);
            const [eH, eM] = targetApp.end_time.split(':').map(Number);
            durationMin = Math.max((eH * 60 + eM) - (sH * 60 + sM), 15);
        }
        const [nH, nM] = newTime.split(':').map(Number);
        const newEndMin = (nH * 60 + nM) + durationMin;
        const newEndTimeStr = `${String(Math.floor(newEndMin / 60) % 24).padStart(2, '0')}:${String(newEndMin % 60).padStart(2, '0')}`;

        window._aiAgentContext.pendingAction = {
            type: 'MOVE_APPOINTMENT',
            appId: targetApp.id,
            newDate: newDate,
            newTime: newTime,
            newEndTime: newEndTimeStr,
            summary: `Spostamento appuntamento di **${targetApp.cust_name}** dal ${targetApp.date} ore ${targetApp.time} al **${newDate}** alle **${newTime}**`
        };

        return `📋 **Richiesta Spostamento Appuntamento:**\n` +
            `- **Cliente:** ${targetApp.cust_name}\n` +
            `- **Trattamento:** ${targetApp.service || 'Trattamento'}\n` +
            `- **Orario Attuale:** ${targetApp.date} alle ore ${targetApp.time}\n` +
            `- **Nuovo Orario Proposto:** **${newDate}** dalle **${newTime}** alle **${newEndTimeStr}**\n\n` +
            `❓ Confermi lo spostamento?\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma Spostamento</button>` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:700;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;
    }

    // 3. WRITE: DELETE APPOINTMENT (HITL Gate)
    if (action === 'DELETE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Di quale cliente desideri eliminare l'appuntamento?";

        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const match = appointments.find(a => (a.cust_name || '').toLowerCase().includes(custName.toLowerCase()) && a.date >= todayStr);

        if (!match) return `⚠️ Nessun appuntamento futuro trovato per **${custName}**.`;

        window._aiAgentContext.pendingAction = {
            type: 'DELETE_APPOINTMENT',
            appId: match.id,
            details: `${match.cust_name} il ${match.date} alle ${match.time} (${match.service || 'Servizio'})`,
            appObj: match
        };

        return `⚠️ **Conferma Eliminazione Appuntamento:**\n` +
            `Sei sicuro di voler cancellare l'appuntamento di **${match.cust_name}** previsto per il **${match.date}** alle **${match.time}** (${match.service || 'Servizio'})?\n\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">🗑️ Elimina Definitivamente</button>` +
            `<button type="button" class="btn" style="padding:6px 14px; font-size:12px; background:#f1f5f9; color:#475569;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;
    }

    // 4. WRITE: EXPENSE REGISTRATION (HITL Gate - Solo se l'importo è reale)
    if (action === 'CREATE_EXPENSE') {
        const desc = parsed.expenseDescription || "Spesa gestionale";
        const amt = parseFloat(parsed.expenseAmount) || 0;
        const expDate = parsed.date || todayStr;

        if (amt <= 0) {
            return "⚠️ Qual è l'importo esatto della spesa da registrare? Specifica la cifra in Euro (es. *'Registra spesa di 85€ per forniture'*).";
        }

        const expensePayload = {
            id: crypto.randomUUID(),
            salon_id: salonId,
            date: expDate,
            description: desc,
            amount: amt
        };

        window._aiAgentContext.pendingAction = {
            type: 'CREATE_EXPENSE',
            payload: expensePayload,
            summary: `Registrazione spesa "${desc}" di € ${amt.toFixed(2)} in data ${expDate}`
        };

        return `💳 **Registrazione Spesa (Simulazione):**\n` +
            `- **Descrizione:** ${desc}\n` +
            `- **Importo:** € ${amt.toFixed(2)}\n` +
            `- **Data Competenza:** ${expDate}\n\n` +
            `❓ Confermi l'inserimento a bilancio?\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma Spesa</button>` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;
    }

    // 5. READ: GET APPOINTMENTS
    if (action === 'GET_APPOINTMENTS') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        const targetDate = parsed.date;
        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];

        let filtered = appointments;
        if (custName) {
            filtered = filtered.filter(a => (a.cust_name || '').toLowerCase().includes(custName.toLowerCase()));
        }
        if (targetDate) {
            filtered = filtered.filter(a => a.date === targetDate);
        } else {
            filtered = filtered.filter(a => a.date >= todayStr);
        }

        filtered.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        if (filtered.length === 0) {
            return `📅 Nessun appuntamento in agenda${custName ? ' per **' + custName + '**' : ''}${targetDate ? ' in data ' + targetDate : ' nei prossimi giorni'}.`;
        }

        let reply = `📅 **Appuntamenti individuati (${filtered.length}):**\n`;
        filtered.slice(0, 8).forEach(a => {
            const timeStr = a.time ? a.time.substring(0, 5) : '--:--';
            reply += `- **${a.date}** ore **${timeStr}**: 👤 ${a.cust_name} — *${a.service || 'Trattamento'}* (Op: ${a.assigned_user || 'Admin'})\n`;
        });
        return reply;
    }

    // 6. READ: ANALYTICS & WHAT-IF SIMULATIONS
    if (action === 'ANALYTICS_QUERY') {
        return await computeDeterministicSalonAnalytics(parsed, salonId, todayStr);
    }
    if (action === 'WHAT_IF_SIMULATION') {
        return await executeDeterministicWhatIfSimulation(parsed, salonId, todayStr);
    }
    if (action === 'GET_STOCK_STATUS') {
        const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
        const prods = inventory.filter(i => i.type === 'prodotto');
        const low = prods.filter(p => (parseFloat(p.stock) || 0) <= (parseFloat(p.min_stock) || 0));

        if (low.length === 0) {
            return `📦 **Stato Magazzino:** Ottime notizie! Tutti i **${prods.length} prodotti** a magazzino sono attualmente sopra la soglia di scorta minima.`;
        }
        let reply = `⚠️ **Prodotti Sotto Scorta (${low.length} su ${prods.length}):**\n`;
        low.slice(0, 8).forEach(p => {
            reply += `- **${p.name}**: giacenza attuale **${p.stock}** (soglia minima: ${p.min_stock})\n`;
        });
        return reply;
    }

    return "🤖 Come posso aiutarti? Puoi chiedermi di consultare l'agenda, simulare scenari di prezzo/costi, o consultare le guide procedurali di cassa e magazzino.";
}

/**
 * Report di Consulenza Strategica e Margini Reali (Innescato dal pulsante rapido)
 */
async function generateStrategicAdvisorReport(salonId, todayStr) {
    const currentMonth = todayStr.substring(0, 7);
    const sales = await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || [];
    const monthSales = sales.filter(s => s.date && s.date.startsWith(currentMonth));
    const salesIds = new Set(monthSales.map(s => String(s.id)));

    const saleItems = await window.universalQuery({ action: 'GET_ALL', table: 'sale_items' }) || [];
    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const productSuppliers = await window.universalQuery({ action: 'GET_ALL', table: 'product_suppliers' }) || [];
    const priceHistory = await window.universalQuery({ action: 'GET_ALL', table: 'price_history' }) || [];

    let totalTurnover = 0;
    let totalSalonCompetence = 0;
    const servicePerformances = {};

    saleItems.forEach(si => {
        if (!salesIds.has(String(si.sale_id))) return;
        const sale = monthSales.find(s => String(s.id) === String(si.sale_id));
        const saleDate = sale ? sale.date : todayStr;
        const gross = (parseFloat(si.price) - (parseFloat(si.discount) || 0)) * (parseFloat(si.qty) || 1);
        totalTurnover += gross;

        const competence = (typeof computeItemSalonCompetence === 'function')
            ? computeItemSalonCompetence(si, saleDate, inventory, productSuppliers, priceHistory)
            : gross;

        totalSalonCompetence += competence;

        const name = si.item_name || 'Altro';
        if (!servicePerformances[name]) servicePerformances[name] = { qty: 0, revenue: 0, margin: 0 };
        servicePerformances[name].qty += (parseFloat(si.qty) || 1);
        servicePerformances[name].revenue += gross;
        servicePerformances[name].margin += competence;
    });

    const expenses = await window.universalQuery({ action: 'GET_ALL', table: 'expenses' }) || [];
    const monthExpenses = expenses.filter(e => e.date && e.date.startsWith(currentMonth));
    const totalExp = monthExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const netProfit = totalSalonCompetence - totalExp;

    const topServices = Object.keys(servicePerformances)
        .map(k => ({ name: k, ...servicePerformances[k] }))
        .sort((a, b) => b.margin - a.margin)
        .slice(0, 3);

    let topText = '';
    topServices.forEach((s, idx) => {
        topText += `${idx + 1}. **${s.name}**: ${s.qty} eseguiti, margine netto salone **€ ${s.margin.toFixed(2)}**\n`;
    });

    return `📊 **Consulenza Strategica e Analisi Margini (Mese ${currentMonth})**\n\n` +
        `💰 **Performance Finanziaria:**\n` +
        `- **Incasso Lordo Totale:** € ${totalTurnover.toFixed(2)}\n` +
        `- **Competenza Netta Salone (post-CV/Lotti):** **€ ${totalSalonCompetence.toFixed(2)}**\n` +
        `- **Costi Fissi e Spese:** € ${totalExp.toFixed(2)}\n` +
        `- **Margine Operativo Reale:** **€ ${netProfit.toFixed(2)}**\n\n` +
        `🏆 **Trattamenti a più Alto Margine:**\n${topText || 'Dati vendite in fase di consolidamento.'}\n` +
        `💡 **Raccomandazione Strategica VaiMUp:**\n` +
        `- Incentiva i pacchetti e i trattamenti a maggiore marginalità netta.\n` +
        `- Per simulare variazioni di listino chiedimi ad esempio: *"Cosa succede se aumento del 10% il listino colori?"*`;
}

/**
 * Gestione dello stato Human-In-The-Loop su input utente
 */
async function handlePendingConfirmationInput(rawQuery) {
    const q = rawQuery.toLowerCase().trim();
    const isApproval = q === 'sì' || q === 'si' || q.includes('conferma') || q.includes('procedi') || q.includes('confermo') || q.includes('esegui') || q.includes('ok');
    const isCancel = q === 'no' || q.includes('annulla') || q.includes('cancella') || q.includes('lascia stare');

    if (isApproval) {
        return await confirmAiPendingAction();
    } else if (isCancel) {
        return cancelAiPendingAction();
    }

    return "⚠️ C'è un'operazione in attesa di conferma:\n" +
        `*${window._aiAgentContext.pendingAction.summary}*\n\n` +
        `Rispondi **"Conferma"** per eseguire oppure **"Annulla"** per revocare.`;
}

/**
 * Esecuzione Fase 2 su approvazione esplicita (HITL Gate)
 */
async function confirmAiPendingAction() {
    const actionState = window._aiAgentContext.pendingAction;
    if (!actionState) return "⚠️ Nessuna operazione in attesa di conferma.";

    window._aiAgentContext.pendingAction = null;

    try {
        if (actionState.type === 'CREATE_APPOINTMENT') {
            const payload = actionState.payload;
            await window.universalQuery({ action: 'INSERT', table: 'appointments', data: payload });

            if (typeof refreshAllData === 'function') await refreshAllData();
            if (typeof renderCalendar === 'function') renderCalendar();

            window._aiAgentContext.lastAppointmentId = payload.id;
            return `✅ **Operazione completata!**\nAppuntamento fissato per **${payload.cust_name}** il **${payload.date}** alle ore **${payload.time}** (${payload.service}).`;
        }

        if (actionState.type === 'MOVE_APPOINTMENT') {
            await window.universalQuery({
                action: 'UPDATE',
                table: 'appointments',
                data: {
                    date: actionState.newDate,
                    time: actionState.newTime,
                    end_time: actionState.newEndTime
                },
                id: actionState.appId
            });

            if (typeof refreshAllData === 'function') await refreshAllData();
            if (typeof renderCalendar === 'function') renderCalendar();

            return `✅ **Operazione completata!**\n${actionState.summary} completato con successo.`;
        }

        if (actionState.type === 'DELETE_APPOINTMENT') {
            if (typeof restorePackageSessionIfApplicable === 'function' && actionState.appObj) {
                await restorePackageSessionIfApplicable(actionState.appObj);
            }
            await window.universalQuery({ action: 'DELETE', table: 'appointments', id: actionState.appId });

            if (typeof refreshAllData === 'function') await refreshAllData();
            if (typeof renderCalendar === 'function') renderCalendar();

            return `🗑️ **Appuntamento eliminato:**\n${actionState.details} è stato rimosso dall'agenda.`;
        }

        if (actionState.type === 'CREATE_EXPENSE') {
            const p = actionState.payload;
            await window.universalQuery({ action: 'INSERT', table: 'expenses', data: p });

            if (typeof loadExpenses === 'function') await loadExpenses();
            if (typeof loadBalance === 'function') await loadBalance();
            if (typeof loadDailyTargetWidget === 'function') await loadDailyTargetWidget();

            return `✅ **Spesa registrata a bilancio!**\n"${p.description}" di € ${p.amount.toFixed(2)} in data ${p.date}.`;
        }

    } catch (err) {
        console.error("❌ [AI HITL Execution Error]:", err);
        return `❌ Si è verificato un errore durante l'esecuzione dell'operazione: ${err.message}`;
    }

    return "Operazione completata.";
}
window.confirmAiPendingAction = confirmAiPendingAction;

function cancelAiPendingAction() {
    window._aiAgentContext.pendingAction = null;
    return "❌ **Operazione annullata.** Nessuna modifica è stata apportata al database.";
}
window.cancelAiPendingAction = cancelAiPendingAction;

/**
 * Modulo Business Intelligence: Calcolo Deterministico
 */
async function computeDeterministicSalonAnalytics(parsed, salonId, todayStr) {
    const custName = parsed.customerName || window._aiAgentContext.lastCustomer;

    if (custName) {
        const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
        const target = customers.find(c => `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(custName.toLowerCase()));

        if (!target) return `⚠️ Nessun cliente registrato trovato con il nome "${custName}".`;

        const sales = await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || [];
        const custSales = sales.filter(s => s.cust_id === target.id);
        const totalSpent = custSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

        return `👤 **Dossier Cliente: ${target.first_name} ${target.last_name}**\n` +
            `- **Scontrini emessi:** ${custSales.length}\n` +
            `- **Spesa complessiva:** **€ ${totalSpent.toFixed(2)}**\n` +
            `- **Scontrino medio:** € ${(custSales.length > 0 ? totalSpent / custSales.length : 0).toFixed(2)}`;
    }

    return await generateStrategicAdvisorReport(salonId, todayStr);
}

/**
 * Motore Deterministico di Simulazione What-If
 */
async function executeDeterministicWhatIfSimulation(parsed, salonId, todayStr) {
    const simType = parsed.simulationType;
    const param = parseFloat(parsed.simulationParam) || 10;

    if (simType === 'PRICE_SENSITIVITY' || parsed.serviceName || parsed.simulationCategory) {
        const catFilter = (parsed.simulationCategory || parsed.serviceName || '').toLowerCase().trim();
        const pctIncrease = param;

        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const limitStr = ninetyDaysAgo.toISOString().split('T')[0];

        const sales = await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || [];
        const recentSales = sales.filter(s => s.date >= limitStr);
        const recentSalesIds = new Set(recentSales.map(s => String(s.id)));

        const saleItems = await window.universalQuery({ action: 'GET_ALL', table: 'sale_items' }) || [];
        const matchedItems = saleItems.filter(si => {
            if (!recentSalesIds.has(String(si.sale_id))) return false;
            if (!catFilter) return true;
            return (si.item_name || '').toLowerCase().includes(catFilter);
        });

        const historicalVol = matchedItems.reduce((sum, si) => sum + (parseFloat(si.qty) || 1), 0);
        const historicalRev = matchedItems.reduce((sum, si) => sum + (parseFloat(si.price || 0) * (parseFloat(si.qty) || 1)), 0);

        if (historicalVol === 0) {
            return `🔮 **Simulazione Prezzi (${catFilter || 'Servizi'}):**\nNegli ultimi 90 giorni non risultano transazioni per questa voce da cui ricavare una stima statistica.`;
        }

        const monthlyVolBase = (historicalVol / 3);
        const monthlyRevBase = (historicalRev / 3);
        const simulatedUnitGainPct = (pctIncrease / 100);
        const simulatedRetentionPct = Math.max(1 - (simulatedUnitGainPct * 0.3), 0.90);

        const simulatedMonthlyRev = monthlyRevBase * (1 + simulatedUnitGainPct) * simulatedRetentionPct;
        const netDeltaMonthly = simulatedMonthlyRev - monthlyRevBase;

        return `🔮 **Simulazione What-If: Aumento Listino +${pctIncrease}% (${catFilter || 'Servizi'})**\n\n` +
            `- **Volume storico mensile:** ~${Math.round(monthlyVolBase)} trattamenti\n` +
            `- **Fatturato base mensile:** € ${monthlyRevBase.toFixed(2)}\n` +
            `- **Nuovo incasso atteso (con ritenzione ${(simulatedRetentionPct * 100).toFixed(0)}%):** **€ ${simulatedMonthlyRev.toFixed(2)} / mese**\n` +
            `- **Guadagno netto stimato:** **+€ ${netDeltaMonthly.toFixed(2)} al mese** (+€ ${(netDeltaMonthly * 12).toFixed(2)} / anno)`;
    }

    if (simType === 'EXPENSE_IMPACT' || parsed.expenseAmount) {
        const addedExpense = parseFloat(parsed.expenseAmount) || param || 300;
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const daysInMonth = new Date(year, month, 0).getDate();

        const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
        let workingDaysRemaining = 0;
        for (let d = now.getDate(); d <= daysInMonth; d++) {
            const dObj = new Date(year, month - 1, d);
            const dow = dObj.getDay();
            const activeOnDay = schedules.some(s => Number(s.day_of_week) === dow && Number(s.is_working) === 1);
            if (activeOnDay || dow !== 0) workingDaysRemaining++;
        }
        workingDaysRemaining = Math.max(workingDaysRemaining, 1);

        const sales = await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || [];
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const recentSales = sales.filter(s => s.date >= sixtyDaysAgo.toISOString().split('T')[0]);
        const totalRev = recentSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const avgTicket = recentSales.length > 0 ? (totalRev / recentSales.length) : 40;

        const extraDailyRevenueRequired = addedExpense / workingDaysRemaining;
        const extraTreatmentsPerDay = (extraDailyRevenueRequired / avgTicket);

        return `🎯 **Simulazione Spesa: +€ ${addedExpense.toFixed(2)} / mese**\n\n` +
            `- **Giorni lavorativi residui:** ${workingDaysRemaining} giorni\n` +
            `- **Scontrino medio storico:** € ${avgTicket.toFixed(2)}\n\n` +
            `⚖️ **Impatto sul Break-Even:**\n` +
            `- Incasso giornaliero extra per pareggio: **+€ ${extraDailyRevenueRequired.toFixed(2)} / giorno**\n` +
            `- Trattamenti addizionali necessari: **+${extraTreatmentsPerDay.toFixed(1)} clienti al giorno**.`;
    }

    return "🔮 Parametri di simulazione non riconosciuti. Chiedimi ad esempio: *'Cosa succede se aumento del 10% il listino colori?'*";
}

/**
 * Classificatore euristico di sicurezza offline
 */
function fallbackHeuristicIntentClassifier(q, todayStr) {
    if (q.includes('conferma') || q.includes('procedi') || q.includes('sì') || q.includes('si')) {
        return { action: 'CONFIRM_ACTION' };
    }
    if (q.includes('annulla') || q.includes('cancella operazione') || q.includes('lascia stare')) {
        return { action: 'CANCEL_ACTION' };
    }
    if (q.includes('cosa succede se') || q.includes('se aumento') || q.includes('aumento del') || q.includes('se l\'affitto')) {
        let pct = 10;
        const matchPct = q.match(/(\d+)%/);
        if (matchPct) pct = parseFloat(matchPct[1]);
        const isExpense = q.includes('affitto') || q.includes('spese') || q.includes('costo');
        return {
            action: 'WHAT_IF_SIMULATION',
            simulationType: isExpense ? 'EXPENSE_IMPACT' : 'PRICE_SENSITIVITY',
            simulationParam: pct
        };
    }
    if (q.includes('spost') || (q.includes('alle ') && !q.includes('crea') && !q.includes('fissa'))) {
        return { action: 'MOVE_APPOINTMENT' };
    }
    if (q.includes('elimina') || q.includes('cancella appuntamento') || q.includes('disdici')) {
        return { action: 'DELETE_APPOINTMENT' };
    }
    if (q.includes('fissa') || q.includes('prenota') || q.includes('crea appuntamento') || q.includes('metti un appuntamento')) {
        return { action: 'CREATE_APPOINTMENT' };
    }
    if (q.includes('appuntament') || q.includes('chi ho') || q.includes('chi c\'è') || q.includes('agenda')) {
        return { action: 'GET_APPOINTMENTS' };
    }
    if ((q.includes('registra') || q.includes('ho pagato') || q.includes('nuova spesa')) && (q.includes('spesa') || q.includes('costo') || q.includes('bolletta'))) {
        const amtMatch = q.match(/(\d+(?:[.,]\d{1,2})?)\s*€?/);
        return {
            action: amtMatch ? 'CREATE_EXPENSE' : 'GET_EXPENSES',
            expenseAmount: amtMatch ? parseFloat(amtMatch[1].replace(',', '.')) : 0
        };
    }
    if (q.includes('sotto scorta') || q.includes('scorte') || q.includes('magazzino')) {
        return { action: 'GET_STOCK_STATUS' };
    }
    if (q.includes('margine') || q.includes('guadagno') || q.includes('fatturato')) {
        return { action: 'ANALYTICS_QUERY' };
    }
    return { action: 'UNKNOWN' };
}

// =========================================================================
// 🎙️ SISTEMA VOCALE PUSH-TO-TALK & SPEECH SYNTHESIS
// =========================================================================

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
        resetPttButtonUI(micBtn);
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
                micBtn.style.borderColor = '#fca5a5';
                micBtn.innerText = '🔴 In ascolto...';
            }
        };

        pttSpeechRecognizer.onresult = (event) => {
            const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
            resetPttButtonUI(micBtn);

            if (transcript.length > 1) {
                const inputField = document.getElementById('ai-user-input');
                const drawerInput = document.getElementById('ai-drawer-input');
                if (inputField) inputField.value = transcript;
                if (drawerInput) drawerInput.value = transcript;

                if (typeof sendAIQuery === 'function') sendAIQuery();
            }
        };

        pttSpeechRecognizer.onerror = (e) => {
            console.warn("⚠️ [PTT Error]:", e.error);
            resetPttButtonUI(micBtn);
        };

        pttSpeechRecognizer.onend = () => {
            resetPttButtonUI(micBtn);
        };

        pttSpeechRecognizer.start();

    } catch (err) {
        console.error("Errore avvio Push-To-Talk:", err);
        resetPttButtonUI(micBtn);
    }
}
window.togglePushToTalkVoice = togglePushToTalkVoice;

function resetPttButtonUI(btn) {
    isPttListening = false;
    if (btn) {
        btn.style.background = '#f1f5f9';
        btn.style.color = '#475569';
        btn.style.borderColor = 'var(--border)';
        btn.innerText = '🎙️';
    }
}

function speakAiResponse(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    if (!text) return;

    let cleanText = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_~`#]/g, ' ')
        .replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleanText.length > 280) {
        const cut = cleanText.substring(0, 280).lastIndexOf('.');
        cleanText = cut > 60 ? cleanText.substring(0, cut + 1) : cleanText.substring(0, 280) + "...";
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'it-IT';
    utterance.rate = 0.98;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const itVoice = voices.find(v => v.lang === 'it-IT' && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Cosimo') || v.name.includes('Elsa')));
    if (itVoice) utterance.voice = itVoice;

    window.speechSynthesis.speak(utterance);
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

// Esportazioni globali
window.processAiAgentQuery = processAiAgentQuery;
window.parseNaturalTimeAndDuration = parseNaturalTimeAndDuration;
window.resolveItalianNaturalDate = resolveItalianNaturalDate;
window.getDeterministicAppGuide = getDeterministicAppGuide;