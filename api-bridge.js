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

// Sostituzione in api-bridge.js con l'affidabilissimo wa.me
if (!window.api) {
    window.api = {
        query: window.universalQuery,
        openExternal: (url) => {
            // Apriamo via web standard wa.me che è l'unico metodo ufficiale supportato al 100%
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
        window.open(url, '_blank');
    };

    if (!window.api.checkReminders) {
        window.api.checkReminders = () => {
            if (typeof updateReminderBadgeCount === 'function') updateReminderBadgeCount();
            if (typeof changePage === 'function') changePage('logs');
        };
    }
}