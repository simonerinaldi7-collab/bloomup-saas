// =========================================================================
// 🤖 VAIMUP AGENT CORE - AUTONOMOUS BUSINESS AGENT & SIMULATION ENGINE
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
        pendingAction: null // Human-In-The-Loop safety gate state
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
                console.error("❌ [AI Core] Errore nel parsing del blocco JSON:", innerErr, rawText);
                return null;
            }
        }
        return null;
    }
}

/**
 * Risolutore deterministico avanzato di orari e durate in italiano
 */
function parseNaturalTimeAndDuration(queryStr) {
    const q = (queryStr || '').toLowerCase();
    let time = null;
    let durationMinutes = 60;

    // Riconoscimento "alle 16:30", "alle 4 del pomeriggio", "ore 9", "18.30"
    const timeMatch = q.match(/(?:alle|ore|dalle)\s*([0-1]?[0-9]|2[0-3])(?:[:.]([0-5][0-9]))?/i);
    if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = timeMatch[2] ? timeMatch[2] : '00';
        if ((q.includes('del pomeriggio') || q.includes('di sera') || q.includes('pomeriggio')) && h < 12) {
            h += 12;
        }
        time = `${String(h).padStart(2, '0')}:${m}`;
    }

    // Durate colloquiali
    if (q.includes("un'ora e mezza") || q.includes('90 minuti') || q.includes('1 ora e mezza')) {
        durationMinutes = 90;
    } else if (q.includes("mezz'ora") || q.includes('30 minuti') || q.includes('mezza ora')) {
        durationMinutes = 30;
    } else if (q.includes('due ore') || q.includes('2 ore') || q.includes('120 minuti')) {
        durationMinutes = 120;
    } else if (q.includes('tre quarti d\'ora') || q.includes('45 minuti')) {
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
    if (q.includes('oggi') || q.includes('stasera') || q.includes('pomeriggio')) {
        return toYmd(referenceDate);
    }

    // "tra X giorni"
    const inDaysMatch = q.match(/tra\s+(\d+)\s+giorn/i);
    if (inDaysMatch) {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() + parseInt(inDaysMatch[1], 10));
        return toYmd(d);
    }

    // "tra due settimane"
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

    // Giorni della settimana (lunedì, martedì...)
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

    // Date esplicite (es. 25/11/2026, 25-11-2026, 25 novembre)
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

/**
 * Risoluzione e recupero proattivo della chiave API con supporto Gemini nativo & OpenRouter
 */
async function resolveAndLoadAiKey() {
    if (window._runtimeAiKey && window._runtimeAiKey.length > 15 && !window._runtimeAiKey.includes("INSERISCI")) {
        return window._runtimeAiKey;
    }
    if (typeof loadSecureAiKey === 'function') {
        const key = await loadSecureAiKey();
        if (key) return key;
    }
    return null;
}

/**
 * Pipeline di Intelligenza Artificiale Duale: Supporta Google Gemini nativo (AIza...) e OpenRouter (Bearer)
 */
async function callAiModelWithFallback(systemPrompt, userQuery) {
    const apiKey = await resolveAndLoadAiKey();

    if (!apiKey || apiKey.includes("INSERISCI")) {
        throw new Error("API_KEY_MISSING");
    }

    const isGoogleKey = apiKey.startsWith("AIza");

    // CASO A: Endpoint Google Gemini 2.0 Flash Nativo
    if (isGoogleKey) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
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

        if (!response.ok) {
            // Fallback trasparente su gemini-1.5-flash in caso di saturazione temporanea
            const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
            const fbRes = await fetch(fallbackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ parts: [{ text: userQuery }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: "application/json" }
                })
            });

            if (!fbRes.ok) {
                const errText = await fbRes.text();
                throw new Error(`Gemini HTTP Error: ${errText}`);
            }
            const fbData = await fbRes.json();
            return fbData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    // CASO B: Endpoint OpenRouter Multi-Provider
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': 'VaiMUp Agent Core'
        },
        body: JSON.stringify({
            model: "google/gemini-2.0-flash-001",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userQuery }
            ],
            temperature: 0.1,
            max_tokens: 800
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter HTTP Error ${response.status}: ${errText}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
}
/**
 * Salvataggio manuale istantaneo della chiave API su Supabase Cloud e Dexie
 */
async function saveAiApiKey(newKey) {
    if (!newKey || newKey.trim().length < 15) {
        alert("Inserisci una chiave API valida (es. Google Gemini che inizia per 'AIza...' o OpenRouter che inizia per 'sk-or-...')");
        return false;
    }
    const cleanKey = newKey.trim();
    const currentSalon = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id)
        ? currentUser.salon_id
        : 'SALON_001';

    window._runtimeAiKey = cleanKey;
    localStorage.setItem('vaimup_ai_runtime_key', cleanKey);
    localStorage.setItem(`vaimup_ai_key_${currentSalon.toLowerCase()}`, cleanKey);

    if (typeof sysSettings !== 'undefined') {
        sysSettings['gemini_api_key'] = cleanKey;
    }

    // 1. Salvataggio locale in Dexie
    if (typeof localDb !== 'undefined' && localDb && localDb.settings) {
        await localDb.settings.put({
            key: 'gemini_api_key',
            value: cleanKey,
            salon_id: currentSalon,
            updated_at: new Date().toISOString()
        });
    }

    // 2. Salvataggio su Supabase Cloud
    const supUrl = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || 'https://uartaeqbcfxxsyksbnty.supabase.co';
    const supKey = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.key) || 'sb_publishable_Yc8oSL4T29eecI39CLxiOg_3W1sbyYz';

    if (navigator.onLine && supUrl && supKey) {
        try {
            await fetch(`${supUrl}/rest/v1/settings?on_conflict=key,salon_id`, {
                method: 'POST',
                headers: {
                    'apikey': supKey,
                    'Authorization': 'Bearer ' + supKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates'
                },
                body: JSON.stringify({
                    key: 'gemini_api_key',
                    value: cleanKey,
                    salon_id: currentSalon,
                    updated_at: new Date().toISOString()
                })
            });
            console.log("☁️ [AI KEY SYNC] Chiave sincronizzata con successo su Supabase.");
        } catch (e) {
            console.warn("Avviso sincronizzazione cloud chiave IA:", e);
        }
    }
    return true;
}
window.saveAiApiKey = saveAiApiKey;

/**
 * Prompt interattivo per inserire la chiave API direttamente dalla chat
 */
window.promptConfigureAiKey = async function() {
    const key = prompt("Incolla qui la tua chiave API (Google Gemini 'AIza...' o OpenRouter 'sk-...'):");
    if (!key) return;

    const ok = await saveAiApiKey(key);
    if (ok) {
        alert("✅ Chiave API memorizzata con successo!\nOra l'Assistente IA di VaiMUp è attivo e pronto a rispondere.");
        if (typeof sendAIQuery === 'function') {
            const input = document.getElementById('ai-user-input');
            if (input && !input.value) input.value = "Chi ho in agenda per oggi?";
            sendAIQuery();
        }
    }
};

/**
 * Gestore principale delle query utente per VaiMUp Agent Core
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

    // 1. Controllo Human-In-The-Loop per azioni in attesa di conferma
    if (window._aiAgentContext.pendingAction) {
        return await handlePendingConfirmationInput(rawQuery);
    }

    // 2. Risoluzione temporale deterministica locale
    const deterministicDate = resolveItalianNaturalDate(q, now);
    const { time: deterministicTime, durationMinutes: deterministicDuration } = parseNaturalTimeAndDuration(q);

    // 3. Idratazione indici locali per prompt grounding (segregati strettamente per salon_id)
    const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
    const customerNames = customers.map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim()).filter(Boolean);

    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const services = inventory.filter(i => i.type === 'servizio');
    const products = inventory.filter(i => i.type === 'prodotto');

    const users = await window.universalQuery({ action: 'GET_ALL', table: 'users' }) || [];
    const operatorNames = users.map(u => u.username).filter(Boolean);

    // Costruzione del System Prompt con Regole Deterministiche Zero-Hallucination
    const systemPrompt = `Sei il motore NLU e Business Brain di "VaiMUp", gestionale B2B per retail, bellezza e coworking saloni.
Oggi è ${dayOfWeekName}, ${todayStr} (Orario corrente: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}).
Salone ID attivo: "${salonId}".
Memoria attiva: UltimoCliente="${window._aiAgentContext.lastCustomer || 'Nessuno'}", UltimoProdotto="${window._aiAgentContext.lastProduct || 'Nessuno'}", UltimoAppId="${window._aiAgentContext.lastAppointmentId || 'Nessuno'}".

REGOLE RIGIDE ZERO-HALLUCINATION:
1. NON effettuare mai calcoli finanziari o stime numeriche arbitrarie nel testo.
2. Identifica esclusivamente l'intento e restituisci SOLO un oggetto JSON aderente allo schema specificato.
3. Se l'utente usa pronomi ("suoi", "di lui", "di lei", "spostalo", "cancellalo", "quanto ha speso?"), risolvi il riferimento usando la memoria attiva.
4. Per le simulazioni strategiche ("Cosa succede se aumento i prezzi del 10%", "Se l'affitto aumenta di 300€"), usa l'azione "WHAT_IF_SIMULATION".

SCHEMA JSON DI RISPOSTA:
{
  "action": "CREATE_APPOINTMENT" | "MOVE_APPOINTMENT" | "DELETE_APPOINTMENT" | "GET_APPOINTMENTS" | "CREATE_CUSTOMER" | "GET_CUSTOMER_INFO" | "CREATE_EXPENSE" | "GET_EXPENSES" | "STOCK_ADJUSTMENT" | "GET_STOCK_STATUS" | "ANALYTICS_QUERY" | "WHAT_IF_SIMULATION" | "UNKNOWN",
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
  "simulationCategory": string o null
}

Clienti noti: ${JSON.stringify(customerNames.slice(0, 40))}.
Servizi noti: ${JSON.stringify(services.map(s => s.name).slice(0, 30))}.
Prodotti noti: ${JSON.stringify(products.map(p => p.name).slice(0, 30))}.
Operatori disponibili: ${JSON.stringify(operatorNames)}.`;

   let parsed = null;
    try {
        const rawResponse = await callAiModelWithFallback(systemPrompt, rawQuery);
        parsed = extractAndSanitizeJson(rawResponse);
    } catch (err) {
        if (err.message === "API_KEY_MISSING") {
            // Risposta formale e pulita: nessun input o chiave mostrata a video
            return "🤖 Il servizio di intelligenza artificiale non è al momento abilitato per questa postazione. Contatta l'amministratore del sistema per l'attivazione.";
        }
        console.warn("⚠️ [AI Pipeline Warning] Fallback locale attivato:", err.message);
        parsed = fallbackHeuristicIntentClassifier(q, todayStr);
    }
    if (!parsed) {
        parsed = fallbackHeuristicIntentClassifier(q, todayStr);
    }

    // Integrazione delle risoluzioni temporali deterministiche locali se l'LLM non le ha colte
    if (deterministicDate && (!parsed.date || parsed.date === 'null')) {
        parsed.date = deterministicDate;
    }
    if (deterministicTime && (!parsed.time || parsed.time === 'null')) {
        parsed.time = deterministicTime;
    }
    if (deterministicDuration && !parsed.durationMinutes) {
        parsed.durationMinutes = deterministicDuration;
    }

    // Risoluzione dei riferimenti con la memoria attiva
    if (!parsed.customerName && window._aiAgentContext.lastCustomer && (q.includes('suoi') || q.includes('di lui') || q.includes('di lei') || q.includes('lui') || q.includes('lei') || q.includes('spost') || q.includes('cancell') || q.includes('elimina'))) {
        parsed.customerName = window._aiAgentContext.lastCustomer;
    }

    // Aggiornamento della memoria di sessione
    if (parsed.customerName) window._aiAgentContext.lastCustomer = parsed.customerName;
    if (parsed.serviceName) window._aiAgentContext.lastService = parsed.serviceName;
    if (parsed.productName) window._aiAgentContext.lastProduct = parsed.productName;
    if (parsed.date) window._aiAgentContext.lastDate = parsed.date;

    // Dispatch deterministico dell'azione
    return await dispatchDeterministicAgentAction(parsed, rawQuery, todayStr, salonId);
}

/**
 * Dispatcher deterministico con gating HITL e simulazione preventiva
 */
async function dispatchDeterministicAgentAction(parsed, rawQuery, todayStr, salonId) {
    const action = parsed.action || 'UNKNOWN';

    // =========================================================================
    // 1. WRITE: APPOINTMENT CREATION (FASE 1: SIMULAZIONE & HITL GATE)
    // =========================================================================
    if (action === 'CREATE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) {
            return "⚠️ Per quale cliente desideri inserire l'appuntamento? Specificane il nome.";
        }

        const targetDate = parsed.date || todayStr;
        const targetTime = parsed.time || "09:00";
        const durationMinutes = parsed.durationMinutes || 60;
        const serviceName = parsed.serviceName || "Trattamento Generico";
        const assignedOperator = parsed.operatorName || (typeof currentUser !== 'undefined' && currentUser ? currentUser.username : 'admin');

        // Calcolo orario di fine
        const [h, m] = targetTime.split(':').map(Number);
        const endTotalMin = (h * 60 + m) + durationMinutes;
        const targetEndTime = `${String(Math.floor(endTotalMin / 60) % 24).padStart(2, '0')}:${String(endTotalMin % 60).padStart(2, '0')}`;

        // Convalida vincoli turni operatore
        const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
        const dateObj = new Date(targetDate + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();
        const opSchedule = schedules.find(s => (s.username || '').trim().toLowerCase() === assignedOperator.trim().toLowerCase() && Number(s.day_of_week) === dayOfWeek);

        let warningNotes = [];
        if (!opSchedule || Number(opSchedule.is_working) !== 1) {
            warningNotes.push(`⚠️ L'operatore <b>${assignedOperator}</b> risulta a riposo in data ${targetDate}.`);
        }

        // Convalida sovrapposizioni agenda
        const existingApps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const overlap = existingApps.find(a => {
            if (a.date !== targetDate) return false;
            if ((a.assigned_user || 'admin').toLowerCase() !== assignedOperator.toLowerCase()) return false;
            const aStart = a.time ? a.time.substring(0, 5) : '00:00';
            const aEnd = a.end_time ? a.end_time.substring(0, 5) : '23:59';
            return targetTime < aEnd && targetEndTime > aStart;
        });

        if (overlap) {
            warningNotes.push(`⚠️ Conflitto d'orario: <b>${assignedOperator}</b> ha già un impegno con <b>${overlap.cust_name}</b> (${overlap.time} - ${overlap.end_time || ''}).`);
        }

        // Recupero prezzo di listino deterministico
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

        // Armo la conferma Human-In-The-Loop
        window._aiAgentContext.pendingAction = {
            type: 'CREATE_APPOINTMENT',
            payload: appPayload,
            summary: `Appuntamento per **${custName}** il **${targetDate}** dalle **${targetTime}** alle **${targetEndTime}** (${appPayload.service}, Op: ${assignedOperator}, Prezzo stimato: € ${estimatedPrice.toFixed(2)})`
        };

        let responseText = `📋 **Simulazione Creazione Appuntamento:**\n` +
            `- **Cliente:** ${custName}\n` +
            `- **Data:** ${targetDate}\n` +
            `- **Orario:** ${targetTime} - ${targetEndTime} (${durationMinutes} min)\n` +
            `- **Trattamento:** ${appPayload.service}\n` +
            `- **Operatore:** ${assignedOperator}\n` +
            `- **Prezzo Stimato:** € ${estimatedPrice.toFixed(2)}\n`;

        if (warningNotes.length > 0) {
            responseText += `\n${warningNotes.join('\n')}\n`;
        }

        responseText += `\n❓ Vuoi procedere con il salvataggio? Rispondi **"Sì" / "Conferma"** oppure **"Annulla"**.\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma ed Inserisci</button>` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:700;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;

        return responseText;
    }

    // =========================================================================
    // 2. WRITE: MOVE APPOINTMENT (FASE 1: SIMULAZIONE & HITL GATE)
    // =========================================================================
    if (action === 'MOVE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Di quale cliente desideri spostare l'appuntamento?";

        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const upcomingApps = appointments.filter(a => {
            const matchName = (a.cust_name || '').toLowerCase().includes(custName.toLowerCase());
            return matchName && a.date >= todayStr;
        }).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        if (upcomingApps.length === 0) {
            return `⚠️ Non ho trovato appuntamenti futuri in programma per **${custName}**.`;
        }

        const targetApp = upcomingApps[0];
        const newDate = parsed.date || targetApp.date;
        const newTime = parsed.time || targetApp.time;

        // Calcolo nuova ora fine
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
            `- **Servizio:** ${targetApp.service || 'Trattamento'}\n` +
            `- **Precedente:** ${targetApp.date} ore ${targetApp.time}\n` +
            `- **Nuovo Orario Proposto:** **${newDate}** dalle **${newTime}** alle **${newEndTimeStr}**\n\n` +
            `❓ Confermi lo spostamento? Rispondi **"Conferma"** o **"Annulla"**.\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma Spostamento</button>` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:700;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;
    }

    // =========================================================================
    // 3. WRITE: DELETE APPOINTMENT (FASE 1: CONFERMA HITL)
    // =========================================================================
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

        return `⚠️ **Conferma Cancellazione Appuntamento:**\n` +
            `Sei sicuro di voler eliminare l'appuntamento di **${match.cust_name}** previsto per il **${match.date}** alle **${match.time}** (${match.service || 'Servizio'})?\n\n` +
            `Rispondi con **"Conferma"** o tocca il pulsante sottostante:\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">🗑️ Elimina Definitivamente</button>` +
            `<button type="button" class="btn" style="padding:6px 14px; font-size:12px; background:#f1f5f9; color:#475569;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;
    }

    // =========================================================================
    // 4. WRITE: EXPENSE REGISTRATION (FASE 1: SIMULAZIONE & HITL)
    // =========================================================================
    if (action === 'CREATE_EXPENSE') {
        const desc = parsed.expenseDescription || "Spesa gestionale";
        const amt = parseFloat(parsed.expenseAmount) || 0;
        const expDate = parsed.date || todayStr;

        if (amt <= 0) {
            return "⚠️ Qual è l'importo della spesa da registrare? Specifica l'ammontare in Euro.";
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
            `- **Data:** ${expDate}\n\n` +
            `❓ Confermi la registrazione a bilancio?\n` +
            `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
            `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma Spesa</button>` +
            `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
            `</div>`;
    }

    // =========================================================================
    // 5. READ: GET APPOINTMENTS (DETERMINISTICO)
    // =========================================================================
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
            return `📅 Nessun appuntamento trovato${custName ? ' per **' + custName + '**' : ''}${targetDate ? ' in data ' + targetDate : ' da oggi in poi'}.`;
        }

        let reply = `📅 **Appuntamenti individuati (${filtered.length}):**\n`;
        filtered.slice(0, 8).forEach(a => {
            const timeStr = a.time ? a.time.substring(0, 5) : '--:--';
            reply += `- **${a.date}** ore **${timeStr}**: 👤 ${a.cust_name} — *${a.service || 'Trattamento'}* (Op: ${a.assigned_user || 'Admin'})\n`;
        });
        if (filtered.length > 8) {
            reply += `\n*(Visualizzati i primi 8 appuntamenti su ${filtered.length})*`;
        }
        return reply;
    }

    // =========================================================================
    // 6. READ: DETERMINISTIC BUSINESS ANALYTICS (MARGINI COMPETENZA, RFM, TARGET)
    // =========================================================================
    if (action === 'ANALYTICS_QUERY') {
        return await computeDeterministicSalonAnalytics(parsed, salonId, todayStr);
    }

    // =========================================================================
    // 7. STRATEGIC ENGINE: "WHAT-IF" SCENARIO SIMULATIONS
    // =========================================================================
    if (action === 'WHAT_IF_SIMULATION') {
        return await executeDeterministicWhatIfSimulation(parsed, salonId, todayStr);
    }

    // =========================================================================
    // 8. READ: STOCK STATUS & LOTTI FIFO
    // =========================================================================
    if (action === 'GET_STOCK_STATUS') {
        const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
        const prods = inventory.filter(i => i.type === 'prodotto');
        const low = prods.filter(p => (parseFloat(p.stock) || 0) <= (parseFloat(p.min_stock) || 0));

        if (low.length === 0) {
            return `📦 **Stato Magazzino:** Ottime notizie! Tutti i **${prods.length} prodotti** a magazzino sono attualmente sopra la soglia di scorta minima.`;
        }
        let reply = `⚠️ **Prodotti Sotto Scorta (${low.length} su ${prods.length}):**\n`;
        low.slice(0, 10).forEach(p => {
            reply += `- **${p.name}**: giacenza attuale **${p.stock}** (soglia minima: ${p.min_stock})\n`;
        });
        return reply;
    }

    return "🤖 Ho compreso la richiesta, ma non ho identificato un'azione operativa definita. Puoi chiedermi di inserire o spostare appuntamenti, calcolare i margini o simulare scenari What-If di listino o costi.";
}

/**
 * Gestione dello stato Human-In-The-Loop su input utente
 */
async function handlePendingConfirmationInput(rawQuery) {
    const q = rawQuery.toLowerCase().trim();
    const isApproval = q === 'sì' || q === 'si' || q.includes('conferma') || q.includes('procedi') || q.includes('confermo') || q.includes('esegui') || q.includes('ok');
    const isCancel = q === 'no' || q.includes('annulla') || q.includes('cancella') || q.includes('lascia stare') || q.includes('ferma');

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

    window._aiAgentContext.pendingAction = null; // Disarmo preventivo

    try {
        if (actionState.type === 'CREATE_APPOINTMENT') {
            const payload = actionState.payload;
            await window.universalQuery({ action: 'INSERT', table: 'appointments', data: payload });

            if (typeof refreshAllData === 'function') await refreshAllData();
            if (typeof renderCalendar === 'function') renderCalendar();

            window._aiAgentContext.lastAppointmentId = payload.id;
            return `✅ **Operazione completata con successo!**\nAppuntamento registrato in agenda per **${payload.cust_name}** il **${payload.date}** alle ore **${payload.time}** (${payload.service}).`;
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

/**
 * Revoca e disarmo dell'azione in attesa
 */
function cancelAiPendingAction() {
    window._aiAgentContext.pendingAction = null;
    return "❌ **Operazione annullata su tua richiesta.** Nessuna modifica è stata apportata al database.";
}
window.cancelAiPendingAction = cancelAiPendingAction;

/**
 * Modulo Business Intelligence: Calcolo Deterministico Margini e Indicatori di Performance
 */
async function computeDeterministicSalonAnalytics(parsed, salonId, todayStr) {
    const type = parsed.analyticsType;
    const custName = parsed.customerName || window._aiAgentContext.lastCustomer;

    // A. Analisi Spesa Singolo Cliente
    if (custName && (type === 'TOP_CLIENTS' || !type)) {
        const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
        const target = customers.find(c => `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(custName.toLowerCase()));

        if (!target) return `⚠️ Nessun cliente registrato trovato con il nome "${custName}".`;

        const sales = await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || [];
        const custSales = sales.filter(s => s.cust_id === target.id);
        const totalSpent = custSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);

        const apps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const custApps = apps.filter(a => (a.cust_name || '').toLowerCase().includes(custName.toLowerCase()));

        return `👤 **Dossier Finanziario Cliente: ${target.first_name} ${target.last_name}**\n` +
            `- **Cellulare:** ${target.phone || 'Non presente'}\n` +
            `- **Visite/Scontrini registrati:** ${custSales.length}\n` +
            `- **Volume d'affari complessivo:** **€ ${totalSpent.toFixed(2)}**\n` +
            `- **Scontrino medio:** € ${(custSales.length > 0 ? totalSpent / custSales.length : 0).toFixed(2)}\n` +
            `- **Appuntamenti storici:** ${custApps.length}`;
    }

    // B. Margini di Competenza Reale del Salone (Mese Corrente)
    if (type === 'MARGINS' || !type) {
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
        });

        const expenses = await window.universalQuery({ action: 'GET_ALL', table: 'expenses' }) || [];
        const monthExpenses = expenses.filter(e => e.date && e.date.startsWith(currentMonth));
        const totalExp = monthExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        const netProfit = totalSalonCompetence - totalExp;

        return `📊 **Riepilogo Economico Deterministico (Mese ${currentMonth}):**\n` +
            `- **Fatturato Lordo:** € ${totalTurnover.toFixed(2)}\n` +
            `- **Competenza Netta Salone (post-CV & Fornitori):** **€ ${totalSalonCompetence.toFixed(2)}**\n` +
            `- **Spese Fisse Registrate:** € ${totalExp.toFixed(2)}\n` +
            `- **Margine Operativo Netto:** **€ ${netProfit.toFixed(2)}** (${totalSalonCompetence > 0 ? ((netProfit / totalSalonCompetence) * 100).toFixed(1) : 0}% sul valore netto)`;
    }

    return "📊 Analisi completata. Puoi consultare i dettagli completi nella sezione Dashboard e Bilancio.";
}

/**
 * Motore Deterministico di Simulazione Scenari "What-If"
 */
async function executeDeterministicWhatIfSimulation(parsed, salonId, todayStr) {
    const simType = parsed.simulationType;
    const param = parseFloat(parsed.simulationParam) || 10; // Default 10%

    // 1. WHAT-IF: SENSITIVITY PRICE (Variazione Listino Prezzi)
    if (simType === 'PRICE_SENSITIVITY' || parsed.serviceName || parsed.simulationCategory) {
        const catFilter = (parsed.simulationCategory || parsed.serviceName || '').toLowerCase().trim();
        const pctIncrease = param; // Es. 10 per +10%

        // Analisi storica ultimi 90 giorni da sale_items
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
            return `🔮 **Simulazione Prezzi (${catFilter || 'Tutti i servizi'}):**\nNegli ultimi 90 giorni non risultano vendite registrate per questa voce da cui estrarre una base statistica.`;
        }

        // Proiezione mensile basata su elasticità tipica dei saloni (ritenzione volume al 97% con aumento del 10%)
        const monthlyVolBase = (historicalVol / 3);
        const monthlyRevBase = (historicalRev / 3);
        const simulatedUnitGainPct = (pctIncrease / 100);
        const simulatedRetentionPct = Math.max(1 - (simulatedUnitGainPct * 0.3), 0.90); // Elasticità -0.3

        const simulatedMonthlyRev = monthlyRevBase * (1 + simulatedUnitGainPct) * simulatedRetentionPct;
        const netDeltaMonthly = simulatedMonthlyRev - monthlyRevBase;
        const netDeltaYearly = netDeltaMonthly * 12;

        return `🔮 **Simulazione Strategica What-If: Aumento Listino +${pctIncrease}% (${catFilter || 'Servizi'})**\n\n` +
            `📈 **Dati Storici Rilevati (ultimi 90 giorni):**\n` +
            `- Volume medio mensile: **${Math.round(monthlyVolBase)} trattamenti**\n` +
            `- Fatturato base mensile: € ${monthlyRevBase.toFixed(2)}\n\n` +
            `🎯 **Proiezione Modellata (con ritenzione stimata del ${(simulatedRetentionPct * 100).toFixed(0)}%):**\n` +
            `- Nuovo incasso stimato: **€ ${simulatedMonthlyRev.toFixed(2)} / mese**\n` +
            `- Guadagno netto addizionale: **+€ ${netDeltaMonthly.toFixed(2)} al mese** (+€ ${netDeltaYearly.toFixed(2)} / anno)\n\n` +
            `💡 *L'impatto sul margine operativo è immediato poiché i costi vivi dei consumabili restano invariati.*`;
    }

    // 2. WHAT-IF: IMPATTO AUMENTO COSTI FISSI SU BREAK-EVEN E TARGET GIORNALIERO
    if (simType === 'EXPENSE_IMPACT' || parsed.expenseAmount) {
        const addedExpense = parseFloat(parsed.expenseAmount) || param || 300;
        const now = new Date();
        const currentMonth = todayStr.substring(0, 7);
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const daysInMonth = new Date(year, month, 0).getDate();

        // Calcolo giorni lavorativi residui
        const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
        let workingDaysRemaining = 0;
        for (let d = now.getDate(); d <= daysInMonth; d++) {
            const dObj = new Date(year, month - 1, d);
            const dow = dObj.getDay();
            const activeOnDay = schedules.some(s => Number(s.day_of_week) === dow && Number(s.is_working) === 1);
            if (activeOnDay || dow !== 0) workingDaysRemaining++;
        }
        workingDaysRemaining = Math.max(workingDaysRemaining, 1);

        // Calcolo scontrino medio negli ultimi 60 giorni
        const sales = await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || [];
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const limitStr = sixtyDaysAgo.toISOString().split('T')[0];
        const recentSales = sales.filter(s => s.date >= limitStr);
        const totalRev = recentSales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const avgTicket = recentSales.length > 0 ? (totalRev / recentSales.length) : 40;

        const extraDailyRevenueRequired = addedExpense / workingDaysRemaining;
        const extraTreatmentsPerDay = (extraDailyRevenueRequired / avgTicket);

        return `🎯 **Simulazione Impatto Spesa: +€ ${addedExpense.toFixed(2)} / mese**\n\n` +
            `- **Giorni lavorativi residui nel mese:** ${workingDaysRemaining} giorni\n` +
            `- **Scontrino medio storico del negozio:** € ${avgTicket.toFixed(2)}\n\n` +
            `⚖️ **Nuovo Obiettivo di Pareggio (Break-Even):**\n` +
            `- Incasso giornaliero extra richiesto: **+€ ${extraDailyRevenueRequired.toFixed(2)} / giorno**\n` +
            `- Trattamenti addizionali necessari: **+${extraTreatmentsPerDay.toFixed(1)} clienti al giorno** (oppure circa ${Math.ceil(addedExpense / avgTicket)} clienti in più nel mese).`;
    }

    // 3. WHAT-IF: SATURAZIONE CAPACITÀ E STAFF
    if (simType === 'STAFF_CAPACITY') {
        const extraHours = param || 8;
        const avgTicket = 45;
        const treatmentsPerHour = 1;
        const maxCapacityTreatments = extraHours * treatmentsPerHour;
        const expectedSaturationPct = 0.75; // 75% occupazione stimata
        const potentialRevenue = maxCapacityTreatments * expectedSaturationPct * avgTicket;

        return `⚡ **Simulazione Ottimizzazione Staff: +${extraHours} ore straordinario (es. Sabato)**\n\n` +
            `- **Capacità massima teorica:** ${maxCapacityTreatments} trattamenti\n` +
            `- **Saturazione attesa (75% occupazione slot):** ~${Math.round(maxCapacityTreatments * expectedSaturationPct)} clienti serviti\n` +
            `- **Potenziale fatturato aggiuntivo per turno:** **+€ ${potentialRevenue.toFixed(2)} a giornata** (+€ ${(potentialRevenue * 4).toFixed(2)} al mese su 4 sabati).`;
    }

    return "🔮 Parametri di simulazione non specificati. Puoi chiedermi ad esempio: *'Cosa succede se aumento del 10% il listino colori?'* oppure *'Se l'affitto aumenta di 300€ al mese, quanti trattamenti in più servono?'*";
}

/**
 * Classificatore euristico di sicurezza offline/fallback
 */
function fallbackHeuristicIntentClassifier(q, todayStr) {
    if (q.includes('conferma') || q.includes('procedi') || q.includes('sì') || q.includes('si')) {
        return { action: 'CONFIRM_ACTION' };
    }
    if (q.includes('annulla') || q.includes('cancella operazione') || q.includes('lascia stare')) {
        return { action: 'CANCEL_ACTION' };
    }
    if (q.includes('cosa succede se') || q.includes('se aumento') || q.includes('aumento del') || q.includes('se l\'affitto') || q.includes('se le spese')) {
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
    if (q.includes('spesa') || q.includes('costo') || q.includes('uscita')) {
        const amtMatch = q.match(/(\d+(?:[.,]\d{1,2})?)\s*€?/);
        return {
            action: amtMatch ? 'CREATE_EXPENSE' : 'GET_EXPENSES',
            expenseAmount: amtMatch ? parseFloat(amtMatch[1].replace(',', '.')) : 0
        };
    }
    if (q.includes('sotto scorta') || q.includes('scorte') || q.includes('magazzino')) {
        return { action: 'GET_STOCK_STATUS' };
    }
    if (q.includes('margine') || q.includes('guadagno') || q.includes('fatturato') || q.includes('quanto ha speso')) {
        return { action: 'ANALYTICS_QUERY' };
    }
    return { action: 'UNKNOWN' };
}

// =========================================================================
// 🎙️ SISTEMA VOCALE PROFESSIONALE PUSH-TO-TALK & SPEECH SYNTHESIS
// =========================================================================

let pttSpeechRecognizer = null;
let isPttListening = false;

function togglePushToTalkVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        return alert("Il tuo browser non supporta il riconoscimento vocale. Consigliamo l'uso di Google Chrome o Microsoft Edge.");
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

                sendAIQuery();
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

/**
 * Lettura vocale sintetica ripulita da simboli markdown, codice ed emoji
 */
function speakAiResponse(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    if (!text) return;

    // Rimozione markdown, tag HTML, parentesi ed emoji
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

// Prompt rapidi e Drawer
function sendQuickAiPrompt(text) {
    const input = document.getElementById('ai-user-input');
    if (input) {
        input.value = text;
        sendAIQuery();
    }
}
window.sendQuickAiPrompt = sendQuickAiPrompt;

function sendQuickAiPromptDrawer(text) {
    const input = document.getElementById('ai-drawer-input');
    if (input) {
        input.value = text;
        sendAIDrawerQuery();
    }
}
window.sendQuickAiPromptDrawer = sendQuickAiPromptDrawer;

// Esportazioni globali
window.processAiAgentQuery = processAiAgentQuery;
window.parseNaturalTimeAndDuration = parseNaturalTimeAndDuration;
window.resolveItalianNaturalDate = resolveItalianNaturalDate;