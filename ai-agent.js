// =========================================================================
// 🤖 VAIMUP AUTONOMOUS AGENT CORE - UNIVERSAL TOOL-CALLING & REACT ENGINE
// Local-First Dexie.js + Supabase Multi-Tenant Architecture
// =========================================================================

if (!window._aiAgentContext) {
    window._aiAgentContext = {
        lastCustomer: null,
        lastCustomerId: null,
        lastProduct: null,
        lastDate: null,
        lastAppointmentId: null,
        pendingAction: null // Human-In-The-Loop confirmation state
    };
}

// -------------------------------------------------------------------------
// 1. KNOWLEDGE BASE APPLICATIVA (MANUALE OPERATIVO PER RISPOSTE "COME FARE")
// -------------------------------------------------------------------------
const VAIMUP_APP_MANUAL = `
MANUALE FUNZIONALITÀ GESTIONALE VAIMUP:
1. STORNO DI CASSA:
   - Si effettua da "📈 Report Vendite" nel menu laterale (sezione Gestione & Analisi).
   - Si individua la transazione usando i filtri e si clicca sul pulsante rosso "Storna" a destra.
   - Effetti automatici: le giacenze e i lotti FIFO di magazzino (prodotti e consumabili dei servizi) vengono ripristinati e l'incasso viene stornato dal bilancio.
2. CARICO MAGAZZINO & LOTTI FIFO:
   - Si effettua da "📦 Magazzino Prodotti".
   - Per carico veloce: pulsante "⚡ Scan & Carico" in alto con pistola laser o fotocamera.
   - Per carico manuale: icona "📦" nella riga del prodotto.
   - Crea un lotto FIFO con data, ora e costo unitario d'acquisto, registrando la spesa a bilancio se prodotto di proprietà.
3. PACCHETTI & CARNET:
   - Configurazione: da "🎁 Pacchetti & Carnet" -> "+ Nuovo Pacchetto". Si definisce prezzo e sedute incluse.
   - Vendita: in "🛒 Cassa & POS", selezionando il cliente e il pacchetto (anche a rate).
   - Riscatto: in Agenda, selezionando il cliente il sistema propone di scalare la seduta a € 0.00.
4. COWORKING & POSTAZIONI FISICHE:
   - Si gestiscono da "🏢 Spazi & Coworking" con blocco atomico anti-overbooking.
   - Gli altri saloni vedono la postazione occupata senza poter leggere i dati anagrafici del cliente finale (privacy GDPR).
5. STAMPA LISTINI:
   - Da "🖨️ Stampa & Listini", formati A4, A5, A3 e Poster Maxi 50x70 con drag & drop di loghi e testi.
6. BOOKING ONLINE (SELF-BOOKING):
   - I clienti prenotano 24/7 dal link o QR code senza installare app.
`;

// -------------------------------------------------------------------------
// 2. RISOLUZIONE CHIAVE IA DA SUPABASE (SILENZIOSA, ZERO UI)
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

// -------------------------------------------------------------------------
// 3. PIPELINE DI CHIAMATA LLM RESILIENTE
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

    // Endpoint OpenRouter con modelli verificati
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

// -------------------------------------------------------------------------
// 4. PARSER E SANITIZZATORE JSON RESILIENTE
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

// -------------------------------------------------------------------------
// 5. REGISTRY DEI TOOL UNIVERSALI (FUNZIONI ESEGUITE IN LOCALE SU DEXIE/SUPABASE)
// -------------------------------------------------------------------------

/**
 * TOOL 1: Ricerca Universale sul Database Locale (Dexie)
 */
async function tool_query_db({ table, search, filterField, filterValue, timeline }) {
    const todayStr = new Date().toISOString().split('T')[0];
    const nowTimeStr = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

    const records = await window.universalQuery({ action: 'GET_ALL', table: table }) || [];
    const customers = (table !== 'customers') ? (await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || []) : [];

    let results = records;

    // Ricerca testuale tokenizzata intelligente (Nome e Cognome invertiti, frammenti)
    if (search) {
        const cleanSearch = String(search).toLowerCase().trim();
        const tokens = cleanSearch.split(/\s+/).filter(t => t.length > 1);

        results = results.filter(row => {
            const rowText = JSON.stringify(row).toLowerCase();
            if (rowText.includes(cleanSearch)) return true;
            if (tokens.length > 0 && tokens.every(tok => rowText.includes(tok))) return true;

            // Se stiamo cercando appuntamenti di un cliente, incrocia con l'anagrafica clienti
            if (table === 'appointments' && customers.length > 0) {
                const appCustName = (row.cust_name || '').toLowerCase();
                const matchedCust = customers.find(c => {
                    const fn = (c.first_name || '').toLowerCase();
                    const ln = (c.last_name || '').toLowerCase();
                    return `${fn} ${ln}`.includes(cleanSearch) || `${ln} ${fn}`.includes(cleanSearch) || (fn && ln && cleanSearch.includes(fn) && cleanSearch.includes(ln));
                });
                if (matchedCust) {
                    if (row.cust_id && String(row.cust_id).trim() === String(matchedCust.id).trim()) return true;
                    if (appCustName.includes((matchedCust.first_name || '').toLowerCase())) return true;
                }
            }
            return false;
        });
    }

    // Filtro campo/valore esatto
    if (filterField && filterValue !== undefined) {
        results = results.filter(row => String(row[filterField]).toLowerCase() === String(filterValue).toLowerCase());
    }

    // Filtro temporale per appuntamenti (future | past | all)
    if (table === 'appointments' && timeline) {
        if (timeline === 'future') {
            results = results.filter(a => a.date > todayStr || (a.date === todayStr && (a.time || '') >= nowTimeStr));
            results.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        } else if (timeline === 'past') {
            results = results.filter(a => a.date < todayStr || (a.date === todayStr && (a.time || '') < nowTimeStr));
            results.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
        } else {
            results.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
        }
    }

    return {
        total_found: results.length,
        items: results.slice(0, 15) // Max 15 elementi per non sovraccaricare il prompt
    };
}

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

    // Servizi ordinati per margine totale reale
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
    } else if (category) {
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

    // Volume mensile modellato con ritenzione del 96%
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

/**
 * TOOL 4: Simulazione e Proposta di Scrittura con Gating HITL
 */
async function tool_propose_write({ action, table, data, id, summary }) {
    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id) ? currentUser.salon_id : 'SALON_001';

    // Convalida turni operatore se appuntamento
    let warnings = [];
    if (table === 'appointments' && data.date && data.assigned_user) {
        const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];
        const dateObj = new Date(data.date + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();
        const sched = schedules.find(s => (s.username || '').toLowerCase() === data.assigned_user.toLowerCase() && Number(s.day_of_week) === dayOfWeek);

        if (!sched || Number(sched.is_working) !== 1) {
            warnings.push(`⚠️ L'operatore ${data.assigned_user} risulta a riposo in data ${data.date}.`);
        }

        const existingApps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const conflict = existingApps.find(a => {
            if (id && a.id === id) return false;
            if (a.date !== data.date) return false;
            if ((a.assigned_user || 'admin').toLowerCase() !== data.assigned_user.toLowerCase()) return false;
            return data.time < (a.end_time || '23:59') && (data.end_time || '23:59') > a.time;
        });

        if (conflict) {
            warnings.push(`⚠️ Conflitto d'orario con ${conflict.cust_name} (${conflict.time} - ${conflict.end_time || ''}).`);
        }
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
        summary: summary || `${action} su ${table}`
    };

    return {
        simulation_status: "ARMED_FOR_CONFIRMATION",
        warnings: warnings,
        summary: summary,
        payload_details: payload
    };
}

// -------------------------------------------------------------------------
// 6. DISPATCHER ESECUTIVO DEI TOOL CHIAMATI DALL'AI
// -------------------------------------------------------------------------
async function executeAgentToolCall(toolCall) {
    const { tool, params } = toolCall;
    console.log(`⚡ [AGENT REASONING] Esecuzione Tool: ${tool}`, params);

    try {
        if (tool === 'query_db') {
            return await tool_query_db(params);
        }
        if (tool === 'get_analytics') {
            return await tool_get_analytics(params);
        }
        if (tool === 'simulate_what_if') {
            return await tool_simulate_what_if(params);
        }
        if (tool === 'propose_write') {
            return await tool_propose_write(params);
        }
    } catch (err) {
        console.error(`Errore esecuzione tool ${tool}:`, err);
        return { error: err.message };
    }

    return { error: `Tool ${tool} non riconosciuto.` };
}

// -------------------------------------------------------------------------
// 7. CONTROLLER DIALOGICO MULTI-TURN AUTONOMO (REACT LOOP)
// -------------------------------------------------------------------------
async function processAiAgentQuery(userQuery) {
    const rawQuery = (userQuery || '').trim();
    const q = rawQuery.toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const daysItalian = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
    const dayOfWeek = daysItalian[now.getDay()];

    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id) ? currentUser.salon_id : 'SALON_001';

    // 1. Gating Human-In-The-Loop: Risposta a conferma in corso
    if (window._aiAgentContext.pendingAction) {
        const isYes = q === 'sì' || q === 'si' || q.includes('conferma') || q.includes('procedi') || q.includes('esegui') || q.includes('ok');
        const isNo = q === 'no' || q.includes('annulla') || q.includes('cancella') || q.includes('lascia stare');

        if (isYes) return await confirmAiPendingAction();
        if (isNo) return cancelAiPendingAction();

        return `⚠️ C'è un'operazione in attesa di conferma:\n*${window._aiAgentContext.pendingAction.summary}*\n\nRispondi **"Conferma"** per procedere oppure **"Annulla"**.`;
    }

    // 2. Prompt di Sistema Autonomo con Tool Registry & App Knowledge
    const systemPrompt = `Sei l'Agente Autonomo Intelligente di "VaiMUp", gestionale B2B per retail, saloni di bellezza e coworking.
Oggi è ${dayOfWeek}, ${todayStr} (Orario: ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}).
Salone ID attivo: "${salonId}".
Memoria Conversazione: UltimoCliente="${window._aiAgentContext.lastCustomer || 'Nessuno'}".

HAI A DISPOSIZIONE QUESTI 4 TOOL OPERATIVI:
1. "query_db": cerca in qualsiasi tabella locale (es: table="appointments", customer="Nome", timeline="future"|"past"|"all").
2. "get_analytics": calcola margini reali, volumi, spese fisse e classifica servizi dal database.
3. "simulate_what_if": simula scenari (es: target="highest_margin"|"highest_volume"|"specific_service", value=5, unit="euro"|"percent").
4. "propose_write": prepara un inserimento, modifica o cancellazione con verifica preventiva dei turni e conferma HITL.

MANUALE DIRETTO FUNZIONALITÀ APP:
${VAIMUP_APP_MANUAL}

ISTRUZIONI DI RAGIONAMENTO:
- Se l'utente ti chiede "COME FARE" qualcosa (es: come fare uno storno, come caricare merce, come funziona il coworking), rispondi direttamente usando il manuale, SENZA chiamare tool.
- Se l'utente chiede dati (es: "i prossimi appuntamenti", "quelli completati", "tutti gli appuntamenti", "chi ho oggi"), risolvi i pronomi e chiama "query_db".
- Se l'utente chiede "che succede se aumento di 5 euro il servizio a più alta marginalità?", chiama "simulate_what_if" con target="highest_margin", value=5, unit="euro".
- Se l'utente vuole inserire o spostare qualcosa, chiama "propose_write".

FORMATO RISPOSTA:
Se devi usare un tool, rispondi con un oggetto JSON:
{
  "thought": "Cosa devo fare",
  "tool": "query_db" | "get_analytics" | "simulate_what_if" | "propose_write",
  "params": { ...parametri del tool... }
}

Se NON serve un tool (es. guida, spiegazione o chiarimento), rispondi con:
{
  "thought": "Spiegazione diretta da manuale",
  "answer": "Testo della risposta in italiano pulito..."
}`;

    // 3. FASE 1: L'AI RAGIONA E DECIDE SE CHIAMARE UN TOOL O RISPONDERE DIRETTAMENTE
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

    // Se l'AI ha già una risposta diretta (es. guida su come fare uno storno)
    if (firstDecision && firstDecision.answer) {
        return firstDecision.answer;
    }

    // Se l'AI ha deciso di chiamare un Tool
    if (firstDecision && firstDecision.tool) {
        // Eseguiamo il Tool in locale sul browser (< 5ms)
        const toolResult = await executeAgentToolCall(firstDecision);

        // Se era un'azione di scrittura, restituisce la simulazione e i pulsanti di conferma HITL
        if (firstDecision.tool === 'propose_write') {
            const sim = toolResult;
            let warnText = (sim.warnings && sim.warnings.length > 0) ? `\n${sim.warnings.join('\n')}\n` : '';

            return `📋 **Proposta Operativa (In attesa di conferma):**\n` +
                `- **Operazione:** ${sim.summary}\n` +
                warnText +
                `\n❓ Vuoi procedere con il salvataggio? Rispondi **"Conferma"** oppure tocca il pulsante:\n` +
                `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:8px;">` +
                `<button type="button" class="btn btn-s" style="padding:6px 14px; font-size:12px; font-weight:800;" onclick="window.confirmAiPendingAction()">✓ Conferma ed Esegui</button>` +
                `<button type="button" class="btn btn-d" style="padding:6px 14px; font-size:12px; font-weight:700;" onclick="window.cancelAiPendingAction()">✕ Annulla</button>` +
                `</div>`;
        }

        // 4. FASE 2: PASSIAMO I DATI ESTRATTI ALL'AI PER LA SINTESI FINALE
        const synthesisPrompt = `Hai interrogato il database locale con il tool "${firstDecision.tool}".
Risultati estratti in tempo reale dal database:
${JSON.stringify(toolResult, null, 2)}

Domanda originale dell'utente: "${rawQuery}"
Ultimo cliente in memoria: "${window._aiAgentContext.lastCustomer || 'Nessuno'}"

ISTRUZIONI PER LA RISPOSTA FINALE:
- Rispondi in italiano con tono professionale, caloroso e formale.
- Se cercavi appuntamenti futuri e non ce ne sono, ma ci sono appuntamenti passati nello storico, evidenzialo chiaramente indicando l'ultimo completato!
- Se è una simulazione What-If, spiega chiaramente l'aumento, l'impatto mensile e annuale.
- Non inventare dati che non sono presenti nei risultati del tool.`;

        try {
            const finalReply = await callAgentBrain([
                { role: "system", content: "Sei l'assistente ufficiale di VaiMUp. Sintetizza i risultati con precisione." },
                { role: "user", content: synthesisPrompt }
            ]);

            // Se la risposta è ancora JSON per errore, estrai il campo testo
            const parsedFinal = sanitizeJson(finalReply);
            const textToReturn = (parsedFinal && (parsedFinal.answer || parsedFinal.message)) ? (parsedFinal.answer || parsedFinal.message) : finalReply;

            // Aggiorna l'ultimo cliente se menzionato nei parametri
            if (firstDecision.params?.customer) {
                window._aiAgentContext.lastCustomer = firstDecision.params.customer;
            }

            return textToReturn;

        } catch (synthErr) {
            console.error("Errore sintesi finale agente:", synthErr);
            return `📊 Risultati estratti (${toolResult.total_found || 0} record trovati). Controlla la tabella corrispondente.`;
        }
    }

    return firstTurnRaw || "🤖 Ho elaborato la richiesta. Come posso esserti utile?";
}

// -------------------------------------------------------------------------
// 8. ESECUZIONE FASE 2 (CONFERMA ED ESECUZIONE SCRITTURA HUMAN-IN-THE-LOOP)
// -------------------------------------------------------------------------
async function confirmAiPendingAction() {
    const pending = window._aiAgentContext.pendingAction;
    if (!pending) return "⚠️ Nessuna operazione in attesa di conferma.";

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

        if (typeof refreshAllData === 'function') await refreshAllData();
        if (typeof renderCalendar === 'function') renderCalendar();
        if (typeof loadBalance === 'function') loadBalance();

        return `✅ **Operazione completata con successo!**\n${pending.summary} registrato nel database.`;
    } catch (err) {
        return `❌ Errore durante il salvataggio: ${err.message}`;
    }
}
window.confirmAiPendingAction = confirmAiPendingAction;

function cancelAiPendingAction() {
    window._aiAgentContext.pendingAction = null;
    return "❌ **Operazione revocata.** Nessuna modifica è stata effettuata al database.";
}
window.cancelAiPendingAction = cancelAiPendingAction;

// -------------------------------------------------------------------------
// 9. SPEECH SYNTHESIS & PUSH-TO-TALK PULITO
// -------------------------------------------------------------------------
function speakAiResponse(text) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();

    let clean = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/[*_~`#]/g, '')
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

// Esportazioni globali
window.processAiAgentQuery = processAiAgentQuery;
window.executeAgentToolCall = executeAgentToolCall;