const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PREFS_PATH = path.join(__dirname, '..', 'data', 'preferences.json');

// Allow audio playback without user gesture (idle voices, etc.)
app.commandLine.appendSwitch('--autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Hit area for click-through toggle (sent from renderer)
let hitRect = null; // null until renderer sends first bounds — default to entirely click-through
let uiLocked = false; // true when context menu or chat is open
let isDragging = false; // true while user is dragging the window
let dragTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 375,
    height: 510,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Start in click-through mode so desktop stays usable
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  if (process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:1420');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    // Restore window position from saved preferences
    try {
      const prefs = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
      if (typeof prefs.windowX === 'number' && typeof prefs.windowY === 'number') {
        const displays = screen.getAllDisplays();
        // Validate position is on some display (handle screen config changes)
        const onScreen = displays.some(d => {
          const { x, y, width, height } = d.workArea;
          return prefs.windowX >= x && prefs.windowX < x + width - 100 &&
                 prefs.windowY >= y && prefs.windowY < y + height - 100;
        });
        if (onScreen) mainWindow.setPosition(prefs.windowX, prefs.windowY);
      }
    } catch {}
    mainWindow.show();
  });

  // Debounced save window position on move
  let savePosTimer;
  mainWindow.on('move', () => {
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const [x, y] = mainWindow.getPosition();
        let existing = {};
        try { existing = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8')); } catch {}
        existing.windowX = x; existing.windowY = y;
        try { fs.writeFileSync(PREFS_PATH, JSON.stringify(existing, null, 2)); } catch {}
      }
    }, 300);
  });

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  startClickThroughPolling();
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'icons', 'icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('prts');
  tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// Poll every 50ms: check cursor position vs character hitRect
// and toggle click-through so clicks register on character but pass through
// transparent edges.
function startClickThroughPolling() {
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // When UI (menu/chat) or drag is active, NEVER ignore mouse events
    if (uiLocked || isDragging) {
      mainWindow.setIgnoreMouseEvents(false);
      return;
    }
    // No hit area info yet — default to click-through
    if (!hitRect || !hitRect.w || !hitRect.h) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const relX = cursor.x - bounds.x;
    const relY = cursor.y - bounds.y;
    const inRect = relX >= hitRect.x && relX <= hitRect.x + hitRect.w &&
                   relY >= hitRect.y && relY <= hitRect.y + hitRect.h;
    if (inRect) {
      mainWindow.setIgnoreMouseEvents(false);
    } else {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  }, 50);
}

// ===== Walk Behavior State Machine =====
const BOTTOM_MARGIN = 0; // keep feet above taskbar
let walkEnabled = false;
let walkState = { active: false };
let walkGroundY = null; // fixed Y while walk mode is on, prevents pose-induced vertical jumps
let walkInterval = null;
let behaviorTimer = null;

function startWalkBehavior() {
  clearTimeout(behaviorTimer);
  if (!walkEnabled || !mainWindow || mainWindow.isDestroyed()) { console.log('[Walk] startWalkBehavior blocked: enabled=', walkEnabled, 'win=', !!mainWindow); return; }

  // Cache ground Y on first call to prevent vertical jumps when pose changes
  if (walkGroundY === null) {
    const bounds = mainWindow.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const charBottom = (hitRect && hitRect.h > 0) ? (hitRect.y + hitRect.h) : bounds.height;
    walkGroundY = wa.y + wa.height - charBottom - BOTTOM_MARGIN;
    mainWindow.setPosition(bounds.x, Math.round(walkGroundY));
  }

  const r = Math.random();
  let behavior;
  if (r < 0.35) behavior = 'walk';
  else if (r < 0.60) behavior = 'idle';
  else if (r < 0.80) behavior = 'sit';
  else behavior = 'sleep';

  console.log('[Walk] behavior:', behavior, 'rand:', r.toFixed(3));

  switch (behavior) {
    case 'walk':
      walkToRandomEdge();
      break;
    case 'sit':
      alignToEdge('sit');
      break;
    case 'sleep':
      alignToEdge('sleep');
      break;
    default:
      alignToEdge('Relax', 5000 + Math.random() * 10000);
      break;
  }
}

function walkToRandomEdge() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;

  // Snap Y to bottom edge using cached ground Y so it stays consistent across poses
  let bottomY;
  if (walkEnabled && walkGroundY !== null) {
    bottomY = walkGroundY;
  } else {
    const charBottom = (hitRect && hitRect.h > 0) ? (hitRect.y + hitRect.h) : bounds.height;
    bottomY = wa.y + wa.height - charBottom - BOTTOM_MARGIN;
  }
  mainWindow.setPosition(bounds.x, Math.round(bottomY));

  // Random X along the bottom edge
  const tx = wa.x + Math.random() * Math.max(0, wa.width - bounds.width);

  const dist = Math.abs(tx - bounds.x);
  if (!isFinite(dist) || dist < 50) { console.log('[Walk] too close or invalid dist:', dist, 'sit instead'); alignToEdge('sit'); return; }

  const duration = (dist / 40) * 1000;
  walkState = { active: true, startX: bounds.x, startY: bottomY, targetX: tx, targetY: bottomY, startTime: Date.now(), duration: Math.max(1000, duration) };
  console.log('[Walk] walking dist:', dist.toFixed(0), 'duration:', duration.toFixed(0), 'ms');

  try { mainWindow.webContents.send('animation-play', 'move'); } catch {}
  startWalkMovement();
}

function startWalkMovement() {
  if (walkInterval) { console.log('[Walk] movement already running'); return; }
  console.log('[Walk] starting movement interval');
  let tickCount = 0;
  walkInterval = setInterval(() => {
    if (!walkEnabled || !mainWindow || mainWindow.isDestroyed()) { console.log('[Walk] movement cancelled'); stopWalkMovement(); return; }
    if (!walkState.active) return;

    const elapsed = Date.now() - walkState.startTime;
    const dur = walkState.duration > 0 ? walkState.duration : 1000;
    const t = Math.min(1, elapsed / dur);
    const x = walkState.startX + (walkState.targetX - walkState.startX) * t;
    const y = walkState.startY + (walkState.targetY - walkState.startY) * t;
    if (!mainWindow.isDestroyed() && isFinite(x) && isFinite(y)) mainWindow.setPosition(Math.round(x), Math.round(y));

    tickCount++;
    if (tickCount % 20 === 0) console.log('[Walk] tick', tickCount, 't:', t.toFixed(3), 'pos:', Math.round(x), Math.round(y));

    if (t >= 1) {
      console.log('[Walk] arrived, t=', t);
      walkState.active = false;
      stopWalkMovement();
      alignToEdge(Math.random() < 0.6 ? 'sit' : 'sleep');
    }
  }, 50);
}

function stopWalkMovement() {
  if (walkInterval) { clearInterval(walkInterval); walkInterval = null; }
}

function alignToEdge(pose, customDur) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  const newX = Math.max(wa.x, Math.min(wa.x + wa.width - bounds.width, bounds.x));
  // In walk mode, use cached ground Y so pose changes don't cause vertical jumps
  let newY;
  if (walkEnabled && walkGroundY !== null) {
    newY = walkGroundY;
  } else {
    const charBottom = (hitRect && hitRect.h > 0) ? (hitRect.y + hitRect.h) : bounds.height;
    newY = wa.y + wa.height - charBottom - BOTTOM_MARGIN;
  }
  console.log('[Walk] alignToEdge', pose, 'pos:', newX, newY);
  if (isFinite(newX) && isFinite(newY)) mainWindow.setPosition(Math.round(newX), Math.round(newY));
  try { mainWindow.webContents.send('animation-play', pose); } catch {}

  const dur = customDur !== undefined ? customDur : 15000 + Math.random() * 15000;
  console.log('[Walk] will resume in', dur, 'ms');
  behaviorTimer = setTimeout(startWalkBehavior, dur);
}

app.whenReady().then(() => {
  // Apply auto-start from saved preferences on every launch
  try {
    const prefs = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8'));
    if (typeof prefs.autoStart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: prefs.autoStart });
    }
  } catch {}
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {});

// IPC: receive updated hitRect from renderer
ipcMain.on('update-hit-rect', (_, rect) => {
  if (rect && rect.w > 0 && rect.h > 0) hitRect = rect;
});

// IPC: lock/unlock click-through for context menu / chat bubble
ipcMain.on('set-ui-locked', (_, locked) => {
  uiLocked = locked;
  // When locking (menu/chat open), ensure mouse events are received.
  // When unlocking, let the polling function handle click-through naturally.
  if (locked && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(false);
  }
});

// IPC: toggle click-through (used by context menu)
ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
  }
});

// IPC: toggle walk behavior on/off
ipcMain.on('toggle-walk', () => {
  console.log('[Walk] toggle received, current walkEnabled:', walkEnabled);
  walkEnabled = !walkEnabled;
  console.log('[Walk] now:', walkEnabled);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('walk-toggled', walkEnabled);
  }
  if (walkEnabled) {
    console.log('[Walk] starting behavior');
    startWalkBehavior();
  } else {
    console.log('[Walk] stopping behavior');
    clearTimeout(behaviorTimer);
    stopWalkMovement();
    walkState.active = false;
    walkGroundY = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('animation-play', 'Relax');
    }
  }
});

// IPC: move window by delta (also used for drag detection)
ipcMain.on('window-move', (_, { dx, dy }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + dx, y + dy);
  }
  isDragging = true;
  clearTimeout(dragTimer);
  dragTimer = setTimeout(() => { isDragging = false; }, 200);
});

// IPC: get window position
ipcMain.handle('window-get-position', () => {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.getPosition();
  return [0, 0];
});

// IPC: set window position
ipcMain.on('window-set-position', (_, { x, y }) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setPosition(x, y);
});

// IPC: maximize window (returns work area bounds)
ipcMain.handle('window-maximize', () => {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
});

// IPC: resize window
ipcMain.on('window-resize', (_, { w, h }) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(w, h);
  }
});

// ===== Preferences Persistence =====
ipcMain.handle('load-preferences', () => {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8')); }
  catch { return {}; }
});

ipcMain.on('save-preferences', (_, prefs) => {
  try {
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(PREFS_PATH, 'utf-8')); } catch {}
    fs.writeFileSync(PREFS_PATH, JSON.stringify({ ...existing, ...prefs }, null, 2));
  } catch (e) { console.error('Save prefs error:', e); }
});

// IPC: hide window to tray
ipcMain.on('window-hide', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
});

// IPC: get/set auto-start on boot
ipcMain.handle('get-autostart', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.on('set-autostart', (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
});

// F12: open devtools for debugging
ipcMain.on('toggle-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    } else {
      mainWindow.webContents.openDevTools();
    }
  }
});
