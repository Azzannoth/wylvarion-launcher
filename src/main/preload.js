'use strict';
// Bezpečný most mezi oknem launcheru a hlavním procesem.

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('wyl', {
  state: () => ipcRenderer.invoke('state'),
  login: () => ipcRenderer.invoke('login'),
  logout: () => ipcRenderer.invoke('logout'),
  skin: () => ipcRenderer.invoke('skin'),
  skins: {
    state: () => ipcRenderer.invoke('skins:state'),
    pick: () => ipcRenderer.invoke('skins:pick'),
    apply: (opts) => ipcRenderer.invoke('skins:apply', opts),
    saveCurrent: (name) => ipcRenderer.invoke('skins:saveCurrent', name),
    remove: (id) => ipcRenderer.invoke('skins:remove', id),
    cape: (id) => ipcRenderer.invoke('skins:cape', id)
  },
  play: () => ipcRenderer.invoke('play'),
  status: () => ipcRenderer.invoke('status'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseRoot: () => ipcRenderer.invoke('root:choose'),
  customMods: () => ipcRenderer.invoke('mods:custom'),
  addJar: () => ipcRenderer.invoke('mods:addJar'),
  removeJar: (name) => ipcRenderer.invoke('mods:removeJar', name),
  searchMods: (q) => ipcRenderer.invoke('mods:search', q),
  addModrinth: (id) => ipcRenderer.invoke('mods:addModrinth', id),
  open: (what) => ipcRenderer.invoke('open', what),
  external: (url) => ipcRenderer.invoke('external', url),
  copy: (text) => ipcRenderer.invoke('copy', text),
  repair: () => ipcRenderer.invoke('repair'),
  windowAction: (a) => ipcRenderer.invoke('window', a),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onProgress: on('progress'),
  onNotice: on('notice'),
  onAccount: on('account'),
  onGameState: on('game-state'),
  onGameLog: on('game-log'),
  onUpdate: on('update')
});
