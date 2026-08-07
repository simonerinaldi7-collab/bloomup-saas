// api-bridge.js
window.universalQuery = async function(params) {
    const isElectron = window.api && typeof window.api.originalQuery === 'function';

    if (isElectron) {
        return await window.api.originalQuery(params);
    } else {
        if (typeof window.appDataService !== 'function') {
            console.error("ERRORE: appDataService non è ancora definita!");
            return null;
        }
        return await window.appDataService(params.action, params.table, params.data, params.id);
    }
};

// Sostituzione in api-bridge.js
if (!window.api) {
    window.api = {
        query: window.universalQuery,
        openExternal: (url) => {
            if (url.includes('wa.me') || url.includes('whatsapp.com')) {
                // Estraiamo il numero e il testo dall'URL di wa.me per convertirlo nel protocollo nativo di sistema
                try {
                    const urlObj = new URL(url);
                    const phone = urlObj.pathname.replace(/\D/g, '');
                    const text = urlObj.searchParams.get('text') || '';
                    
                    // Protocollo nativo WhatsApp Desktop (se installato, apre l'app nativa senza caricare script web di crash)
                    const nativeUrl = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`;
                    
                    if (window.open(nativeUrl, '_system')) {
                        return;
                    }
                } catch (e) {
                    console.warn("Fallback su URL web standard per WhatsApp:", e);
                }
            }

            // Apertura standard per tutti gli altri link (SMS, browser esterni, ecc.)
            window.open(url, '_blank');
        },
        checkReminders: () => {
            if (typeof updateReminderBadgeCount === 'function') updateReminderBadgeCount();
            if (typeof changePage === 'function') changePage('logs');
        },
        onReminder: () => {},
        onNoReminder: () => {}
    };
} else {
    if (!window.api.originalQuery) {
        window.api.originalQuery = window.api.query;
    }
    window.api.query = window.universalQuery;
    
    window.api.openExternal = (url) => {
        if (url.includes('wa.me') || url.includes('whatsapp.com')) {
            try {
                const urlObj = new URL(url);
                const phone = urlObj.pathname.replace(/\D/g, '');
                const text = urlObj.searchParams.get('text') || '';
                const nativeUrl = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(text)}`;
                window.open(nativeUrl, '_system');
                return;
            } catch (e) {}
        }
        window.open(url, '_blank');
    };

    if (!window.api.checkReminders) {
        window.api.checkReminders = () => {
            if (typeof updateReminderBadgeCount === 'function') updateReminderBadgeCount();
            if (typeof changePage === 'function') changePage('logs');
        };
    }
}