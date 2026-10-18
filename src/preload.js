const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, fn) => {
    const handler = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  query: Object.fromEntries(new URLSearchParams(window.location.search)),
});

// MessagePorts for the live Liquid Glass feed can't cross the context bridge directly;
// hand them to the page with window.postMessage.
ipcRenderer.on('wall:port', (e, info) => window.postMessage({ type: 'wall:port', id: info.id }, '*', e.ports));
ipcRenderer.on('glass:port', (e) => window.postMessage({ type: 'glass:port' }, '*', e.ports));
