const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let characterPrompt = '你是一个可爱的桌宠助手，友好地陪伴用户聊天。';
let initialVoiceManifest = null;
try {
  const p = path.join(__dirname, '..', 'data', 'character.txt');
  const c = fs.readFileSync(p, 'utf-8');
  if (c.trim()) characterPrompt = c.trim();
} catch {}
try {
  const p = path.join(__dirname, '..', 'public', 'voices', '003_kalts', 'manifest.json');
  initialVoiceManifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
} catch {}

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  updateHitRect: (rect) => ipcRenderer.send('update-hit-rect', rect),
  setUiLocked: (locked) => ipcRenderer.send('set-ui-locked', locked),
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  resizeWindow: (w, h) => ipcRenderer.send('window-resize', { w, h }),
  hideWindow: () => ipcRenderer.send('window-hide'),
  toggleDevtools: () => ipcRenderer.send('toggle-devtools'),
  toggleWalk: () => ipcRenderer.send('toggle-walk'),
  onWalkToggled: (callback) => { ipcRenderer.on('walk-toggled', (_e, enabled) => callback(enabled)); },
  onPlayAnimation: (callback) => { ipcRenderer.on('animation-play', (_e, name) => callback(name)); },
  getInitialVoiceManifest: () => initialVoiceManifest,
  loadPreferences: () => ipcRenderer.invoke('load-preferences'),
  savePreferences: (prefs) => ipcRenderer.send('save-preferences', prefs),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled) => ipcRenderer.send('set-autostart', enabled),
  getPosition: () => ipcRenderer.invoke('window-get-position'),
  setPosition: (x, y) => ipcRenderer.send('window-set-position', { x, y }),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  getConfig: () => ({
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    characterPrompt,
  }),
});
