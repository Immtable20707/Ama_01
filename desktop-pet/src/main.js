import './style.css';
import { Application, Loader } from 'pixi.js';
import { Spine, SpineParser } from 'pixi-spine';

const api = window.electronAPI || {};
const config = api.getConfig ? api.getConfig() : {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  characterPrompt: '你是一个可爱的桌宠助手。',
};

// ===== Model Definitions =====
const MODELS = [
  {
    name: '凯尔希',
    dir: '003_kalts',
    file: 'build_char_003_kalts',
    voiceDir: '003_kalts',
    scale: 0.9,
  },
  {
    name: '凯尔希·2',
    dir: '003_kalts_boc6',
    file: 'build_char_003_kalts_boc6',
    voiceDir: '003_kalts_boc6',
    scale: 1.0,
  },
  {
    name: '凯尔希·3',
    dir: '003_kalts_sale14',
    file: 'build_char_003_kalts_sale14',
    voiceDir: '003_kalts_sale14',
    scale: 0.85,
  },
  {
    name: '凯尔希·思衡托',
    dir: '003_kalts_2',
    file: 'build_char_1052_kalts2',
    voiceDir: '003_kalts_2',
    scale: 0.85,
  },
];

let currentModelIndex = 0;

let W = 375, H = 510;
const W_CHAT = 520, H_CHAT = 800;

const hint = document.getElementById('loading-hint');
const ctxMenu = document.getElementById('ctx-menu');

let pixiApp = null;
let spineCharacter = null;
let availableAnimations = [];
let bubbleVisible = false;
let isChatting = false;
let conversationHistory = [];
let systemPrompt = config.characterPrompt;
let walkEnabled = false;
let idleVoiceEnabled = true;
let autoStartEnabled = false;
let idleAnimTimer = null; // timer for idle animation trigger

// ===== Memory & Preferences (Features 1, 2, 3) =====
const STORAGE_KEY_CHAT = 'chat_history_v1';

// --- Chat History Persistence (Feature 1) ---
function loadChatHistory() {
  try {
    const data = localStorage.getItem(STORAGE_KEY_CHAT);
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Merge: use saved history but keep current systemPrompt
        const savedSystem = parsed[0];
        conversationHistory = parsed;
        if (savedSystem && savedSystem.role === 'system') {
          // Update system prompt content with current config
          conversationHistory[0].content = systemPrompt;
        }
        return true;
      }
    }
  } catch (e) { console.error('[Memory] Load chat error:', e); }
  return false;
}

function saveChatHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(conversationHistory));
  } catch (e) { console.error('[Memory] Save chat error:', e); }
}

// --- Long-term Memory Summarization (Feature 2) — Append Mode (方案 B) ---
let isSummarizing = false;

function findSummaryIndex() {
  return conversationHistory.findIndex(
    m => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[记忆摘要]')
  );
}

async function maybeSummarize() {
  // Count only user/assistant messages
  const msgs = conversationHistory.filter(m => m.role !== 'system');
  if (msgs.length < 14) return; // need at least 14 messages (7 exchanges)
  if (isSummarizing) return;

  const toSummarize = msgs.slice(0, -10); // oldest messages to summarize
  const keep = msgs.slice(-10);           // newest 10 to keep verbatim

  isSummarizing = true;
  try {
    const existingIdx = findSummaryIndex();
    const existingContent = existingIdx > 0
      ? conversationHistory[existingIdx].content.replace('[记忆摘要]\n', '')
      : '';

    // Step 1: summarize NEW messages only (use old summary as context)
    const resp = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: existingContent
              ? '已有旧摘要，请只总结下方最新对话中出现的新信息、新话题，不要重复已有摘要内容。'
              : '你是一个对话摘要助手。请用简洁的语言总结以上对话的要点，保留所有关键信息、用户偏好和约定。不要遗漏重要细节。',
          },
          ...(existingContent ? [{ role: 'system', content: `已有摘要：\n${existingContent}` }] : []),
          ...toSummarize,
        ],
        max_tokens: 512,
        temperature: 0.3,
      }),
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const newAppend = data.choices[0]?.message?.content;
    if (!newAppend) return;

    // Step 2: append mode — keep old summary, add new content after separator
    let combined = existingContent
      ? `${existingContent}\n\n——\n${newAppend}`
      : newAppend;

    // Step 3: if summary is too long (~2000 chars ≈ 1000 Chinese tokens),
    //         re-compress only the OLD part
    if (combined.length > 2000 && existingContent) {
      try {
        const compressResp = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: '请将以下摘要压缩为更简洁的形式，保留所有关键信息。不要遗漏重要内容。' },
              { role: 'user', content: existingContent },
            ],
            max_tokens: 512,
            temperature: 0.2,
          }),
        });
        if (compressResp.ok) {
          const compressedData = await compressResp.json();
          const compressed = compressedData.choices[0]?.message?.content;
          if (compressed && compressed.length < existingContent.length) {
            combined = `${compressed}\n\n——\n${newAppend}`;
          }
        }
      } catch (e) {
        console.error('[Memory] Compress error (non-fatal):', e);
      }
    }

    const systemPrompt = conversationHistory[0];
    conversationHistory = [
      systemPrompt,
      { role: 'system', content: `[记忆摘要]\n${combined}` },
      ...keep,
    ];

    saveChatHistory();
    console.log('[Memory] Summary appended, total length:', combined.length);
  } catch (e) {
    console.error('[Memory] Summarize error:', e);
  } finally {
    isSummarizing = false;
  }
}

// --- User Preference Saving (Feature 3) ---
async function loadPreferences() {
  try {
    const prefs = api.loadPreferences ? await api.loadPreferences() : null;
    if (!prefs) return;

    if (typeof prefs.modelIndex === 'number' && prefs.modelIndex !== currentModelIndex) {
      switchModel(prefs.modelIndex);
    }
    if (typeof prefs.walkEnabled === 'boolean') {
      walkEnabled = prefs.walkEnabled;
      api.toggleWalk && walkEnabled && api.toggleWalk();
    }
    if (typeof prefs.idleVoiceEnabled === 'boolean') {
      idleVoiceEnabled = prefs.idleVoiceEnabled;
      if (!idleVoiceEnabled) voiceManager.stopCurrent();
    }
    if (typeof prefs.autoStart === 'boolean') {
      autoStartEnabled = prefs.autoStart;
      const el = document.getElementById('menu-autostart');
      if (el) el.textContent = autoStartEnabled ? '开机自启: 开' : '开机自启: 关';
    }
  } catch (e) { console.error('[Prefs] Load error:', e); }
}

function savePreference(key, value) {
  api.savePreferences && api.savePreferences({ [key]: value });
}

function setHint(text, isError = false) {
  hint.textContent = text;
  if (text) {
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
  if (isError) hint.style.color = '#ff6666';
  else hint.style.color = '';
}

// ===== Voice System (per-model) =====
const voiceManager = {
  clickVoices: [],
  idleVoices: [],
  timeWindows: [],
  idleTimeoutMin: 300000,
  idleTimeoutMax: 600000,
  idleTimer: null,
  currentAudio: null,

  stopCurrent() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  },

  play(url) {
    this.stopCurrent();
    const a = new Audio(url);
    a.onerror = () => console.error('Audio load error:', url);
    a.onended = () => { if (this.currentAudio === a) this.currentAudio = null; };
    a.play().catch(e => console.error('Audio play error:', e.message, url));
    this.currentAudio = a;
  },

  async loadForModel(voiceDir) {
    clearTimeout(this.idleTimer);
    clearTimeout(clickTimer);
    lastClickTime = 0;
    this.clickVoices = [];
    this.idleVoices = [];
    this.timeWindows = [];
    try {
      const url = `/voices/${voiceDir}/manifest.json`;
      const res = await fetch(url);
      if (!res.ok) { console.error('Voice manifest fetch failed:', res.status); setHint('语音配置加载失败', true); return; }
      const manifest = await res.json();
      this.clickVoices = manifest.click_voices || [];
      this.idleVoices = manifest.idle_voices || [];
      this.timeWindows = manifest.time_windows || [];
      this.idleTimeoutMin = (manifest.idle_timeout_min_seconds || 300) * 1000;
      this.idleTimeoutMax = (manifest.idle_timeout_max_seconds || 600) * 1000;
      console.log('Voice manifest loaded:', this.clickVoices.length, 'click,', this.idleVoices.length, 'idle,', this.timeWindows.length, 'windows');
    } catch (e) { console.error('Voice manifest error:', e); }
    this.resetIdleTimer();
  },

  isInTimeWindow(w) {
    const now = new Date();
    const cur = (now.getMonth() + 1) * 100 + now.getDate();
    const [sm, sd] = w.start.split('-').map(Number);
    const [em, ed] = w.end.split('-').map(Number);
    const s = sm * 100 + sd, e = em * 100 + ed;
    return s <= e ? (cur >= s && cur <= e) : (cur >= s || cur <= e);
  },

  getActiveIdleVoices() {
    let voices = [...this.idleVoices];
    for (const w of this.timeWindows) {
      if (this.isInTimeWindow(w) && w.idle_voices) {
        voices = voices.concat(w.idle_voices);
      }
    }
    return voices;
  },

  playClickVoice() {
    if (this.clickVoices.length === 0) { console.log('playClickVoice: no voices'); return; }
    const url = this.clickVoices[Math.floor(Math.random() * this.clickVoices.length)];
    console.log('playClickVoice:', url);
    this.play(url);
    this.resetIdleTimer();
  },

  playRandomIdle() {
    if (!idleVoiceEnabled) { console.log('playRandomIdle: idle voice disabled'); return; }
    const pool = this.getActiveIdleVoices();
    if (pool.length === 0) { console.log('playRandomIdle: empty pool'); return; }
    const url = pool[Math.floor(Math.random() * pool.length)];
    console.log('playRandomIdle:', url);
    this.play(url);
  },

  resetIdleTimer() {
    clearTimeout(this.idleTimer);
    const pool = this.getActiveIdleVoices();
    if (pool.length === 0) return;
    const delay = this.idleTimeoutMin + Math.random() * (this.idleTimeoutMax - this.idleTimeoutMin);
    this.idleTimer = setTimeout(() => { this.playRandomIdle(); this.resetIdleTimer(); }, delay);
  },
};

// Populate initial voice data synchronously from preloaded manifest
const initialManifest = api.getInitialVoiceManifest ? api.getInitialVoiceManifest() : null;
if (initialManifest) {
  voiceManager.clickVoices = initialManifest.click_voices || [];
  voiceManager.idleVoices = initialManifest.idle_voices || [];
  voiceManager.timeWindows = initialManifest.time_windows || [];
  voiceManager.idleTimeoutMin = (initialManifest.idle_timeout_min_seconds || 300) * 1000;
  voiceManager.idleTimeoutMax = (initialManifest.idle_timeout_max_seconds || 600) * 1000;
  voiceManager.resetIdleTimer();
}

// Register spine plugin once globally (not on every load)
SpineParser.registerLoaderPlugin();

// ===== Idle Animation Trigger =====
// When not walking, after 90-150s in Relax, play a random one-shot then return to Relax.
function startIdleAnimTimer() {
  clearTimeout(idleAnimTimer);
  idleAnimTimer = null;
  if (walkEnabled || !spineCharacter) return;
  const candidates = availableAnimations.filter(a =>
    a.toLowerCase() !== 'default' && a.toLowerCase() !== 'relax');
  if (candidates.length === 0) return;
  const delay = 90000 + Math.random() * 60000;
  idleAnimTimer = setTimeout(() => {
    idleAnimTimer = null;
    if (walkEnabled || !spineCharacter) return;
    // Only trigger if still in Relax (not overridden by manual animation select)
    const currentAnim = spineCharacter.state.tracks[0]?.animation?.name;
    if (!currentAnim || currentAnim.toLowerCase() !== 'relax') {
      startIdleAnimTimer();
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    console.log('[IdleAnim] playing:', pick);
    spineCharacter.state.setAnimation(0, pick, false);
    spineCharacter.state.addAnimation(0, 'Relax', true, 0);
    startIdleAnimTimer();
  }, delay);
}

// ===== Spine Loading =====
function loadSpineModel(modelDef) {
  return new Promise((resolve, reject) => {
    const loader = new Loader();
    loader.add('char', `/models/${modelDef.dir}/${modelDef.file}.skel`);
    loader.load((_l, resources) => {
      const r = resources.char;
      if (!r) return reject(new Error('资源为空'));
      if (r.error) return reject(r.error);
      if (!r.spineData) return reject(new Error('无 spineData'));
      resolve(r.spineData);
    });
  });
}

async function initSpine() {
  try {
    setHint('加载中...');
    const spineData = await loadSpineModel(MODELS[0]);

    pixiApp = new Application({
      transparent: true,
      autoStart: true,
      width: W,
      height: H,
      antialias: true,
      resolution: window.devicePixelRatio || 2,
    });
    document.getElementById('spine-container').appendChild(pixiApp.view);
    pixiApp.view.style.width = W + 'px';
    pixiApp.view.style.height = H + 'px';

    spineCharacter = new Spine(spineData);
    pixiApp.stage.addChild(spineCharacter);

    availableAnimations = spineData.animations.map((a) => a.name);
    const anim = availableAnimations.includes('Relax') ? 'Relax' : availableAnimations[0];
    spineCharacter.state.setAnimation(0, anim, true);
    spineCharacter.update(0);
    fitCharacter(MODELS[0].scale);
    startIdleAnimTimer();

    setHint('');
    hint.classList.add('hidden');
    api.resizeWindow(W, H);
    // Report character hit area at ~20fps (main process polls at 50ms, no need for 60fps)
    let tickFrame = 0;
    pixiApp.ticker.add(() => {
      if (++tickFrame % 3 !== 0) return; // every 3rd frame ≈ 20fps at 60
      updateHitRect();
      api.updateHitRect(hitRect);
    });
    console.log('hitRect:', JSON.stringify(hitRect));
  } catch (err) {
    setHint('加载失败: ' + err.message, true);
    console.error('Spine init error:', err);
  }
}

const GLOBAL_SCALE = 0.4;

function fitCharacter(modelScale) {
  if (!spineCharacter) return;
  const b = spineCharacter.getBounds() || { width: 200, height: 300 };
  const bh = b.height || 300;
  const ms = modelScale || 1;
  const s = ((H - 10) / bh) * ms * GLOBAL_SCALE;
  spineCharacter.scale.set(Math.max(0.1, s));
  spineCharacter.x = W / 2;
  spineCharacter.y = H * 0.45;
}

async function switchModel(index) {
  const model = MODELS[index];
  try {
    setHint('切换中...');
    hint.classList.remove('hidden');

    const spineData = await loadSpineModel(model);

    if (spineCharacter) {
      pixiApp.stage.removeChild(spineCharacter);
      spineCharacter.destroy({ children: true });
    }

    spineCharacter = new Spine(spineData);
    pixiApp.stage.addChild(spineCharacter);

    availableAnimations = spineData.animations.map((a) => a.name);
    const anim = availableAnimations.includes('Relax') ? 'Relax' : availableAnimations[0];
    spineCharacter.state.setAnimation(0, anim, true);
    spineCharacter.update(0);
    fitCharacter(model.scale);
    startIdleAnimTimer();

    currentModelIndex = index;
    voiceManager.loadForModel(model.voiceDir);
    savePreference('modelIndex', index);

    setHint('');
    hint.classList.add('hidden');
  } catch (err) {
    setHint('切换失败: ' + err.message, true);
    console.error('Switch error:', err);
  }
}

initSpine();
// Only fetch manifest async if we don't have it synced from preload
if (!initialManifest) voiceManager.loadForModel(MODELS[0].voiceDir);

// Load saved chat history (localStorage, synchronous)
loadChatHistory();
// Load user preferences after a short delay to let initSpine finish
setTimeout(loadPreferences, 300);

// Listen for walk toggle confirmation from main process
api.onWalkToggled && api.onWalkToggled((enabled) => {
  walkEnabled = enabled;
  const el = document.getElementById('menu-walk');
  if (el) el.textContent = walkEnabled ? '行走：开' : '行走：关';
});

// Listen for animation commands from main process (walk behavior state machine)
api.onPlayAnimation && api.onPlayAnimation((name) => {
  if (!spineCharacter) return;
  // Case-insensitive name match
  const match = availableAnimations.find(a => a.toLowerCase() === name.toLowerCase());
  const animName = match || name;
  console.log('[Anim] received:', name, '→ using:', animName);
  spineCharacter.state.setAnimation(0, animName, true);
  // When main process returns to Relax (e.g. walk toggled off), restart idle timer
  if (animName.toLowerCase() === 'relax') startIdleAnimTimer();
});

// Expose for inline onclick handlers
window.__toggleBubble = toggleBubble;
window.__hide = () => window.close();
window.__switchModel = () => {
  voiceManager.playClickVoice();
  const next = (currentModelIndex + 1) % MODELS.length;
  switchModel(next);
  hideCtxMenu();
};
window.__testVoice = () => {
  hideCtxMenu();
  const testUrl = '/voice/1/%E4%BA%A4%E8%B0%881.wav';
  console.log('Test voice:', testUrl);
  const a = new Audio(testUrl);
  a.onerror = (e) => { console.error('Test voice load error:', e); setHint('语音加载失败: ' + testUrl, true); };
  a.play().then(() => { console.log('Test voice playing OK'); setHint('播放中...'); setTimeout(() => setHint(''), 2000); })
   .catch(e => { console.error('Test voice play error:', e.message); setHint('播放失败: ' + e.message, true); });
};
window.__voiceClick = () => { voiceManager.playClickVoice(); };
window.__debugStatus = () => {
  return 'hitRect:' + JSON.stringify(hitRect) + ' clickV:' + voiceManager.clickVoices.length + ' idleV:' + voiceManager.idleVoices.length;
};
window.__toggleWalk = () => {
  walkEnabled = !walkEnabled;
  const el = document.getElementById('menu-walk');
  if (el) el.textContent = walkEnabled ? '行走：开' : '行走：关';
  api.toggleWalk && api.toggleWalk();
  savePreference('walkEnabled', walkEnabled);
};
window.__toggleIdleVoice = () => {
  idleVoiceEnabled = !idleVoiceEnabled;
  const el = document.getElementById('menu-idle-voice');
  if (el) el.textContent = idleVoiceEnabled ? '闲置语音: 开' : '闲置语音: 关';
  if (!idleVoiceEnabled) voiceManager.stopCurrent();
  savePreference('idleVoiceEnabled', idleVoiceEnabled);
};
window.__toggleAutostart = () => {
  autoStartEnabled = !autoStartEnabled;
  const el = document.getElementById('menu-autostart');
  if (el) el.textContent = autoStartEnabled ? '开机自启: 开' : '开机自启: 关';
  api.setAutostart && api.setAutostart(autoStartEnabled);
  savePreference('autoStart', autoStartEnabled);
};

// F12: toggle devtools
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12') { api.toggleDevtools && api.toggleDevtools(); }
});

// ===== Click-through + Drag =====
let hitRect = null;
let mouseDown = false;
let lastScreenX = 0, lastScreenY = 0;
let dragStartX = 0, dragStartY = 0;

function updateHitRect() {
  if (!spineCharacter) return;
  const b = spineCharacter.getBounds();
  if (b && b.width > 0 && b.height > 0) {
    hitRect = { x: b.x, y: b.y, w: b.width, h: b.height };
  }
}

function isInCharacter(cx, cy) {
  if (!hitRect) return false;
  return cx >= hitRect.x && cx <= hitRect.x + hitRect.w &&
         cy >= hitRect.y && cy <= hitRect.y + hitRect.h;
}

function isMenuOpen() {
  return ctxMenu && !ctxMenu.classList.contains('hidden');
}

document.addEventListener('mousemove', (e) => {
  if (!pixiApp) return;
  if (mouseDown) {
    const dx = e.screenX - lastScreenX;
    const dy = e.screenY - lastScreenY;
    api.moveWindow(dx, dy);
    lastScreenX = e.screenX;
    lastScreenY = e.screenY;
    return;
  }
  if (bubbleVisible || isMenuOpen()) return;
});

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || bubbleVisible) return;
  if (ctxMenu && ctxMenu.contains(e.target)) return;
  if (ctxMenu && !ctxMenu.contains(e.target)) hideCtxMenu();
  mouseDown = true;
  lastScreenX = e.screenX;
  lastScreenY = e.screenY;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

let lastClickTime = 0;
let clickTimer = null;

document.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return;
  if (!mouseDown) return;
  mouseDown = false;
  if (ctxMenu && ctxMenu.contains(e.target)) return;
  const dx = Math.abs(e.screenX - dragStartX);
  const dy = Math.abs(e.screenY - dragStartY);
  if (dx >= 4 || dy >= 4) return; // drag, not click
  const now = Date.now();
  if (now - lastClickTime < 350) {
    // Double click → play random idle voice
    clearTimeout(clickTimer);
    clickTimer = null;
    if (spineCharacter) {
      spineCharacter.state.setAnimation(0, 'Interact', false);
      spineCharacter.state.addAnimation(0, 'Relax', true, 0);
    }
    voiceManager.playRandomIdle();
    lastClickTime = 0;
    startIdleAnimTimer();
  } else {
    // Potential single click → wait briefly in case it becomes double-click
    lastClickTime = now;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (spineCharacter) {
        spineCharacter.state.setAnimation(0, 'Interact', false);
        spineCharacter.state.addAnimation(0, 'Relax', true, 0);
      }
      voiceManager.playClickVoice();
      clickTimer = null;
      startIdleAnimTimer();
    }, 350);
  }
});

// ===== Right-click Context Menu =====
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!ctxMenu) return;
  api.setIgnoreMouseEvents(false);

  const modelLabel = ctxMenu.querySelector('.model-label');
  if (modelLabel) modelLabel.textContent = MODELS[currentModelIndex].name;

  const animList = ctxMenu.querySelector('.anim-list');
  if (animList && availableAnimations.length > 0) {
    animList.innerHTML = '';
    availableAnimations.forEach((name) => {
      const item = document.createElement('div');
      item.className = 'ctx-item';
      item.textContent = name;
      item.addEventListener('click', () => {
        if (!spineCharacter) return;
        const isOneShot = /special|interact/i.test(name);
        spineCharacter.state.setAnimation(0, name, !isOneShot);
        if (isOneShot) spineCharacter.state.addAnimation(0, 'Relax', true, 0);
        voiceManager.playClickVoice();
        hideCtxMenu();
        startIdleAnimTimer();
      });
      animList.appendChild(item);
    });
  }

  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  requestAnimationFrame(() => {
    const mr = ctxMenu.getBoundingClientRect();
    if (mr.bottom > window.innerHeight) {
      ctxMenu.style.top = Math.max(0, e.clientY - mr.height) + 'px';
    }
  });
  ctxMenu.classList.remove('hidden');
  api.setUiLocked(true);
});

function hideCtxMenu() {
  if (ctxMenu) ctxMenu.classList.add('hidden');
  if (!bubbleVisible) api.setUiLocked(false);
}

// Click outside context menu hides it (single listener covers all cases)
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (bubbleVisible) return; // don't interfere with chat
  if (ctxMenu && !ctxMenu.contains(e.target)) hideCtxMenu();
});

// ===== Chat =====
const chatBubble = document.getElementById('chat-bubble');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

async function toggleBubble() {
  if (isChatting) return;
  bubbleVisible = !bubbleVisible;
  chatBubble.classList.toggle('hidden', !bubbleVisible);
  if (isMaximized && !bubbleVisible) {
    isMaximized = false;
    document.getElementById('chat-maximize').textContent = '□';
  }
  // Close context menu when toggling chat
  hideCtxMenu();
  if (bubbleVisible) {
    api.resizeWindow(W_CHAT, H_CHAT);
    api.setUiLocked(true);
    chatInput.focus();
  } else {
    api.resizeWindow(W, H);
  }
}

// ===== Chat Title Bar: Drag =====
const chatTitlebar = document.querySelector('.chat-titlebar');
let titleDragging = false;
let titleDragStartX = 0, titleDragStartY = 0;

chatTitlebar.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('.chat-titlebar-btns')) return;
  titleDragging = true;
  titleDragStartX = e.screenX;
  titleDragStartY = e.screenY;
});

document.addEventListener('mousemove', (e) => {
  if (!titleDragging) return;
  const dx = e.screenX - titleDragStartX;
  const dy = e.screenY - titleDragStartY;
  api.moveWindow(dx, dy);
  titleDragStartX = e.screenX;
  titleDragStartY = e.screenY;
});

document.addEventListener('mouseup', () => {
  titleDragging = false;
});

// ===== Chat Title Bar: Minimize / Maximize / Close =====
let isMaximized = false;
let preMaximizeState = null;

document.getElementById('chat-close').addEventListener('click', () => {
  if (!bubbleVisible) return;
  bubbleVisible = false;
  chatBubble.classList.add('hidden');
  if (isMaximized) {
    isMaximized = false;
    document.getElementById('chat-maximize').textContent = '□';
  }
  api.resizeWindow(W, H);
  api.setUiLocked(false);
});

document.getElementById('chat-minimize').addEventListener('click', () => {
  api.hideWindow();
});

document.getElementById('chat-maximize').addEventListener('click', async () => {
  if (!bubbleVisible) return;
  if (isMaximized) {
    // Restore
    if (preMaximizeState) {
      api.setPosition(preMaximizeState.x, preMaximizeState.y);
      api.resizeWindow(preMaximizeState.w, preMaximizeState.h);
    }
    isMaximized = false;
    document.getElementById('chat-maximize').textContent = '□';
  } else {
    // Save current state then maximize
    const pos = await api.getPosition();
    preMaximizeState = { x: pos[0], y: pos[1], w: W_CHAT, h: H_CHAT };
    const max = await api.maximizeWindow();
    api.setPosition(max.x, max.y);
    api.resizeWindow(max.width, max.height);
    isMaximized = true;
    document.getElementById('chat-maximize').textContent = '❐';
  }
});

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideCtxMenu();
    if (bubbleVisible) {
      bubbleVisible = false;
      chatBubble.classList.add('hidden');
      if (isMaximized) {
        isMaximized = false;
        document.getElementById('chat-maximize').textContent = '□';
      }
      api.resizeWindow(W, H);
      api.setUiLocked(false);
    }
  }
});

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isChatting) return;
  isChatting = true;
  chatSend.disabled = true;
  chatInput.value = '';
  appendMessage('user', text);
  const el = appendMessage('assistant', '');
  const cs = el.querySelector('.content');
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  cs.appendChild(cursor);

  try {
    const now = new Date();
    const timeInfo = `当前时间：${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}（星期${['日','一','二','三','四','五','六'][now.getDay()]}）`;
    if (conversationHistory.length === 0) {
      conversationHistory.push({ role: 'system', content: systemPrompt + '\n' + timeInfo });
    } else if (conversationHistory.length > 0 && conversationHistory[0].role === 'system') {
      conversationHistory[0].content = systemPrompt + '\n' + timeInfo;
    }
    conversationHistory.push({ role: 'user', content: text });
    if (conversationHistory.length > 30) {
      const summaryIdx = findSummaryIndex();
      const hasSummary = summaryIdx > 0;
      const headCount = hasSummary ? 2 : 1;
      const tailLimit = 29 - (hasSummary ? 1 : 0);
      conversationHistory = [
        conversationHistory[0],
        ...(hasSummary ? [conversationHistory[summaryIdx]] : []),
        ...conversationHistory.slice(headCount).slice(-tailLimit),
      ];
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: conversationHistory,
        max_tokens: 1024,
        temperature: 0.8,
        stream: true,
      }),
    });

    if (!response.ok) throw new Error(`API 错误: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n');
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices[0]?.delta?.content;
          if (content) {
            fullText += content;
            cursor.before(document.createTextNode(content));
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }
        } catch {}
      }
    }

    cursor.remove();
    conversationHistory.push({ role: 'assistant', content: fullText });
    saveChatHistory();
    // Non-blocking memory summarization in background
    maybeSummarize();
  } catch (err) {
    cursor.remove();
    cs.textContent = '出错了: ' + err.message;
    el.style.color = '#e74c3c';
  } finally {
    isChatting = false;
    chatSend.disabled = false;
    chatInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const content = document.createElement('span');
  content.className = 'content';
  content.textContent = text;
  div.appendChild(content);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}
