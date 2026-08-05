const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Esponiamo la funzione di query universale
    query: (params) => ipcRenderer.invoke('db-query', params),
    
    // Funzione per testare lo stato della connessione dal frontend
    checkOnlineStatus: () => navigator.onLine,
    
    // Listeners per eventi dal main
    onReminder: (callback) => ipcRenderer.on('pending-reminders', (e, data) => callback(data)),
    onNoReminder: (callback) => ipcRenderer.on('no-reminders-found', () => callback()),
    
    // Funzioni di sistema
    backup: () => ipcRenderer.invoke('db-query', { action: 'PERFORM_MANUAL_BACKUP' }),
    openExternal: (url) => ipcRenderer.send('open-external-link', url)
});