// ai-agent-core.js - Resilient Agent Architecture for VaiMUp

if (!window._aiAgentContext) {
    window._aiAgentContext = {
        lastCustomer: null,
        lastProduct: null,
        lastDate: null,
        lastAppointmentId: null,
        pendingAction: null // For confirmation flows (e.g., 'CONFIRM_DELETE', 'CONFIRM_MOVE')
    };
}

/**
 * Bulletproof JSON extractor from LLM markdown/conversational output
 */
function extractAndSanitizeJson(rawText) {
    if (!rawText) return null;
    try {
        // Try direct parse first
        return JSON.parse(rawText.trim());
    } catch (e) {
        // Fallback: Extract everything between the first '{' and last '}'
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (innerErr) {
                console.error("❌ [AI Core] Failed to parse extracted JSON block:", innerErr);
                return null;
            }
        }
        return null;
    }
}

/**
 * Natural Language Time & Duration Parser in Italian
 */
function parseNaturalTimeAndDuration(queryStr) {
    const q = queryStr.toLowerCase();
    let time = "09:00";
    let durationMinutes = 60; // Default 1 hour

    // Match times like "alle 15", "alle 15:30", "ore 9"
    const timeMatch = q.match(/(?:alle|ore)\s*([0-1]?[0-9]|2[0-3])(?::([0-5][0-9]))?/i);
    if (timeMatch) {
        const h = timeMatch[1].padStart(2, '0');
        const m = timeMatch[2] ? timeMatch[2] : '00';
        time = `${h}:${m}`;
    }

    // Match durations like "un'ora e mezza", "45 minuti", "2 ore"
    if (q.includes('un\'ora e mezza') || q.includes('90 minuti')) {
        durationMinutes = 90;
    } else if (q.includes('mezz\'ora') || q.includes('30 minuti')) {
        durationMinutes = 30;
    } else if (q.includes('due ore') || q.includes('2 ore')) {
        durationMinutes = 120;
    } else {
        const durMatch = q.match(/(\d+)\s*minut/);
        if (durMatch) durationMinutes = parseInt(durMatch[1], 10);
    }

    return { time, durationMinutes };
}

// ai-agent-pipeline.js - Semantic Routing & Deterministic DB Execution

async function processAiAgentQuery(userQuery) {
    const q = userQuery.toLowerCase().trim();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const apiKey = window._runtimeAiKey || (window.AI_SECRET_CONFIG && window.AI_SECRET_CONFIG.geminiKey);
    if (!apiKey || apiKey.includes("INSERISCI")) {
        return "⚠️ La chiave API dell'intelligenza artificiale non è configurata nelle impostazioni.";
    }

    // Handle Pending Confirmations (Multi-turn safety check)
    if (window._aiAgentContext.pendingAction) {
        return await handlePendingConfirmation(userQuery);
    }

    // 1. Gather lightweight local index data for prompt grounding
    const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
    const customerNames = customers.map(c => `${c.first_name || ''} ${c.last_name || ''}`.trim());
    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const serviceNames = inventory.filter(i => i.type === 'servizio').map(i => i.name);

    const systemPrompt = `Sei il motore agente di VaiMUp, un gestionale SaaS per saloni beauty/retail.
Oggi è ${todayStr}.
Contesto precedente salvato: Ultimo Cliente="${window._aiAgentContext.lastCustomer || 'Nessuno'}".

REGOLE IMPORTANTI PER IL CONTESTO:
- Se l'utente usa pronomi come "suoi", "di lui", "di lei", "suocfr", o ripete solo il nome senza cognome (es. "di Simone"), devi fare riferimento all'ultimo cliente salvato in memoria ("${window._aiAgentContext.lastCustomer}") o cercare il cliente corrispondente.

Compito: Analizza la query dell'utente e restituisci SOLO un oggetto JSON valido (senza markdown o testo extra attorno):
{
  "action": "CREATE_APPOINTMENT" | "MOVE_APPOINTMENT" | "DELETE_APPOINTMENT" | "GET_APPOINTMENTS" | "CREATE_EXPENSE" | "ANALYTICS_QUERY" | "UNKNOWN",
  "customerName": "Nome Cognome del cliente (se l'utente dice 'i suoi', usa l'ultimo cliente in memoria)",
  "serviceName": "Nome del servizio se menzionato, altrimenti null",
  "date": "YYYY-MM-DD se specificata, altrimenti null",
  "time": "HH:MM se specificata, altrimenti null",
  "durationMinutes": 60,
  "expenseDescription": null,
  "expenseAmount": 0.0,
  "analyticsType": null
}
Clienti noti: ${JSON.stringify(customerNames.slice(0, 30))}.
Servizi noti: ${JSON.stringify(serviceNames)}.`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': window.location.origin,
                'X-Title': 'VaiMUp SaaS Agent'
            },
            body: JSON.stringify({
                model: "openrouter/free",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userQuery }
                ],
                temperature: 0.1,
                max_tokens: 300
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        const rawContent = result.choices?.[0]?.message?.content || "";
        
        const parsed = extractAndSanitizeJson(rawContent);
        if (!parsed) {
            return await executeHeuristicFallback(q, todayStr);
        }

        // Update Context State
        if (parsed.customerName) window._aiAgentContext.lastCustomer = parsed.customerName;
        if (parsed.serviceName) window._aiAgentContext.lastProduct = parsed.serviceName;

        // Route Actions Deterministically
        return await dispatchAgentAction(parsed, userQuery, todayStr);

    } catch (err) {
        console.error("❌ [AI Pipeline Error]:", err);
        return "⚠️ Si è verificato un errore di comunicazione con il motore IA. Riprova tra poco.";
    }
}

// ai-agent-dispatcher.js - Execution of Structured Intents

async function dispatchAgentAction(parsed, rawQuery, todayStr) {
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
    const action = parsed.action;

    // --- 1. WRITE: CREATE APPOINTMENT ---
    if (action === 'CREATE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Per quale cliente desideri fissare l'appuntamento?";

        const { time, durationMinutes } = parseNaturalTimeAndDuration(rawQuery);
        const targetDate = parsed.date || todayStr;
        const service = parsed.serviceName || "Trattamento";

        // Calculate end time
        const [h, m] = time.split(':').map(Number);
        const endMin = (h * 60 + m) + durationMinutes;
        const endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

        const appPayload = {
            id: crypto.randomUUID(),
            salon_id: salonId,
            cust_name: custName,
            date: targetDate,
            time: time,
            end_time: endTime,
            service: service,
            price: 0,
            assigned_user: currentUser ? currentUser.username : 'admin',
            notes: 'Creato tramite Assistente IA'
        };

        await window.universalQuery({ action: 'INSERT', table: 'appointments', data: appPayload });
        if (typeof refreshAllData === 'function') await refreshAllData();
        if (typeof renderCalendar === 'function') renderCalendar();

        return `✅ Appuntamento creato con successo per **${custName}** il **${targetDate}** alle **${time}** (${service}).`;
    }

    // --- 2. WRITE: MOVE APPOINTMENT ---
    if (action === 'MOVE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Di quale cliente vuoi spostare l'appuntamento?";

        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const custApps = appointments.filter(a => (a.cust_name || '').toLowerCase().includes(custName.toLowerCase()) && a.date >= todayStr);

        if (custApps.length === 0) return `⚠️ Non ho trovato appuntamenti futuri attivi per ${custName}.`;
        custApps.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        const targetApp = custApps[0]; // Nearest upcoming appointment

        const { time: newTime } = parseNaturalTimeAndDuration(rawQuery);
        const newDate = parsed.date || targetApp.date;

        await window.universalQuery({
            action: 'UPDATE',
            table: 'appointments',
            data: { date: newDate, time: newTime },
            id: targetApp.id
        });

        if (typeof refreshAllData === 'function') await refreshAllData();
        if (typeof renderCalendar === 'function') renderCalendar();

        return `✅ L'appuntamento di **${custName}** è stato spostato al **${newDate}** alle ore **${newTime}**.`;
    }

    // --- 3. WRITE: CONFIRMATION-GATED DELETE ---
    if (action === 'DELETE_APPOINTMENT') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Di quale cliente vuoi cancellare l'appuntamento?";

        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const match = appointments.find(a => (a.cust_name || '').toLowerCase().includes(custName.toLowerCase()) && a.date >= todayStr);

        if (!match) return `⚠️ Nessun appuntamento futuro trovato per ${match?.cust_name || custName}.`;

        // Arm pending confirmation state
        window._aiAgentContext.pendingAction = {
            type: 'DELETE_APPOINTMENT',
            appId: match.id,
            details: `${match.cust_name} il ${match.date} alle ${match.time}`
        };

        return `⚠️ Sei sicuro di voler eliminare l'appuntamento di **${match.cust_name}** previsto per il **${match.date}** alle **${match.time}**? Rispondi con **"Conferma"** per procedere o **"Annulla"**.`;
    }

    // --- 4. READ: DETERMINISTIC ANALYTICS (No LLM Math) ---
    if (action === 'ANALYTICS_QUERY') {
        return await computeDeterministicAnalytics(parsed);
    }

    return "🤖 Ho ricevuto la richiesta, ma non ho identificato un'azione chiara. Puoi ripetere specificando meglio?";
}

/**
 * Handles confirmation steps safely in conversational context
 */
async function handlePendingConfirmation(userQuery) {
    const q = userQuery.toLowerCase().trim();
    const actionState = window._aiAgentContext.pendingAction;
    window._aiAgentContext.pendingAction = null; // Clear state

    if (q.includes('conferma') || q.includes('sì') || q.includes('procedi')) {
        if (actionState.type === 'DELETE_APPOINTMENT') {
            await window.universalQuery({ action: 'DELETE', table: 'appointments', id: actionState.appId });
            if (typeof refreshAllData === 'function') await refreshAllData();
            if (typeof renderCalendar === 'function') renderCalendar();
            return `🗑️ L'appuntamento (${actionState.details}) è stato eliminato con successo.`;
        }
    }
    return "❌ Operazione annullata su tua richiesta.";
}

/**
 * Executes deterministic aggregations directly via JS over Dexie data tables
 */
async function computeDeterministicAnalytics(parsed) {
    const salonId = currentUser ? currentUser.salon_id : 'SALON_001';
    const type = parsed.analyticsType;
    const custName = parsed.customerName;

    if (type === 'CUSTOMER_SPEND' || custName) {
        const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
        const targetCust = customers.find(c => `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes((custName || '').toLowerCase()));
        
        if (!targetCust) return `⚠️ Non ho trovato alcun cliente registrato con il nome "${custName}".`;

        const sales = (await window.universalQuery({ action: 'GET_ALL', table: 'sales' }) || []).filter(s => s.cust_id === targetCust.id);
        const totalSpent = sales.reduce((sum, s) => sum + (parseFloat(s.total) || 0), 0);
        const totalVisits = sales.length;

        return `👤 **Analisi Cliente: ${targetCust.first_name} ${targetCust.last_name}**\n- Visite totali registrate: **${totalVisits}**\n- Spesa complessiva: **€ ${totalSpent.toFixed(2)}**`;
    }

    if (type === 'LOW_STOCK') {
        const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
        const low = inventory.filter(p => p.type === 'prodotto' && p.stock <= (p.min_stock || 0));
        
        if (low.length === 0) return "✅ Ottime notizie! Nessun prodotto si trova attualmente sotto la soglia di scorta minima.";
        return `⚠️ **Prodotti Sotto Scorta (${low.length}):**\n` + low.map(p => `- ${p.name}: giacenza ${p.stock} (min: ${p.min_stock})`).join('\n');
    }

    return "📊 Richiesta di analisi elaborata. Controlla i report avanzati nella dashboard principale per maggiori dettagli.";
}

async function executeHeuristicFallback(q, todayStr) {
    if (q.includes('appuntament') || q.includes('chi ho')) {
        const apps = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        const todayApps = apps.filter(a => a.date === todayStr);
        return `📅 Per oggi hai **${todayApps.length} appuntamenti** registrati in agenda.`;
    }
    return "🤖 Non ho compreso pienamente la richiesta. Prova a chiedere gli appuntamenti di un cliente o lo stato delle scorte.";
}


// --- 5. READ: GET APPOINTMENTS FOR CUSTOMER ---
    if (action === 'GET_APPOINTMENTS') {
        const custName = parsed.customerName || window._aiAgentContext.lastCustomer;
        if (!custName) return "⚠️ Di quale cliente desideri verificare gli appuntamenti?";

        // Aggiorna il contesto globale
        window._aiAgentContext.lastCustomer = custName;

        const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
        
        // Filtra gli appuntamenti del cliente da oggi in poi (o anche passati se richiesto)
        const custApps = appointments.filter(a => {
            const matchName = (a.cust_name || '').toLowerCase().includes(custName.toLowerCase());
            return matchName && a.date >= todayStr;
        });

        // Ordina dal più vicino al più lontano nel futuro
        custApps.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        if (custApps.length === 0) {
            return `📅 Al momento non ci sono appuntamenti futuri programmati per **${custName}**.`;
        }

        let reply = `📅 Ecco i prossimi appuntamenti trovati per **${custName}**:\n`;
        custApps.forEach(a => {
            const timeStr = a.time ? a.time.substring(0, 5) : '';
            reply += `- **${a.date}** alle ore **${timeStr}**: ${a.service || 'Trattamento'} (Op: ${a.assigned_user || 'Admin'})\n`;
        });

        return reply;
    }