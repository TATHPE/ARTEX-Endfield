'use strict';
// Minimal, isolated bridge for the splash / diagnose pages: boot progress, a few
// paths, and the diagnose actions. Nothing else is exposed to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  onBootProgress(callback) {
    ipcRenderer.on('boot:progress', (_event, data) => callback(data));
  },
  info() {
    return ipcRenderer.invoke('shell:info');
  },
  diagnose() {
    return ipcRenderer.invoke('shell:diagnose');
  },
  openPath(target) {
    return ipcRenderer.invoke('shell:openPath', target);
  },
  retry() {
    return ipcRenderer.invoke('shell:retry');
  },
  quit() {
    return ipcRenderer.invoke('shell:quit');
  },
});
