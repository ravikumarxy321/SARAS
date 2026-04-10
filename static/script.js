/**
 * script.js — SARAS Robot Control
 * ====================================
 * Handles: WebSocket, keyboard, voice, gamepad, face detection, UI wiring.
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CAMERA — declared at TOP so startCamera() is available everywhere
// ══════════════════════════════════════════════════════════════════════════════

let _cameraOn = false;

function startCamera() {
  if (_cameraOn) return;
  const feed      = document.getElementById('cameraFeed');
  const offline   = document.getElementById('cameraOffline');
  const hud       = document.getElementById('cameraHud');
  const badge     = document.getElementById('cameraBadge');
  const btnSnap   = document.getElementById('btnSnapshot');
  const container = document.getElementById('cameraContainer');

  if (!feed) return;

  // Show loading state
  if (offline) {
    offline.style.display = 'flex';
    const p = offline.querySelector('p');
    const s = offline.querySelector('small');
    if (p) p.textContent = 'Camera starting...';
    if (s) s.textContent = 'Connecting to /video_feed';
  }
  if (badge) { badge.textContent = '⏳ STARTING'; badge.className = 'panel-badge warning'; }

  // Load MJPEG stream
  feed.style.display = 'block';
  feed.style.opacity = '0';
  feed.src = '/video_feed?' + Date.now();

  // On first frame received — show the feed
  feed.onload = () => {
    if (offline) offline.style.display = 'none';
    if (hud)     hud.style.display     = 'block';
    feed.style.opacity = '1';
    if (badge) { badge.textContent = '● LIVE'; badge.className = 'panel-badge active'; }
  };

  // On error — show message but keep _cameraOn true so retry works
  feed.onerror = () => {
    feed.style.display = 'none';
    if (offline) {
      offline.style.display = 'flex';
      const p = offline.querySelector('p');
      const s = offline.querySelector('small');
      if (p) p.textContent = 'Camera Error';
      if (s) s.textContent = 'Check USB camera & Flask server';
    }
    if (badge) { badge.textContent = 'ERROR'; badge.className = 'panel-badge danger'; }
    _cameraOn = false;
  };

  if (btnSnap) btnSnap.disabled = false;
  _cameraOn = true;
  console.log('[CAM] Live feed starting → /video_feed');

  // Scroll camera into view
  const camSection = document.querySelector('.camera-panel');
  if (camSection) camSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  if (typeof broadcastAction === 'function') broadcastAction('camera_toggle', { active: true });
}

function stopCamera() {
  const feed      = document.getElementById('cameraFeed');
  const offline   = document.getElementById('cameraOffline');
  const hud       = document.getElementById('cameraHud');
  const badge     = document.getElementById('cameraBadge');
  const container = document.getElementById('cameraContainer');
  const btnSnap   = document.getElementById('btnSnapshot');
  if (feed)      { feed.src = ''; feed.style.display = 'none'; }
  if (offline)   offline.style.display = 'flex';
  if (hud)       hud.style.display     = 'none';
  if (container) container.classList.remove('scanning');
  if (badge)     { badge.textContent   = 'OFF'; badge.className = 'panel-badge'; }
  if (btnSnap)   btnSnap.disabled      = true;
  _cameraOn = false;
  console.log('[CAM] Feed stopped');
  if (typeof broadcastAction === 'function') broadcastAction('camera_toggle', { active: false });
}

// ══════════════════════════════════════════════════════════════════════════════
// BROWSER TEXT-TO-SPEECH (Phone → Bluetooth Speaker)
// Audio plays on phone's connected Bluetooth speaker — NOT Jetson
// ══════════════════════════════════════════════════════════════════════════════

window.speechSynthesis.onvoiceschanged = () => {
  console.log('[TTS] Voices ready:', window.speechSynthesis.getVoices().length);
};

function speakOnPhone(text) {
  window.speechSynthesis.cancel();
  if (!('speechSynthesis' in window)) {
    console.warn('[TTS] Not supported.');
    return;
  }
  const utterance  = new SpeechSynthesisUtterance(text);
  utterance.rate   = 0.88;
  utterance.pitch  = 0.75;
  utterance.volume = 1.0;

  const voices   = window.speechSynthesis.getVoices();
  const engVoice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male'))
                || voices.find(v => v.lang.startsWith('en'))
                || voices[0];
  if (engVoice) utterance.voice = engVoice;

  utterance.onstart = () => { startRobotTalking(); };
  utterance.onend   = () => { stopRobotTalking();  };
  utterance.onerror = () => { stopRobotTalking();  };

  window.speechSynthesis.speak(utterance);
}



// ══════════════════════════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION
// ══════════════════════════════════════════════════════════════════════════════

const socket = io();

socket.on('connect', () => {
  console.log('[WS] Connected');
  updateConnectionStatus(true);
});

socket.on('disconnect', () => {
  console.log('[WS] Disconnected');
  updateConnectionStatus(false);
});

socket.on('state_update', (state) => {
  updateRobotStateUI(state);
});

socket.on('command_logged', (entry) => {
  appendLogEntry(entry);
});

socket.on('log_history', (log) => {
  log.forEach(e => appendLogEntry(e));
});

socket.on('uptime', ({ seconds }) => {
  const el = document.getElementById('uptimeDisplay');
  if (el) el.textContent = formatUptime(seconds);
});

socket.on('robot_speaking', ({ text, active }) => {
  if (active) {
    speakOnPhone(text);     // ← plays on phone's Bluetooth speaker
    showIntroOverlay(text);
  } else {
    hideIntroOverlay();
  }
});

socket.on('face_detected', (face) => {
  showFaceOnRadar(face);
});

socket.on('face_lost', () => {
  clearFaceFromRadar();
});

socket.on('face_status', ({ active }) => {
  const badge = document.getElementById('faceBadge');
  if (badge) {
    badge.textContent = active ? 'TRACKING' : 'STANDBY';
    badge.className   = active ? 'panel-badge active' : 'panel-badge';
  }
  const btn = document.getElementById('btnFaceDetect');
  if (btn) {
    btn.textContent = active ? '◎ STOP TRACKING' : '◎ FOLLOW PERSON';
    btn.classList.toggle('btn-outline', active);
  }
  if (active) startRadarSweep(); else stopRadarSweep();
});

socket.on('obstacle_detected', () => {
  triggerObstacleAlert();
});

socket.on('obstacle_cleared', () => {
  clearObstacleAlert();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function updateConnectionStatus(online) {
  const chip = document.getElementById('connectionStatus');
  if (chip) {
    chip.className = 'tb-pill' + (online ? ' online' : '');
    const dot = chip.querySelector('.tb-dot');
    if (dot) dot.className = 'tb-dot' + (online ? ' active' : '');
    chip.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = online ? 'ONLINE' : 'OFFLINE'; });
  }
  // Hero right floater
  const hfDot    = document.getElementById('hfDot');
  const hfStatus = document.getElementById('hfStatus');
  if (hfDot)    hfDot.className   = 'hf-dot' + (online ? ' online' : '');
  if (hfStatus) hfStatus.textContent = online ? 'ONLINE' : 'OFFLINE';
}


// ══════════════════════════════════════════════════════════════════════════════
// SEND COMMAND (REST + WebSocket)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send a command via WebSocket (preferred) and animate the UI.
 * @param {string} cmd     — 'F'|'B'|'L'|'R'|'S'
 * @param {string} source  — display label
 */
function sendCommand(cmd, source = 'Manual') {
  // If smart tracking is ON and manual control comes in →
  // pause tracking temporarily and let manual take over
  if (_smartTrackActive &&
      ['Keyboard','Manual','Voice','Gamepad'].includes(source)) {
    pauseSmartTrack(cmd, source);
    return;
  }
  socket.emit('command', { command: cmd, source });
  animateMovement(cmd);
}

// ── Smart Track Pause (manual override) ──────────────────────────────────────
let _pauseTimer = null;

function pauseSmartTrack(cmd, source) {
  // Show override indicator
  const badge = document.getElementById('smartTrackBadge');
  if (badge) {
    badge.textContent = '⚡ MANUAL';
    badge.className   = 'panel-badge warning';
  }
  trackLog(`⚡ Manual override: ${source} → ${cmd}`, 'scanning');

  // Send the manual command
  socket.emit('command', { command: cmd, source });
  animateMovement(cmd);

  // After 2 seconds of no manual input → resume smart tracking
  if (_pauseTimer) clearTimeout(_pauseTimer);
  _pauseTimer = setTimeout(() => {
    if (_smartTrackActive) {
      const badge = document.getElementById('smartTrackBadge');
      if (badge) {
        badge.textContent = 'TRACKING';
        badge.className   = 'panel-badge active';
      }
      trackLog('🎯 Resuming smart tracking...', 'found');
    }
  }, 2000);
}

/**
 * Send a command via REST API (fallback / voice).
 */
async function sendCommandREST(cmd, source = 'API') {
  try {
    const res  = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, source }),
    });
    const data = await res.json();
    animateMovement(cmd);
    return data;
  } catch (err) {
    console.error('[API] Command failed:', err);
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// "KNOW ME" — ROBOT INTRODUCTION
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnKnowMe')?.addEventListener('click', async () => {
  try {
    const res  = await fetch('/api/introduce', { method: 'POST' });
    const data = await res.json();
    // Overlay is triggered via WebSocket event from server
    // Fallback: show locally if no WS response within 1 s
    speakOnPhone(data.message);   // ← phone Bluetooth speaker
    setTimeout(() => {
      if (!document.getElementById('introOverlay')?.classList.contains('active')) {
        showIntroOverlay(data.message);
      }
    }, 400);
  } catch (err) {
    // Offline demo mode
    showIntroOverlay(
      "Hello! I am SARAS, an AI powered robot. " +
      "I can move using voice commands, keyboard control, or a game controller. " +
      "I can detect obstacles and avoid them automatically. " +
      "I can also detect and follow a human face using my camera."
    );
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// KEYBOARD CONTROL
// ══════════════════════════════════════════════════════════════════════════════

const KEY_CMD_MAP = {
  'w':          'F', 'ArrowUp':    'F',
  's':          'B', 'ArrowDown':  'B',
  'a':          'L', 'ArrowLeft':  'L',
  'd':          'R', 'ArrowRight': 'R',
  ' ':          'S',   // Space = Stop
};

// Track held keys to avoid repeat events
const _heldKeys = new Set();

document.addEventListener('keydown', (e) => {
  // Ignore when typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const cmd = KEY_CMD_MAP[e.key];
  if (cmd && !_heldKeys.has(e.key)) {
    _heldKeys.add(e.key);
    sendCommand(cmd, 'Keyboard');
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  if (_heldKeys.has(e.key)) {
    _heldKeys.delete(e.key);
    // Auto-stop on key release (optional: comment out to keep moving)
    const cmd = KEY_CMD_MAP[e.key];
    if (cmd && cmd !== 'S') {
      sendCommand('S', 'Keyboard');
    }
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// D-PAD (ON-SCREEN BUTTONS)
// ══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.dpad-btn').forEach(btn => {
  const cmd = btn.dataset.cmd;
  if (!cmd) return;

  // Touch events for mobile
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sendCommand(cmd, 'Manual');
    btn.classList.add('pressed');
  });

  btn.addEventListener('pointerup',    () => {
    btn.classList.remove('pressed');
    if (cmd !== 'S') sendCommand('S', 'Manual');
  });

  btn.addEventListener('pointerleave', () => {
    if (btn.classList.contains('pressed')) {
      btn.classList.remove('pressed');
      if (cmd !== 'S') sendCommand('S', 'Manual');
    }
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// VOICE CONTROL (Web Speech API + backend keyword matching)
// ══════════════════════════════════════════════════════════════════════════════

let _recognition   = null;
let _micActive     = false;
let _audioCtx      = null;
let _analyserNode  = null;
let _micStream     = null;

function buildSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const rec              = new SpeechRecognition();
  rec.continuous         = true;    // keep listening continuously
  rec.lang               = 'en-US'; // Change to hi-IN for Hindi // Hindi + English + Hinglish
  rec.interimResults     = true;
  rec.maxAlternatives    = 1;
  return rec;
}

async function startMicListening() {
  if (_micActive) { stopMicListening(); return; }
  _micActive = true;

  document.getElementById('btnMic')?.classList.add('active');
  document.getElementById('btnMicPanel')?.classList.add('active');
  const label = document.getElementById('waveformLabel');

  // Start audio visualiser
  try {
    _micStream    = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioCtx     = new AudioContext();
    const src     = _audioCtx.createMediaStreamSource(_micStream);
    _analyserNode = _audioCtx.createAnalyser();
    _analyserNode.fftSize = 128;
    src.connect(_analyserNode);
    startWaveformAnimation(_analyserNode);
  } catch {
    startWaveformAnimation(null);
  }

  // Speech recognition
  _recognition = buildSpeechRecognition();
  if (!_recognition) {
    if (label) label.textContent = 'SPEECH API NOT SUPPORTED';
    setTimeout(stopMicListening, 2000);
    return;
  }

  if (label) label.textContent = 'LISTENING...';

  let _lastProcessed = '';
  _recognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    const text   = result[0].transcript.trim();
    if (!text) return;

    // Show in UI always
    document.getElementById('recognizedText').textContent = text;

    // Only process final results + avoid duplicate processing
    if (result.isFinal && text !== _lastProcessed) {
      _lastProcessed = text;
      console.log('[Voice] Final:', text);
      await processVoiceText(text);
      setTimeout(() => { _lastProcessed = ''; }, 1500);
    }
  };

  _recognition.onerror = (err) => {
    console.warn('[Speech Error]', err.error);
    // Only stop on fatal errors — ignore no-speech/aborted
    if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
      stopMicListening();
    }
    // For no-speech/network errors — auto restart
    if (err.error === 'no-speech' || err.error === 'network') {
      if (_micActive) {
        setTimeout(() => {
          if (_micActive && _recognition) {
            try { _recognition.start(); } catch {}
          }
        }, 300);
      }
    }
  };

  _recognition.onend = () => {
    // Auto-restart if user hasn't manually stopped
    if (_micActive) {
      setTimeout(() => {
        if (_micActive) {
          try { _recognition.start(); } catch {}
        }
      }, 200);
    }
  };

  try {
    _recognition.start();
  } catch (e) {
    console.warn('[Speech] Start error:', e);
  }
}

function stopMicListening() {
  _micActive = false;
  document.getElementById('btnMic')?.classList.remove('active');
  document.getElementById('btnMicPanel')?.classList.remove('active');

  if (_recognition) { try { _recognition.stop(); } catch {} _recognition = null; }
  if (_micStream)   { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
  if (_audioCtx)    { _audioCtx.close(); _audioCtx = null; }

  stopWaveformAnimation();
}

async function processVoiceText(text) {
  const lower = text.toLowerCase().trim();

  // ── Show recognised text in voice panel ────────────────────────────────
  const recEl = document.getElementById('recognizedText');
  if (recEl) recEl.textContent = text;

  // ── Special hardware voice triggers ────────────────────────────────────
  if (lower.includes('register') || lower.includes('remember me')) {
    document.getElementById('btnRegisterTarget')?.click();
    speakOnPhone('Registering you as target person');
    return;
  }
  if (lower.includes('start camera') || lower.includes('open camera')) {
    if (!_cameraOn) startCamera();
    speakOnPhone('Camera starting');
    return;
  }

  // ── Ask backend for intent — robot command vs chat ──────────────────────
  let intent = { type: 'chat' };
  try {
    const res = await fetch('/api/intent', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });
    intent = await res.json();
  } catch {
    // Offline fallback — basic local matching
    if      (lower.includes('forward') || lower.includes('aage'))  intent = { type:'command', command:'F' };
    else if (lower.includes('back')    || lower.includes('peeche')) intent = { type:'command', command:'B' };
    else if (lower.includes('left')    || lower.includes('baaye'))  intent = { type:'command', command:'L' };
    else if (lower.includes('right')   || lower.includes('daaye'))  intent = { type:'command', command:'R' };
    else if (lower.includes('stop')    || lower.includes('ruko'))   intent = { type:'command', command:'S' };
    else if (lower.includes('follow'))  intent = { type:'follow' };
    else if (lower.includes('track'))   intent = { type:'track' };
  }

  // ── Route based on intent ───────────────────────────────────────────────
  switch (intent.type) {

    case 'command': {
      const dirs = { F:'Moving Forward', B:'Moving Backward', L:'Turning Left', R:'Turning Right', S:'Stopped' };
      sendCommand(intent.command, 'Voice');
      animateMovement(intent.command);
      appendChatMessage('user', text);
      appendChatMessage('assistant', dirs[intent.command] || 'Command executed.');
      speakOnPhone(dirs[intent.command] || 'Done');
      break;
    }
    case 'follow':
      if (!_faceDetectionActive) toggleFaceDetection();
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Following person now.');
      speakOnPhone('Following person');
      break;

    case 'track':
      if (!_smartTrackActive) document.getElementById('btnSmartTrack')?.click();
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Smart tracking activated.');
      speakOnPhone('Smart tracking activated');
      break;

    case 'chat':
    default:
      // Send to SARAS chatbot — show in chat window
      await sendToChat(text, 'voice');
      break;
  }

  broadcastAction('voice_text', { text });
}

// Wire mic buttons — both hero composer mic and voice panel mic
document.getElementById('btnMic')?.addEventListener('click', () => startMicListening());
document.getElementById('btnMicPanel')?.addEventListener('click', () => startMicListening());

// Quick voice preset buttons — direct command, no intent API needed
const _PRESET_CMD_MAP = {
  // English
  'go forward':  'F', 'forward':   'F', 'move forward': 'F',
  'go backward': 'B', 'backward':  'B', 'move backward': 'B', 'back': 'B',
  'turn left':   'L', 'left':      'L', 'go left': 'L',
  'turn right':  'R', 'right':     'R', 'go right': 'R',
  'stop':        'S', 'halt':      'S', 'freeze': 'S',
  // Hinglish
  'aage chalo':  'F', 'aage jao':  'F', 'aage': 'F', 'seedha chalo': 'F',
  'peeche chalo':'B', 'peeche jao':'B', 'peeche': 'B',
  'left mudo':   'L', 'left karo': 'L', 'baaye': 'L',
  'right mudo':  'R', 'right karo':'R', 'daaye': 'R',
  'ruko':        'S', 'band karo': 'S', 'rukjao': 'S',
  // Devanagari (Hindi script)
  'आगे':         'F', 'आगे चलो':  'F', 'आगे जाओ': 'F', 'सीधे चलो': 'F',
  'पीछे':        'B', 'पीछे चलो': 'B', 'पीछे जाओ': 'B',
  'बाएं':        'L', 'बायें':     'L', 'लेफ्ट':   'L',
  'दाएं':        'R', 'दायें':     'R', 'राइट':    'R',
  'रुको':        'S', 'रुक जाओ':  'S', 'बंद करो': 'S',
  // Devanagari transliterated words (what Google returns)
  'फॉरवर्ड':    'F', 'फारवर्ड':  'F',
  'बैकवर्ड':    'B', 'बेकवर्ड':  'B',
  'स्टॉप':      'S', 'स्टाप':    'S',
};

document.querySelectorAll('.qv-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text  = btn.dataset.text;
    const lower = text.toLowerCase().trim();

    // Show in recognized text panel
    const recEl = document.getElementById('recognizedText');
    if (recEl) recEl.textContent = text;

    // Direct command lookup — fast, no API call needed
    const cmd = _PRESET_CMD_MAP[lower];
    if (cmd) {
      sendCommand(cmd, 'Voice');
      animateMovement(cmd);
      speakOnPhone(text);
      broadcastAction('voice_text', { text });
      return;
    }

    // Fallback to full intent processing for non-movement presets
    await processVoiceText(text);
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// SARAS CHATBOT — send message, receive reply, speak it
// Writes to BOTH hero chat window (cwMessages) and controls chat panel (chatLog)
// ══════════════════════════════════════════════════════════════════════════════

async function sendToChat(text, source = 'text') {
  if (!text.trim()) return;
  _lastChatSource = source;   // track if voice or text

  // ── Intent check first — robot commands should NOT go to chatbot ─────────
  try {
    const intentRes = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const intent = await intentRes.json();
    const dirs = { F:'Forward', B:'Backward', L:'Left', R:'Right', S:'Stopped' };
    if (intent.type === 'command') {
      sendCommand(intent.command, 'Chat');
      animateMovement(intent.command);
      appendChatMessage('user', text);
      appendChatMessage('assistant', `Moving ${dirs[intent.command] || intent.command}.`);
      return;
    }
    if (intent.type === 'follow') {
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Following person now.');
      if (!_faceDetectionActive) toggleFaceDetection();
      return;
    }
    if (intent.type === 'track') {
      appendChatMessage('user', text);
      appendChatMessage('assistant', 'Smart tracking activated.');
      if (!_smartTrackActive) document.getElementById('btnSmartTrack')?.click();
      return;
    }
  } catch { /* offline — fall through to chatbot */ }

  // ── General question → chatbot ───────────────────────────────────────────
  appendChatMessage('user', text);
  const typingEl = showChatTyping();

  try {
    const res  = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text }),
    });
    const data = await res.json();
    removeTypingIndicator(typingEl);
    // Don't appendChatMessage here — socket.on('chat_message') handles it
    if (!data.success) {
      appendChatMessage('assistant', data.reply || 'Sorry, could not respond.');
    }
  } catch {
    removeTypingIndicator(typingEl);
    appendChatMessage('assistant', 'Chatbot offline. Check server connection.');
  }
}

// Append to BOTH chat windows
function appendChatMessage(role, text) {
  const time = new Date().toLocaleTimeString('en', {hour:'2-digit', minute:'2-digit'});

  // ── Hero window (cwMessages) ─────────────────────────────────────────────
  const heroLog = document.getElementById('cwMessages');
  if (heroLog) {
    const el = document.createElement('div');
    el.className = `cw-msg ${role}`;
    if (role === 'assistant') {
      el.innerHTML = `
        <div class="cw-avatar">🪷</div>
        <div class="cw-bubble-wrap">
          <div class="cw-bubble">${escapeHtml(text)}</div>
          <div class="cw-time">${time}</div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="cw-bubble-wrap">
          <div class="cw-bubble">${escapeHtml(text)}</div>
          <div class="cw-time">${time}</div>
        </div>`;
    }
    heroLog.appendChild(el);
    heroLog.scrollTop = heroLog.scrollHeight;
  }

  // ── Controls panel (chatLog) ─────────────────────────────────────────────
  const ctrlLog = document.getElementById('chatLog');
  if (ctrlLog) {
    const empty = ctrlLog.querySelector('.chat-empty');
    if (empty) empty.remove();
    const el = document.createElement('div');
    el.className = `chat-msg chat-${role}`;
    el.innerHTML = `
      <span class="chat-bubble">${escapeHtml(text)}</span>
      <span class="chat-time">${time}</span>`;
    ctrlLog.appendChild(el);
    ctrlLog.scrollTop = ctrlLog.scrollHeight;
  }
}

function showChatTyping() {
  const dots = '<span class="cw-dot"></span><span class="cw-dot"></span><span class="cw-dot"></span>';

  // Hero window typing
  const heroLog = document.getElementById('cwMessages');
  let heroEl = null;
  if (heroLog) {
    heroEl = document.createElement('div');
    heroEl.className = 'cw-msg assistant typing';
    heroEl.innerHTML = `<div class="cw-avatar">🪷</div><div class="cw-bubble-wrap"><div class="cw-bubble">${dots}</div></div>`;
    heroLog.appendChild(heroEl);
    heroLog.scrollTop = heroLog.scrollHeight;
  }

  // Controls panel typing
  const ctrlLog = document.getElementById('chatLog');
  let ctrlEl = null;
  if (ctrlLog) {
    ctrlEl = document.createElement('div');
    ctrlEl.className = 'chat-msg chat-assistant chat-typing';
    ctrlEl.innerHTML = `<span class="chat-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
    ctrlLog.appendChild(ctrlEl);
    ctrlLog.scrollTop = ctrlLog.scrollHeight;
  }

  // Return both so we can remove them
  return { heroEl, ctrlEl };
}

function removeTypingIndicator(els) {
  if (!els) return;
  if (els.heroEl?.parentNode) els.heroEl.parentNode.removeChild(els.heroEl);
  if (els.ctrlEl?.parentNode) els.ctrlEl.parentNode.removeChild(els.ctrlEl);
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Hero composer (cwSend / cwInput / cwMic) ──────────────────────────────
document.getElementById('cwSend')?.addEventListener('click', () => {
  const input = document.getElementById('cwInput');
  if (!input) return;
  const text = input.value.trim();
  if (text) { input.value = ''; sendToChat(text, 'text'); }
});
document.getElementById('cwInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('cwSend')?.click(); }
});
// ── Chat mic — separate from voice section mic ───────────────────────────────
let _chatMicActive = false;
let _lastChatSource = 'text';   // 'voice' or 'text' — controls TTS
let _chatRecognition = null;

document.getElementById('cwMic')?.addEventListener('click', () => {
  if (_chatMicActive) {
    stopChatMic();
  } else {
    startChatMic();
  }
});

function startChatMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert('Speech API not supported in this browser.'); return; }

  _chatMicActive = true;
  const btn = document.getElementById('cwMic');
  if (btn) btn.classList.add('active');

  _chatRecognition = new SpeechRecognition();
  _chatRecognition.lang = 'hi-IN';
  _chatRecognition.continuous = false;
  _chatRecognition.interimResults = true;
  _chatRecognition.maxAlternatives = 1;

  _chatRecognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    const text   = result[0].transcript.trim();
    if (!text) return;
    // Show interim in input box
    document.getElementById('cwInput').value = text;
    // On final — send
    if (result.isFinal) {
      stopChatMic();
      _lastChatSource = 'voice';
      await sendToChat(text, 'voice');
      document.getElementById('cwInput').value = '';
    }
  };

  _chatRecognition.onerror = (e) => {
    console.warn('[Chat Mic]', e.error);
    stopChatMic();
  };

  _chatRecognition.onend = () => stopChatMic();
  _chatRecognition.start();
}

function stopChatMic() {
  _chatMicActive = false;
  const btn = document.getElementById('cwMic');
  if (btn) btn.classList.remove('active');
  if (_chatRecognition) {
    try { _chatRecognition.stop(); } catch {}
    _chatRecognition = null;
  }
}

// ── Hero chip buttons ─────────────────────────────────────────────────────
document.querySelectorAll('.cw-chip').forEach(chip => {
  chip.addEventListener('click', async () => {
    const cmd = chip.dataset.cmd;
    if (cmd) {
      document.getElementById('cwInput').value = cmd;
      document.getElementById('cwSend')?.click();
    }
  });
});

// ── Controls panel chat (btnChatSend / chatInput) ─────────────────────────
document.getElementById('btnChatSend')?.addEventListener('click', () => {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (text) { input.value = ''; sendToChat(text, 'text'); }
});
document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('btnChatSend')?.click(); }
});

// Clear chat
document.getElementById('btnChatClear')?.addEventListener('click', async () => {
  const ctrlLog = document.getElementById('chatLog');
  if (ctrlLog) ctrlLog.innerHTML = '<div class="chat-empty">Conversation cleared.</div>';
  const heroLog = document.getElementById('cwMessages');
  if (heroLog) { heroLog.innerHTML = ''; showWelcomeMessage(); }
  try { await fetch('/api/chat/clear', { method: 'POST' }); } catch {}
});

// WebSocket chat broadcast
socket.on('chat_message', ({ role, text, speak }) => {
  if (role === 'assistant') {
    appendChatMessage(role, text);
    if (speak) speakOnPhone(text);   // always speak
  }
});

// Inject welcome message into hero chat on load
function showWelcomeMessage() {
  const heroLog = document.getElementById('cwMessages');
  if (!heroLog) return;
  const el = document.createElement('div');
  el.className = 'cw-msg assistant';
  el.innerHTML = `
    <div class="cw-avatar">🪷</div>
    <div class="cw-bubble-wrap">
      <div class="cw-bubble">
        Namaste! I am <strong>SARAS</strong> — your AI-powered robot.<br><br>
        Talk to me, ask questions, or give commands like <em>"aage chalo"</em> or <em>"follow me"</em>.<br>
        I understand <strong>50+ languages</strong>. 🪷
      </div>
      <div class="cw-time">Just now</div>
    </div>`;
  heroLog.appendChild(el);
}
document.addEventListener('DOMContentLoaded', showWelcomeMessage);


// ══════════════════════════════════════════════════════════════════════════════
// GAMEPAD API
// ══════════════════════════════════════════════════════════════════════════════

let _gamepadIndex    = null;
let _gamepadLoop     = null;
let _lastGamepadCmd  = null;
const AXIS_THRESHOLD = 0.35;

window.addEventListener('gamepadconnected', (e) => {
  _gamepadIndex = e.gamepad.index;
  console.log(`[GAMEPAD] Physical pad connected: ${e.gamepad.id}`);

  // Badge update
  const badge = document.getElementById('gamepadBadge');
  if (badge) { badge.textContent = `PAD ${_gamepadIndex} CONNECTED`; badge.className = 'panel-badge active'; }

  // Reset button display
  const gpBtn = document.getElementById('gpButtons');
  if (gpBtn) gpBtn.textContent = '—';

  // Show physical panel + dot in virtual gamepad (if rendered)
  const physDot   = document.getElementById('vgpPhysDot');
  const physLabel = document.getElementById('vgpPhysLabel');
  const physPanel = document.getElementById('vgpPhysPanel');
  if (physDot)   physDot.classList.add('vgp-connected');
  if (physLabel) physLabel.textContent = `PAD ${e.gamepad.index}: ${e.gamepad.id.slice(0, 20)}`;
  if (physPanel) physPanel.classList.add('vgp-visible');

  startGamepadLoop();
});

window.addEventListener('gamepaddisconnected', (e) => {
  console.log(`[GAMEPAD] Physical pad disconnected`);
  _gamepadIndex = null;

  const badge = document.getElementById('gamepadBadge');
  if (badge) { badge.textContent = 'VIRTUAL MODE'; badge.className = 'panel-badge'; }

  const physDot   = document.getElementById('vgpPhysDot');
  const physLabel = document.getElementById('vgpPhysLabel');
  const physPanel = document.getElementById('vgpPhysPanel');
  if (physDot)   physDot.classList.remove('vgp-connected');
  if (physLabel) physLabel.textContent = 'No physical pad';
  if (physPanel) physPanel.classList.remove('vgp-visible');

  stopGamepadLoop();
  resetJoystick();
});

function startGamepadLoop() {
  stopGamepadLoop();
  function loop() {
    _gamepadLoop = requestAnimationFrame(loop);
    pollGamepad();
  }
  loop();
}

function stopGamepadLoop() {
  if (_gamepadLoop) { cancelAnimationFrame(_gamepadLoop); _gamepadLoop = null; }
}

function pollGamepad() {
  if (_gamepadIndex === null) return;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp   = pads[_gamepadIndex];
  if (!gp) return;

  const axisX = gp.axes[0] || 0;   // Left stick X
  const axisY = gp.axes[1] || 0;   // Left stick Y

  animateJoystick(axisX, axisY);

  // Determine command from joystick axes
  let cmd = null;
  if      (axisY < -AXIS_THRESHOLD) cmd = 'F';
  else if (axisY >  AXIS_THRESHOLD) cmd = 'B';
  else if (axisX < -AXIS_THRESHOLD) cmd = 'L';
  else if (axisX >  AXIS_THRESHOLD) cmd = 'R';

  // D-pad buttons (standard mapping)
  if (gp.buttons[12]?.pressed) cmd = 'F';
  if (gp.buttons[13]?.pressed) cmd = 'B';
  if (gp.buttons[14]?.pressed) cmd = 'L';
  if (gp.buttons[15]?.pressed) cmd = 'R';

  // Any face button (0-3) → stop
  if ([0,1,2,3].some(i => gp.buttons[i]?.pressed)) cmd = 'S';

  // Only emit when command changes (avoid flooding)
  if (cmd !== _lastGamepadCmd) {
    _lastGamepadCmd = cmd;
    if (cmd) sendCommand(cmd, 'Gamepad');
    else      sendCommand('S', 'Gamepad');

    const pressedNames = gp.buttons
      .map((b, i) => b.pressed ? i : null)
      .filter(i => i !== null)
      .join(', ');
    document.getElementById('gpButtons').textContent = pressedNames || '—';
  }
}


// ══════════════════════════════════════════════════════════════════════════════
// FACE DETECTION TOGGLE — FIXED (single clean handler)
// ══════════════════════════════════════════════════════════════════════════════

let _faceDetectionActive = false;

async function toggleFaceDetection() {
  _faceDetectionActive = !_faceDetectionActive;

  if (_faceDetectionActive) {
    // Step 1 — Start browser camera
    if (!_cameraOn) startCamera();

    // Step 2 — Tell Flask to start camera thread
    try {
      await fetch('/api/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true }),
      });
    } catch { /* offline */ }

    // Step 3 — Wait for camera warmup
    await new Promise(r => setTimeout(r, 1500));

    // Step 4 — Update UI
    updateFaceUI(_faceDetectionActive);

    // Step 5 — Start face detection
    try {
      const res = await fetch('/api/face_detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true }),
      });
      const data = await res.json();
      console.log('[FACE]', data.message);
    } catch (err) {
      console.warn('[FACE] Server not reachable, UI only mode');
    }

  } else {
    // STOP — update UI first
    updateFaceUI(false);

    // Stop face detection on server
    try {
      await fetch('/api/face_detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: false }),
      });
    } catch { /* offline */ }

    // Stop camera
    stopCamera();
    try {
      await fetch('/api/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: false }),
      });
    } catch { /* offline */ }
  }

  broadcastAction('face_toggle', { active: _faceDetectionActive });
}

function updateFaceUI(active) {
  const badge = document.getElementById('faceBadge');
  const btn   = document.getElementById('btnFaceDetect');

  if (active) {
    if (badge) { badge.textContent = 'TRACKING'; badge.className = 'panel-badge active'; }
    if (btn)   btn.innerHTML = '<span class="btn-icon">◉</span> STOP TRACKING';
    startRadarSweep();
  } else {
    if (badge) { badge.textContent = 'STANDBY'; badge.className = 'panel-badge'; }
    if (btn)   btn.innerHTML = '<span class="btn-icon">◉</span> FOLLOW PERSON';
    stopRadarSweep();
    clearFaceFromRadar();
    document.getElementById('faceOffset').textContent = '—';
  }
}

document.getElementById('btnFaceDetect')?.addEventListener('click', toggleFaceDetection);


// ══════════════════════════════════════════════════════════════════════════════
// OBSTACLE SIMULATION BUTTON (for demo / testing)
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnSimObstacle')?.addEventListener('click', () => {
  triggerObstacleAlert();
  sendCommand('S', 'ObstacleSensor');
  setTimeout(clearObstacleAlert, 3000);
});


// ══════════════════════════════════════════════════════════════════════════════
// COMMAND LOG — CLEAR BUTTON
// ══════════════════════════════════════════════════════════════════════════════

document.getElementById('btnClearLog')?.addEventListener('click', () => {
  clearLog();
});


// ══════════════════════════════════════════════════════════════════════════════
// SMOOTH SCROLL HELPER
// ══════════════════════════════════════════════════════════════════════════════

function scrollTo(selector) {
  const el = document.querySelector(selector);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ══════════════════════════════════════════════════════════════════════════════
// PAGE LOAD INIT
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  console.log('[SARAS] Dashboard initialised.');

  // Fetch initial state
  fetch('/api/state')
    .then(r => r.json())
    .then(data => updateRobotStateUI(data))
    .catch(() => console.warn('[API] Could not fetch initial state.'));

  // Fetch initial log
  fetch('/api/log')
    .then(r => r.json())
    .then(log => log.reverse().forEach(e => appendLogEntry(e)))
    .catch(() => {});
});


// ══════════════════════════════════════════════════════════════════════════════
// SCREEN SYNC SYSTEM
// Jo display pe ho → phone pe bhi ho, aur ulta bhi
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Koi bhi action broadcast karo dusri screen ko
 */
function broadcastAction(type, payload = {}) {
  socket.emit('sync_action', { type, payload });
}

/**
 * Dusri screen se action aaya — yahan apply karo
 */
socket.on('sync_action', (data) => {
  console.log('[SYNC] Received:', data.type, data.payload);

  switch (data.type) {

    // ── Intro overlay sync ──────────────────────────────────────
    case 'intro_open':
      showIntroOverlay(data.payload.text);
      speakOnPhone(data.payload.text);   // phone pe bhi bolega
      break;

    case 'intro_close':
      hideIntroOverlay();
      window.speechSynthesis.cancel();
      break;

    // ── Face detection toggle sync ──────────────────────────────
    case 'face_toggle':
      _faceDetectionActive = data.payload.active;
      updateFaceUI(_faceDetectionActive);   // single function handles UI
      break;

    // ── Obstacle simulation sync ────────────────────────────────
    case 'obstacle_sim':
      triggerObstacleAlert();
      setTimeout(clearObstacleAlert, 3000);
      break;

    // ── Voice recognized text sync ──────────────────────────────
    case 'voice_text':
      document.getElementById('recognizedText').textContent = data.payload.text;
      break;
  }
});

// ── Naya device connect hua → poori state maango ─────────────────────────────
socket.on('connect', () => {
  socket.emit('request_full_sync');
});


// ══════════════════════════════════════════════════════════════════════════════
// EXISTING BUTTONS MEIN SYNC ADD KARO
// ══════════════════════════════════════════════════════════════════════════════

// Know Me button — dono screens pe overlay khule
const _origKnowMe = document.getElementById('btnKnowMe');
if (_origKnowMe) {
  _origKnowMe.addEventListener('click', () => {
    const text = "Hello! I am SARAS, an AI powered robot. " +
      "I can move using voice commands, keyboard, or a game controller. " +
      "I can detect obstacles and follow human faces using my camera.";
    broadcastAction('intro_open', { text });
  });
}

// Intro close — dono screens pe band ho
document.getElementById('introClose')?.addEventListener('click', () => {
  broadcastAction('intro_close', {});
});

// Face detection sync — handled inside toggleFaceDetection() above

// Obstacle simulate — dono screens pe alert aaye
document.getElementById('btnSimObstacle')?.addEventListener('click', () => {
  broadcastAction('obstacle_sim', {});
});

// broadcastAction is now called inside processVoiceText directly — no duplicate needed


// ══════════════════════════════════════════════════════════════════════════════
// LIVE CAMERA FEED — startCamera/stopCamera defined at top of file
// ══════════════════════════════════════════════════════════════════════════════

// Snapshot button
document.getElementById('btnSnapshot')?.addEventListener('click', () => {
  const feed = document.getElementById('cameraFeed');
  if (!feed || !_cameraOn) return;

  // Draw current frame to canvas and download
  const canvas = document.createElement('canvas');
  canvas.width  = feed.naturalWidth  || 640;
  canvas.height = feed.naturalHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(feed, 0, 0);

  const link    = document.createElement('a');
  link.download = `sara_snap_${Date.now()}.jpg`;
  link.href     = canvas.toDataURL('image/jpeg', 0.9);
  link.click();
});

// When face detection turns ON → add scanning animation to camera
socket.on('face_status', ({ active }) => {
  const container = document.getElementById('cameraContainer');
  const hudLabel  = document.getElementById('hudLabel');
  if (container) container.classList.toggle('scanning', active);
  if (hudLabel)  hudLabel.textContent = active ? '◉ FACE TRACKING' : 'SARAS CAM';
});

// Sync camera from other screen
socket.on('sync_action', (data) => {
  if (data.type === 'camera_toggle') {
    if (data.payload.active && !_cameraOn) startCamera();
    else if (!data.payload.active && _cameraOn) stopCamera();
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// SMART PERSON TRACKING — UI & Controls
// ══════════════════════════════════════════════════════════════════════════════

let _smartTrackActive  = false;
let _targetRegistered  = false;

// ── Helper: update tracking log ───────────────────────────────────────────────
function trackLog(msg, type = '') {
  const log = document.getElementById('trackLog');
  if (log) {
    log.innerHTML = `<span class="tl-${type}">${msg}</span>`;
  }
}

// ── Helper: update servo indicator position ───────────────────────────────────
function updateServoUI(angle) {
  const indicator = document.getElementById('servoIndicator');
  const display1  = document.getElementById('servoAngle');
  const display2  = document.getElementById('servoAngleDisplay');

  // Map angle (30–150) to percentage (0–100%)
  const pct = ((angle - 30) / (150 - 30)) * 100;
  if (indicator) indicator.style.left = `calc(${pct}% - 8px)`;
  if (display1)  display1.textContent = angle + '°';
  if (display2)  display2.textContent = angle + '°';
}

// ── REGISTER TARGET BUTTON ───────────────────────────────────────────────────
// ── SAVED FACES FUNCTIONS ───────────────────────────────────────────────────

async function loadSavedFaces() {
  try {
    const res   = await fetch('/api/faces');
    const data  = await res.json();
    const list  = document.getElementById('savedFacesList');
    if (!list) return;
    if (!data.faces || data.faces.length === 0) {
      list.innerHTML = '<span class="sf-empty">No saved faces yet.</span>';
      return;
    }
    list.innerHTML = data.faces.map(name => `
      <div class="sf-item">
        <span class="sf-name">👤 ${name}</span>
        <div class="sf-actions">
          <button class="btn btn-sm btn-primary sf-load-btn" data-name="${name}">LOAD</button>
          <button class="btn btn-sm btn-ghost sf-del-btn" data-name="${name}">✕</button>
        </div>
      </div>
    `).join('');

    // Load button
    list.querySelectorAll('.sf-load-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        trackLog(`Loading ${name}...`, 'scanning');
        const res  = await fetch('/api/load_face', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.success) {
          _targetRegistered = true;
          document.getElementById('targetStatus').textContent = `${name} ✓`;
          document.getElementById('btnSmartTrack').disabled   = false;
          trackLog(`✓ ${name} loaded — ready to track!`, 'found');
          speakOnPhone(`${name} loaded`);
        } else {
          trackLog(`✗ ${data.message}`, 'lost');
        }
      });
    });

    // Delete button
    list.querySelectorAll('.sf-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name;
        if (!confirm(`Delete ${name}?`)) return;
        await fetch('/api/delete_face', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name }),
        });
        trackLog(`Deleted ${name}`, '');
        loadSavedFaces();
      });
    });

  } catch { /* offline */ }
}

// Load faces on page load
document.addEventListener('DOMContentLoaded', loadSavedFaces);
document.getElementById('btnRefreshFaces')?.addEventListener('click', loadSavedFaces);

// ── REGISTER TARGET — with name input modal ──────────────────────────────────

document.getElementById('btnRegisterTarget')?.addEventListener('click', () => {
  // Show inline name input row
  const row   = document.getElementById('registerNameRow');
  const input = document.getElementById('faceNameInput');
  if (row) { row.style.display = 'flex'; input?.focus(); input.value = ''; }
});

document.getElementById('btnFaceNameCancel')?.addEventListener('click', () => {
  document.getElementById('registerNameRow').style.display = 'none';
  document.getElementById('faceNameInput').value = '';
});

document.getElementById('btnFaceNameConfirm')?.addEventListener('click', async () => {
  const name = document.getElementById('faceNameInput').value.trim();
  if (!name) { document.getElementById('faceNameInput').focus(); return; }
  document.getElementById('registerNameRow').style.display = 'none';
  document.getElementById('faceNameInput').value = '';
  await doRegisterFace(name);
});

// Enter/Escape in name input
document.getElementById('faceNameInput')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter')  document.getElementById('btnFaceNameConfirm')?.click();
  if (e.key === 'Escape') document.getElementById('btnFaceNameCancel')?.click();
});

async function doRegisterFace(name) {
  const btn = document.getElementById('btnRegisterTarget');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> REGISTERING...';
  trackLog(`Starting camera for ${name}...`, 'scanning');

  // Start camera
  if (!_cameraOn) startCamera();
  try {
    await fetch('/api/camera', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: true }),
    });
  } catch { /* offline */ }

  // Warmup
  trackLog(`Camera warming up — ${name}, stand still!`, 'scanning');
  await new Promise(r => setTimeout(r, 1500));

  trackLog(`Capturing ${name}'s face...`, 'scanning');
  try {
    const res  = await fetch('/api/register_target', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.success) {
      _targetRegistered = true;
      document.getElementById('targetStatus').textContent = `${name} ✓`;
      document.getElementById('btnSmartTrack').disabled   = false;
      trackLog(`✓ ${name} registered & saved!`, 'found');
      speakOnPhone(`${name} registered successfully`);
      btn.innerHTML = '<span class="btn-icon">✓</span> RE-REGISTER';
      loadSavedFaces();   // refresh list
    } else {
      trackLog(`✗ No face found — try again!`, 'lost');
      btn.innerHTML = '<span class="btn-icon">👤</span> REGISTER TARGET';
    }
  } catch {
    _targetRegistered = true;
    document.getElementById('targetStatus').textContent = `${name} ✓`;
    document.getElementById('btnSmartTrack').disabled   = false;
    trackLog(`✓ ${name} registered (demo mode)`, 'found');
    btn.innerHTML = '<span class="btn-icon">✓</span> RE-REGISTER';
  }
  btn.disabled = false;
}


// ── START / STOP SMART TRACKING ───────────────────────────────────────────────
document.getElementById('btnSmartTrack')?.addEventListener('click', async () => {
  _smartTrackActive = !_smartTrackActive;
  const btn   = document.getElementById('btnSmartTrack');
  const badge = document.getElementById('smartTrackBadge');

  if (_smartTrackActive) {
    // Step 1 — Start camera
    if (!_cameraOn) startCamera();
    try {
      await fetch('/api/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true }),
      });
    } catch { /* offline */ }

    // Step 2 — Wait for camera warmup
    await new Promise(r => setTimeout(r, 1500));

    // Step 3 — Update UI
    if (btn)   btn.innerHTML     = '<span class="btn-icon">■</span> STOP TRACKING';
    if (badge) { badge.textContent = 'TRACKING'; badge.className = 'panel-badge active'; }
    trackLog('🎯 Camera ready — starting tracking...', 'scanning');

    // Step 4 — Start tracking on server
    try {
      const res  = await fetch('/api/smart_track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true }),
      });
      const data = await res.json();
      if (!data.success) {
        trackLog('⚠ ' + data.message, 'scanning');
      }
    } catch { /* offline demo */ }

  } else {
    // ── STOP ─────────────────────────────────────────────────────────────
    // Step 1 — Stop server tracking
    try {
      await fetch('/api/smart_track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: false }),
      });
    } catch { /* offline */ }

    // Step 2 — Update UI
    if (btn)   btn.innerHTML     = '<span class="btn-icon">🎯</span> START TRACKING';
    if (badge) { badge.textContent = 'STANDBY'; badge.className = 'panel-badge'; }
    trackLog('Tracking stopped.', '');
    updateServoUI(90);

    // Step 3 — Stop camera
    stopCamera();
    try {
      await fetch('/api/camera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: false }),
      });
    } catch { /* offline */ }
  }
});


// ── WEBSOCKET EVENTS from server ──────────────────────────────────────────────

socket.on('smart_track_update', (data) => {
  updateServoUI(data.servo);
  document.getElementById('trackOffset').textContent = data.offset_x > 0
    ? `+${data.offset_x}px` : `${data.offset_x}px`;
  document.getElementById('trackAction').textContent = data.command || '—';

  const msgs = { F:'Moving forward →', L:'Turning left ←', R:'Turning right →', S:'Stopped ■' };
  trackLog(`🎯 Target found | ${msgs[data.command] || ''}`, 'found');
});

socket.on('target_lost', () => {
  trackLog('⚠ Target lost — scanning...', 'lost');
  document.getElementById('trackAction').textContent = 'SCANNING';
});

socket.on('scan_started', () => {
  trackLog('🔍 Servo scanning for target...', 'scanning');
  document.getElementById('smartTrackBadge').textContent = 'SCANNING';
});

socket.on('scan_found', (data) => {
  trackLog(`✓ Target found at ${data.angle}°`, 'found');
  document.getElementById('smartTrackBadge').textContent = 'TRACKING';
  updateServoUI(data.angle);
});

socket.on('scan_lost', () => {
  trackLog('Target not found — continuing watch...', 'lost');
});

socket.on('bypass_started', () => {
  trackLog('⚠ OBSTACLE! Bypassing...', 'bypass');
  document.getElementById('smartTrackBadge').textContent = 'BYPASSING';
  triggerObstacleAlert();
});

socket.on('bypass_done', () => {
  trackLog('✓ Bypass complete — resuming tracking', 'found');
  document.getElementById('smartTrackBadge').textContent = 'TRACKING';
  clearObstacleAlert();
});

socket.on('servo_angle', (data) => {
  updateServoUI(data.angle);
});

socket.on('smart_track_status', ({ active }) => {
  _smartTrackActive = active;
  const badge = document.getElementById('smartTrackBadge');
  if (!active && badge) {
    badge.textContent = 'STANDBY';
    badge.className   = 'panel-badge';
    updateServoUI(90);
  }
});

socket.on('target_registered', (data) => {
  if (data.success) {
    document.getElementById('targetStatus').textContent = 'REGISTERED ✓';
    document.getElementById('btnSmartTrack').disabled   = false;
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// VIRTUAL GAMEPAD CONTROLLER
// Drag joystick + D-pad + Face buttons + Shoulder buttons
// Works alongside real physical gamepad when connected
// ══════════════════════════════════════════════════════════════════════════════

(function initVirtualGamepad() {

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const vjZone      = document.getElementById('vjZone');
  const vjKnob      = document.getElementById('vjKnob');
  const vjBase      = document.getElementById('vjBase');
  const vjAxisXEl   = document.getElementById('vjAxisX');
  const vjAxisYEl   = document.getElementById('vjAxisY');
  const cmdDisplay  = document.getElementById('vgpCmdDisplay');
  const physPanel   = document.getElementById('vgpPhysPanel');
  const physDot     = document.getElementById('vgpPhysDot');
  const physLabel   = document.getElementById('vgpPhysLabel');

  if (!vjZone) return;   // panel not in DOM — safety exit

  // ── Constants ────────────────────────────────────────────────────────────
  const KNOB_RADIUS    = 60;    // max px travel from center (matches up to 190px base)
  const DEAD_ZONE      = 0.22;  // ignore tiny movements
  const CMD_THRESHOLD  = 0.38;  // axis must exceed this to trigger move

  // ── State ────────────────────────────────────────────────────────────────
  let joyActive  = false;
  let lastVJCmd  = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function setAxisDisplay(ax, ay) {
    if (vjAxisXEl) vjAxisXEl.textContent = ax.toFixed(2);
    if (vjAxisYEl) vjAxisYEl.textContent = ay.toFixed(2);
    const gx = document.getElementById('gpAxisX');
    const gy = document.getElementById('gpAxisY');
    if (gx) gx.textContent = ax.toFixed(2);
    if (gy) gy.textContent = ay.toFixed(2);
  }

  function setCmdDisplay(cmd) {
    if (!cmdDisplay) return;
    const MAP = { F:'FORWARD ↑', B:'BACKWARD ↓', L:'LEFT ←', R:'RIGHT →', S:'STOP ■' };
    cmdDisplay.textContent = (cmd && cmd !== 'S') ? (MAP[cmd] || cmd) : 'STANDBY';
    cmdDisplay.classList.toggle('vgp-cmd-active', !!(cmd && cmd !== 'S'));
  }

  function setDirArrow(cmd) {
    if (!vjBase) return;
    vjBase.className = 'vgp-joystick-base' + (cmd ? ` vdir-${cmd}` : '');
  }

  function dispatchVirtualCmd(cmd, source) {
    if (typeof sendCommand === 'function') sendCommand(cmd, source || 'Gamepad');
    if (typeof animateMovement === 'function') animateMovement(cmd);
  }

  // ── Joystick drag logic ───────────────────────────────────────────────────
  function getZoneCenter() {
    const r = vjZone.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function processJoyMove(clientX, clientY) {
    const c  = getZoneCenter();
    let dx   = clientX - c.x;
    let dy   = clientY - c.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    if (d > KNOB_RADIUS) {
      const s = KNOB_RADIUS / d;
      dx *= s; dy *= s;
    }

    const rawAx = dx / KNOB_RADIUS;
    const rawAy = dy / KNOB_RADIUS;
    const ax    = Math.abs(rawAx) < DEAD_ZONE ? 0 : rawAx;
    const ay    = Math.abs(rawAy) < DEAD_ZONE ? 0 : rawAy;

    // Move knob visually (CSS translate from center)
    if (vjKnob) {
      vjKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }

    setAxisDisplay(ax, ay);

    let cmd = null;
    if      (ay < -CMD_THRESHOLD) cmd = 'F';
    else if (ay >  CMD_THRESHOLD) cmd = 'B';
    else if (ax < -CMD_THRESHOLD) cmd = 'L';
    else if (ax >  CMD_THRESHOLD) cmd = 'R';

    setDirArrow(cmd);
    setCmdDisplay(cmd);

    if (cmd !== lastVJCmd) {
      lastVJCmd = cmd;
      dispatchVirtualCmd(cmd || 'S', 'Gamepad');
    }
  }

  function resetJoyVisual() {
    if (vjKnob) vjKnob.style.transform = 'translate(-50%, -50%)';
    setAxisDisplay(0, 0);
    setDirArrow(null);
    setCmdDisplay(null);
    vjZone.classList.remove('vgp-active');
    if (lastVJCmd !== 'S') {
      lastVJCmd = 'S';
      dispatchVirtualCmd('S', 'Gamepad');
    }
  }

  // ── Pointer events (unified mouse + touch) ───────────────────────────────
  vjZone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    joyActive = true;
    vjZone.classList.add('vgp-active');
    try { vjZone.setPointerCapture(e.pointerId); } catch (_) {}
    processJoyMove(e.clientX, e.clientY);
  });

  vjZone.addEventListener('pointermove', (e) => {
    if (!joyActive) return;
    e.preventDefault();
    processJoyMove(e.clientX, e.clientY);
  });

  ['pointerup', 'pointercancel'].forEach(evt => {
    vjZone.addEventListener(evt, () => { joyActive = false; resetJoyVisual(); });
  });


  // ── Helper: wire press-and-hold buttons ──────────────────────────────────
  function wireHoldButton(el, cmd) {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('vgp-pressed');
      dispatchVirtualCmd(cmd, 'Gamepad');
      setCmdDisplay(cmd !== 'S' ? cmd : null);
    });
    const release = () => {
      el.classList.remove('vgp-pressed');
      if (cmd !== 'S') {
        dispatchVirtualCmd('S', 'Gamepad');
        setCmdDisplay(null);
      }
    };
    el.addEventListener('pointerup',     release);
    el.addEventListener('pointerleave',  release);
    el.addEventListener('pointercancel', release);
  }

  // ── Wire D-Pad buttons ────────────────────────────────────────────────────
  document.querySelectorAll('.vgp-dpad-btn').forEach(btn => {
    wireHoldButton(btn, btn.dataset.cmd);
  });

  // ── Wire Face buttons ─────────────────────────────────────────────────────
  document.querySelectorAll('.vgp-face-btn').forEach(btn => {
    wireHoldButton(btn, btn.dataset.cmd);
  });

  // ── Wire Shoulder buttons ─────────────────────────────────────────────────
  document.querySelectorAll('.vgp-shoulder').forEach(btn => {
    wireHoldButton(btn, btn.dataset.cmd);
  });


  // ── Mirror physical gamepad axes → virtual joystick knob ─────────────────
  const _origAnimateJoystick = window.animateJoystick;
  window.animateJoystick = function(axisX, axisY) {
    if (typeof _origAnimateJoystick === 'function') _origAnimateJoystick(axisX, axisY);
    // Reflect onto virtual knob only when user is NOT dragging it manually
    if (!joyActive && vjKnob) {
      const dx = axisX * KNOB_RADIUS;
      const dy = axisY * KNOB_RADIUS;
      vjKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      setAxisDisplay(axisX, axisY);
      const THRESHOLD = 0.35;
      const physCmd =
        axisY < -THRESHOLD ? 'F' :
        axisY >  THRESHOLD ? 'B' :
        axisX < -THRESHOLD ? 'L' :
        axisX >  THRESHOLD ? 'R' : null;
      setDirArrow(physCmd);
      setCmdDisplay(physCmd);
    }
  };

  console.log('[VirtualGamepad] ✓ Initialised — joystick, D-pad, face buttons, shoulders ready.');

})();
