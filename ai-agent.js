// =========================================================================
// 🤖 VAIMUP AUTONOMOUS AGENT - CONVERSATIONAL CHAT-HISTORY ENGINE
// Architettura Multi-Turn con Memoria Contestuale e Zero Hardcoding
// =========================================================================

// Buffer persistente della conversazione attiva (lo stesso principio di ChatGPT/Claude)
if (!window._aiChatHistory) {
    window._aiChatHistory = [];
}

if (!window._aiAgentContext) {
    window._aiAgentContext = {
        pendingAction: null
    };
}

// -------------------------------------------------------------------------
// 1. GESTIONE CHIAVE API DA SUPABASE (SILENZIOSA, ZERO INTERFACCIA)
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
// 2. CHIAMATA MULTI-TURN ALL'LLM (INVIA TUTTA LA STORIA DELLA CHAT)
// -------------------------------------------------------------------------
async function callConversationalLLM(systemPrompt, userQuery) {
    const apiKey = await getOrLoadAiApiKey();
    if (!apiKey || apiKey.includes("INSERISCI")) {
        throw new Error("API_KEY_MISSING");
    }

    // Aggiunge la richiesta dell'utente alla cronologia
    window._aiChatHistory.push({ role: "user", content: userQuery });

    // Mantiene massimo gli ultimi 10 turni per preservare la finestra di contesto
    if (window._aiChatHistory.length > 10) {
        window._aiChatHistory = window._aiChatHistory.slice(-10);
    }

    const messagesPayload = [
        { role: "system", content: systemPrompt },
        ...window._aiChatHistory
    ];

    const isGoogleKey = apiKey.startsWith("AIza");

    // Provider Google Gemini
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
                    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                    window._aiChatHistory.push({ role: "assistant", content: reply });
                    return reply;
                }
            } catch (e) {}
        }
        throw new Error("Tutti i modelli Google Gemini hanno risposto con errore.");
    }

    // Provider OpenRouter con modelli di punta
    const candidateModels = [
        "anthropic/claude-3.5-sonnet", // Se disponibile sul tuo account OpenRouter
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
                const reply = data.choices?.[0]?.message?.content || "";
                window._aiChatHistory.push({ role: "assistant", content: reply });
                return reply;
            }
        } catch (e) {}
    }

    throw new Error("Errore durante la chiamata ai provider IA.");
}

// -------------------------------------------------------------------------
// 3. ESECUTORE DELLE AZIONI DETERMINISTICHE NEL GESTIONALE
// -------------------------------------------------------------------------
async function executeDatabaseAction(actionType, params) {
    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id)
        ? currentUser.salon_id
        : 'SALON_001';

    const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const customers = await window.universalQuery({ action: 'GET_ALL', table: 'customers' }) || [];
    const schedules = await window.universalQuery({ action: 'GET_ALL', table: 'operator_schedules' }) || [];

    // A. CREAZIONE APPUNTAMENTO
    if (actionType === 'CREATE_APPOINTMENT') {
        const rawSrv = params.service || 'Trattamento';
        const matchedServ = inventory.find(i => i.type === 'servizio' && (
            i.name.toLowerCase().includes(rawSrv.toLowerCase()) || rawSrv.toLowerCase().includes(i.name.toLowerCase())
        ));

        let price = parseFloat(params.price) || 0;
        if (price <= 0 && matchedServ) {
            const pInfo = await window.universalQuery({ action: 'GET_CURRENT_PRICE', id: matchedServ.id });
            price = pInfo ? (parseFloat(pInfo.price) || 0) : (parseFloat(matchedServ.price) || 0);
        }

        const appPayload = {
            id: crypto.randomUUID(),
            salon_id: salonId,
            cust_name: params.customer,
            date: params.date,
            time: params.start_time,
            end_time: params.end_time,
            service: matchedServ ? matchedServ.name : rawSrv,
            price: price,
            assigned_user: params.operator || (currentUser ? currentUser.username : 'admin'),
            notes: 'Creato tramite Assistente IA'
        };

        window._aiAgentContext.pendingAction = {
            action: 'INSERT',
            table: 'appointments',
            payload: appPayload,
            summary: `Creazione appuntamento per **${appPayload.cust_name}** il **${appPayload.date}** alle **${appPayload.time} - ${appPayload.end_time}** (*${appPayload.service}*, Op: ${appPayload.assigned_user})`
        };

        return {
            status: "PROPOSAL",
            action: "INSERT",
            details: appPayload,
            summary: window._aiAgentContext.pendingAction.summary
        };
    }

    // B. MODIFICA O SPOSTAMENTO APPUNTAMENTO
    if (actionType === 'MODIFY_APPOINTMENT') {
        // Cerca l'appuntamento reale nel DB da modificare
        let realApp = null;
        if (params.appointment_id) {
            realApp = appointments.find(a => String(a.id) === String(params.appointment_id));
        }
        if (!realApp && params.customer) {
            const clientApps = appointments.filter(a => (a.cust_name || '').toLowerCase().includes(params.customer.toLowerCase()));
            realApp = clientApps.sort((a,b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
        }

        if (!realApp) {
            return { status: "ERROR", message: `Non ho trovato l'appuntamento da modificare per ${params.customer || 'questo cliente'}.` };
        }

        const updatePayload = {
            id: realApp.id,
            salon_id: salonId,
            cust_name: realApp.cust_name,
            date: params.new_date || realApp.date,
            time: params.new_start_time || realApp.time,
            end_time: params.new_end_time || realApp.end_time,
            service: params.new_service || realApp.service,
            price: realApp.price,
            assigned_user: params.new_operator || realApp.assigned_user,
            notes: realApp.notes || 'Modificato tramite Assistente IA'
        };

        window._aiAgentContext.pendingAction = {
            action: 'UPDATE',
            table: 'appointments',
            payload: updatePayload,
            id: realApp.id,
            summary: `Modifica appuntamento di **${updatePayload.cust_name}**: data **${updatePayload.date}**, orario **${updatePayload.time} - ${updatePayload.end_time}** (*${updatePayload.service}*)`
        };

        return {
            status: "PROPOSAL",
            action: "UPDATE",
            details: updatePayload,
            previous: realApp,
            summary: window._aiAgentContext.pendingAction.summary
        };
    }

    // C. CANCELLAZIONE APPUNTAMENTO
    if (actionType === 'DELETE_APPOINTMENT') {
        let realApp = null;
        if (params.appointment_id) {
            realApp = appointments.find(a => String(a.id) === String(params.appointment_id));
        }
        if (!realApp && params.customer) {
            const clientApps = appointments.filter(a => (a.cust_name || '').toLowerCase().includes(params.customer.toLowerCase()));
            realApp = clientApps.sort((a,b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
        }

        if (!realApp) {
            return { status: "ERROR", message: `Non ho trovato alcun appuntamento da eliminare per ${params.customer || 'questo cliente'}.` };
        }

        window._aiAgentContext.pendingAction = {
            action: 'DELETE',
            table: 'appointments',
            id: realApp.id,
            payload: realApp,
            summary: `Cancellazione definitiva appuntamento di **${realApp.cust_name}** del **${realApp.date}** alle ore **${realApp.time}** (*${realApp.service}*)`
        };

        return {
            status: "PROPOSAL",
            action: "DELETE",
            details: realApp,
            summary: window._aiAgentContext.pendingAction.summary
        };
    }

    return null;
}

// -------------------------------------------------------------------------
// 4. CONTROLLER PRINCIPALE DIALOGICO CON RAGIONAMENTO NATURALE
// -------------------------------------------------------------------------
async function processAiAgentQuery(userQuery) {
    const rawQuery = (userQuery || '').trim();
    const q = rawQuery.toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const daysItalian = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
    const dayOfWeek = daysItalian[now.getDay()];

    const salonId = (typeof currentUser !== 'undefined' && currentUser && currentUser.salon_id)
        ? currentUser.salon_id
        : 'SALON_001';

    // 1. Controllo Human-In-The-Loop su conferma
    if (window._aiAgentContext.pendingAction) {
        const isStrictApproval = q === 'sì' || q === 'si' || q === 'conferma' || q === 'procedi' || q === 'esegui' || q === 'ok';
        const isStrictCancel = q === 'no' || q === 'annulla' || q === 'cancella' || q === 'lascia stare';

        if (isStrictApproval) return await confirmAiPendingAction();
        if (isStrictCancel) return cancelAiPendingAction();

        // Se l'utente scrive un nuovo comando correttivo
        window._aiAgentContext.pendingAction = null;
    }

    // 2. Idratazione dati del salone da fornire come contesto vivo all'IA
    const appointments = await window.universalQuery({ action: 'GET_ALL', table: 'appointments' }) || [];
    const validApps = appointments.filter(a => {
        const s = (a.service || '').toLowerCase();
        const c = (a.cust_name || '').toLowerCase();
        return !s.includes('pausa') && !s.includes('pranzo') && !c.includes('pausa') && !s.includes('chiusura') && !c.includes('chiusura');
    });

    const inventory = await window.universalQuery({ action: 'GET_ALL', table: 'inventory' }) || [];
    const services = inventory.filter(i => i.type === 'servizio');

    // 3. System Prompt con istruzioni complete, data reale e contesto del database
    const systemPrompt = `Sei l'assistente IA ufficiale di VaiMUp, suite gestionale per saloni beauty/retail.
Stai parlando direttamente con il TITOLARE o lo STAFF del salone (NON con il cliente finale).
DATA E ORA ATTUALE DI SISTEMA: ${dayOfWeek}, ${todayStr} - Ore ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}.
Salone ID attivo: "${salonId}".

SERVIZI REGISTRATI A LISTINO:
${JSON.stringify(services.map(s => ({ nome: s.name, prezzo: s.price, durata: s.duration_minutes })))}

APPUNTAMENTI REALI PRESENTI NEL DATABASE:
${JSON.stringify(validApps.slice(-20).map(a => ({ id: a.id, cliente: a.cust_name, data: a.date, orario: `${a.time}-${a.end_time}`, servizio: a.service, operatore: a.assigned_user, prezzo: a.price })))}

MANUALE DIRETTO FUNZIONALITÀ VAIMUP:
${VAIMUP_APP_MANUAL}

ISTRUZIONI OPERATIVE:
- Mantieni la continuità con i messaggi precedenti della chat: quando l'utente usa pronomi ("spostalo", "eliminalo", "aumenta la durata"), fai SEMPRE riferimento all'ultimo appuntamento o cliente discusso nella cronologia.
- Calcola le date relative partendo da OGGI (${todayStr}):
  * Domani = il giorno successivo a ${todayStr}.
  * Dopodomani = due giorni dopo ${todayStr}.
- Quando devi compiere o proporre un'azione nel gestionale (fissare, spostare, modificare orario/durata o eliminare un appuntamento), aggiungi alla fine della tua risposta il blocco JSON dell'azione racchiuso tra tripli apici:
\`\`\`action
{
  "action": "CREATE_APPOINTMENT" | "MODIFY_APPOINTMENT" | "DELETE_APPOINTMENT",
  "params": {
    "customer": "Nome Cliente",
    "appointment_id": "ID dell'appuntamento reale se modifica o eliminazione",
    "date": "YYYY-MM-DD",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "new_date": "YYYY-MM-DD (se spostamento)",
    "new_start_time": "HH:MM (se cambio orario)",
    "new_end_time": "HH:MM (calcolato in base alla nuova durata)",
    "service": "Nome servizio"
  }
}
\`\`\`
- Se l'utente chiede spiegazioni o guide (es. "Come faccio a fare uno storno?"), rispondi usando il manuale in italiano professionale senza inserire blocchi action.`;

    // 4. Chiamata con Cronologia Multi-Turn
    let aiResponse = "";
    try {
        aiResponse = await callConversationalLLM(systemPrompt, rawQuery);
    } catch (err) {
        if (err.message === "API_KEY_MISSING") {
            return "🤖 Il servizio di intelligenza artificiale non è attivo sul database. Contatta l'amministratore per la configurazione.";
        }
        return `⚠️ Errore di comunicazione con il motore IA: ${err.message}`;
    }

    // 5. Intercettazione ed esecuzione del blocco action generato dall'IA
    const actionMatch = aiResponse.match(/```action\s*([\s\S]*?)\s*```/);
    if (actionMatch) {
        try {
            const actionData = JSON.parse(actionMatch[1].trim());
            const textWithoutAction = aiResponse.replace(/```action[\s\S]*?```/, '').trim();

            const execResult = await executeDatabaseAction(actionData.action, actionData.params);

            if (execResult && execResult.status === "PROPOSAL") {
                const details = execResult.details;
                const isDelete = execResult.action === 'DELETE';
                const isUpdate = execResult.action === 'UPDATE';

                const confirmQuestion = isDelete 
                    ? "⚠️ Sei sicuro di voler eliminare definitivamente questo appuntamento dall'agenda?"
                    : (isUpdate ? "❓ Vuoi procedere con la modifica?" : "❓ Vuoi procedere con il salvataggio?");

                const btnLabel = isDelete ? "🗑️ Conferma ed Elimina" : (isUpdate ? "✓ Conferma Modifica" : "✓ Conferma ed Inserisci");
                const btnClass = isDelete ? "btn-d" : "btn-s";

                return `${textWithoutAction ? textWithoutAction + '\n\n' : ''}📋 **Proposta Operativa (In attesa di tua conferma):**\n\n` +
                    `• **Operazione:** ${execResult.summary}\n` +
                    (details.cust_name ? `• **Cliente:** ${details.cust_name}\n` : '') +
                    (details.date ? `• **Data:** ${details.date}\n` : '') +
                    (details.time ? `• **Orario:** ${details.time} - ${details.end_time || ''}\n` : '') +
                    (details.service ? `• **Servizio:** ${details.service} (Prezzo: € ${parseFloat(details.price || 0).toFixed(2)})\n` : '') +
                    (details.assigned_user ? `• **Operatore:** ${details.assigned_user}\n` : '') +
                    `\n${confirmQuestion} Rispondi **"Conferma"** oppure tocca il pulsante:\n` +
                    `<div class="ai-hitl-actions" style="display:flex; gap:8px; margin-top:10px;">` +
                    `<button type="button" class="btn ${btnClass}" style="padding:8px 16px; font-size:12px; font-weight:800; cursor:pointer;" onclick="window.confirmAiPendingAction(this)">${btnLabel}</button>` +
                    `<button type="button" class="btn btn-d" style="padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer; background:#f1f5f9; color:#475569;" onclick="window.cancelAiPendingAction(this)">✕ Annulla</button>` +
                    `</div>`;
            }
        } catch (e) {
            console.warn("Avviso parsing azione IA:", e);
        }
    }

    return aiResponse;
}
window.processAiAgentQuery = processAiAgentQuery;

// -------------------------------------------------------------------------
// 5. CONFERMA ED ESECUZIONE FASE 2 HUMAN-IN-THE-LOOP
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
            successText = `🗑️ **Appuntamento eliminato con successo!**\nL'appuntamento è stato rimosso dall'agenda.`;
        } else if (action === 'UPDATE') {
            await window.universalQuery({ action: 'UPDATE', table: table, data: payload, id: targetId });
            successText = `✅ **Appuntamento modificato con successo!**\n${pending.summary}.`;
        } else if (action === 'INSERT') {
            await window.universalQuery({ action: 'INSERT', table: table, data: payload });
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
// 6. HELPER DOM E SPEECH SYNTHESIS
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