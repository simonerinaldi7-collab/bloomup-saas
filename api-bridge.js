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

if (!window.api) {
    window.api = {
        query: window.universalQuery,
        openExternal: (url) => window.open(url, '_blank'),
        checkReminders: () => {},
        onReminder: () => {},
        onNoReminder: () => {}
    };
} else {
    if (!window.api.originalQuery) {
        window.api.originalQuery = window.api.query;
    }
    window.api.query = window.universalQuery;
}