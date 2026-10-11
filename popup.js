/* =====================================================
   Discord Quest Completer — popup.js
   Handles UI logic, quest list rendering, and messaging
   with background service worker & Discord tab bridge.
   ===================================================== */

// ── DOM references ──────────────────────────────────────
const tokenInput      = document.getElementById('tokenInput');
const toggleTokenBtn  = document.getElementById('toggleToken');
const autoDetectBtn   = document.getElementById('autoDetectBtn');
const refreshBtn      = document.getElementById('refreshBtn');
const startBtn        = document.getElementById('startBtn');
const stopBtn         = document.getElementById('stopBtn');
const clearLogBtn     = document.getElementById('clearLogBtn');
const questsList      = document.getElementById('questsList');
const logContainer    = document.getElementById('logContainer');
const statusBadge     = document.getElementById('statusBadge');
const statusText      = document.getElementById('statusText');
const intervalSlider  = document.getElementById('intervalSlider');
const intervalValue   = document.getElementById('intervalValue');
const autoStartToggle = document.getElementById('autoStartToggle');
const notifToggle     = document.getElementById('notifToggle');
const jitterToggle    = document.getElementById('jitterToggle');
const scheduleToggle  = document.getElementById('scheduleToggle');
const scheduleRow     = document.getElementById('scheduleRow');
const activeStartInp  = document.getElementById('activeStart');
const activeEndInp    = document.getElementById('activeEnd');
const statHeartbeats  = document.getElementById('statHeartbeats');
const statCompleted   = document.getElementById('statCompleted');
const statOrbs        = document.getElementById('statOrbs');

// ── State ────────────────────────────────────────────────
let isRunning = false;

// ── Helpers ──────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function addLog(message, type = 'info') {
  const placeholder = logContainer.querySelector('.log-entry.log-info:only-child');
  if (placeholder && placeholder.textContent.includes('Extension loaded')) {
    logContainer.innerHTML = '';
  }

  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.setAttribute('data-time', now());
  entry.textContent = message;
  logContainer.prepend(entry);

  const entries = logContainer.querySelectorAll('.log-entry');
  if (entries.length > 100) entries[entries.length - 1].remove();
}

function setStatus(text, cls = '') {
  statusText.textContent = text;
  statusBadge.className = 'status-badge ' + cls;
}

function updateStats(stats) {
  if (stats.heartbeats !== undefined) statHeartbeats.textContent = stats.heartbeats;
  if (stats.completed !== undefined) statCompleted.textContent = stats.completed;
  if (stats.orbs !== undefined) statOrbs.textContent = stats.orbs;
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
}

function renderQuests(quests) {
  if (!quests || quests.length === 0) {
    questsList.innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <p>No active quests found.<br/>Open <b>discord.com/quest-home</b> and click Refresh.</p>
      </div>`;
    return;
  }

  // Sort uncompleted quests first
  const sorted = [...quests].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));

  questsList.innerHTML = '';
  sorted.forEach((q) => {
    const req = q.secondsNeeded || 1;
    const cur = q.currentProgress || 0;
    const pct = Math.min(100, Math.round((cur / req) * 100));
    const done = !!q.isCompleted || pct >= 100;

    const card = document.createElement('div');
    card.className = `quest-card${done ? ' completed' : q.isEnrolled ? ' active' : ''}`;
    card.dataset.questId = q.id;

    const title = q.gameTitle ? `${q.gameTitle} — ${q.questName}` : q.questName || `Quest ${q.id}`;
    const isVideo = (q.taskType || '').startsWith('WATCH_VIDEO');
    const actionLabel = isVideo ? '🎬 Watch' : '🎮 Play';
    const statusLabel = done ? '✓ Done' : q.isEnrolled ? `${pct}%` : `Not Enrolled (${pct}%)`;
    const rewardDisplay = q.orbReward ? `🔮 ${q.orbReward} Orbs` : `🎁 ${escHtml(q.rewardName || 'Reward')}`;

    card.innerHTML = `
      <div class="quest-header">
        <span class="quest-name" title="${escHtml(title)}">${escHtml(title)}</span>
        <span class="quest-tag${done ? ' done' : ''}">${statusLabel}</span>
      </div>
      <div class="quest-progress-bar">
        <div class="quest-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="quest-meta">
        <span>${actionLabel} · ${formatDuration(cur)} / ${formatDuration(req)}</span>
        <span>${rewardDisplay}</span>
      </div>`;
    questsList.appendChild(card);
  });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Load saved settings ──────────────────────────────────
async function loadSettings() {
  const data = await chrome.storage.local.get([
    'token', 'interval', 'autoStart', 'notifications', 'jitter',
    'respectSchedule', 'activeStart', 'activeEnd',
    'stats', 'logs', 'isRunning', 'quests',
  ]);

  if (data.token) tokenInput.value = data.token;
  if (data.interval) {
    intervalSlider.value = data.interval;
    intervalValue.textContent = data.interval + 's';
  }
  if (data.autoStart) autoStartToggle.checked = data.autoStart;
  if (data.notifications !== undefined) notifToggle.checked = data.notifications;
  if (data.jitter !== undefined) jitterToggle.checked = data.jitter;
  if (data.respectSchedule !== undefined) {
    scheduleToggle.checked = data.respectSchedule;
    scheduleRow.style.display = data.respectSchedule ? 'flex' : 'none';
  }
  if (data.activeStart !== undefined) activeStartInp.value = data.activeStart;
  if (data.activeEnd !== undefined) activeEndInp.value = data.activeEnd;
  if (data.stats) updateStats(data.stats);
  if (data.quests && data.quests.length) renderQuests(data.quests);

  if (data.logs && data.logs.length) {
    logContainer.innerHTML = '';
    data.logs.slice().reverse().forEach((l) => {
      const entry = document.createElement('div');
      entry.className = `log-entry log-${l.type}`;
      entry.setAttribute('data-time', l.time);
      entry.textContent = l.message;
      logContainer.appendChild(entry);
    });
  }

  if (data.isRunning) {
    isRunning = true;
    setStatus('Running', 'running');
    startBtn.disabled = true;
    stopBtn.disabled = false;
  }

  // Automatically sync quests & token from open Discord tab
  const resp = await chrome.runtime.sendMessage({
    action: 'fetchQuests',
    token: tokenInput.value.trim() || null,
  });
  if (resp?.success) {
    if (resp.token && !tokenInput.value) {
      tokenInput.value = resp.token;
    }
    renderQuests(resp.quests);
  }
}

// ── Save settings ────────────────────────────────────────
function saveSettings() {
  chrome.storage.local.set({
    token: tokenInput.value.trim(),
    interval: parseInt(intervalSlider.value, 10),
    autoStart: autoStartToggle.checked,
    notifications: notifToggle.checked,
    jitter: jitterToggle.checked,
    respectSchedule: scheduleToggle.checked,
    activeStart: parseInt(activeStartInp.value, 10) || 8,
    activeEnd: parseInt(activeEndInp.value, 10) || 23,
  });
}

// ── Schedule toggle ──────────────────────────────────────
scheduleToggle.addEventListener('change', () => {
  scheduleRow.style.display = scheduleToggle.checked ? 'flex' : 'none';
  saveSettings();
});
activeStartInp.addEventListener('change', saveSettings);
activeEndInp.addEventListener('change', saveSettings);

// ── Auto-detect token ────────────────────────────────────
autoDetectBtn.addEventListener('click', async () => {
  autoDetectBtn.textContent = 'Detecting…';
  autoDetectBtn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'autoDetectToken' });
    if (resp?.success && resp.token) {
      tokenInput.value = resp.token;
      saveSettings();
      addLog('Token auto-detected from Discord tab!', 'success');
      // Also refresh quests immediately
      refreshBtn.click();
    } else {
      addLog('Could not auto-detect token. Make sure discord.com is open and logged in.', 'warn');
    }
  } catch (e) {
    addLog('Auto-detect error: ' + e.message, 'error');
  } finally {
    autoDetectBtn.textContent = 'Auto-Detect';
    autoDetectBtn.disabled = false;
  }
});

// ── Toggle token visibility ──────────────────────────────
toggleTokenBtn.addEventListener('click', () => {
  tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
});

// ── Refresh quests ───────────────────────────────────────
refreshBtn.addEventListener('click', async () => {
  saveSettings();
  refreshBtn.disabled = true;
  refreshBtn.style.opacity = '0.5';
  addLog('Fetching quests from Discord…', 'info');

  const response = await chrome.runtime.sendMessage({
    action: 'fetchQuests',
    token: tokenInput.value.trim() || null,
  });

  refreshBtn.disabled = false;
  refreshBtn.style.opacity = '';

  if (response?.success) {
    if (response.token && !tokenInput.value) {
      tokenInput.value = response.token;
    }
    renderQuests(response.quests);
    const pending = response.quests.filter((q) => !q.isCompleted).length;
    addLog(`Loaded ${response.quests.length} quest(s) (${pending} uncompleted).`, 'success');
  } else {
    addLog('Failed to fetch quests: ' + (response?.error || 'Unknown error'), 'error');
  }
});

// ── Start ────────────────────────────────────────────────
startBtn.addEventListener('click', async () => {
  saveSettings();

  const response = await chrome.runtime.sendMessage({
    action: 'start',
    token: tokenInput.value.trim() || null,
    interval: parseInt(intervalSlider.value, 10),
    jitter: jitterToggle.checked,
    notifications: notifToggle.checked,
    respectSchedule: scheduleToggle.checked,
    activeStart: parseInt(activeStartInp.value, 10) || 8,
    activeEnd: parseInt(activeEndInp.value, 10) || 23,
  });

  if (response?.success) {
    isRunning = true;
    setStatus('Running', 'running');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    addLog('Quest completer started!', 'success');
  } else {
    addLog('Failed to start: ' + (response?.error || 'Unknown error'), 'error');
  }
});

// ── Stop ─────────────────────────────────────────────────
stopBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'stop' });
  isRunning = false;
  setStatus('Stopped');
  startBtn.disabled = false;
  stopBtn.disabled = true;
  addLog('Quest completer stopped.', 'warn');
});

// ── Clear log ────────────────────────────────────────────
clearLogBtn.addEventListener('click', () => {
  logContainer.innerHTML = '<div class="log-entry log-info">Log cleared.</div>';
  chrome.storage.local.set({ logs: [] });
});

// ── Slider ───────────────────────────────────────────────
intervalSlider.addEventListener('input', () => {
  intervalValue.textContent = intervalSlider.value + 's';
});

// ── Listen for messages from background ─────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'log') addLog(msg.message, msg.level || 'info');
  if (msg.type === 'stats') updateStats(msg.stats);
  if (msg.type === 'quests') renderQuests(msg.quests);
  if (msg.type === 'questComplete') {
    const card = questsList.querySelector(`[data-quest-id="${msg.questId}"]`);
    if (card) {
      card.classList.add('completed');
      card.querySelector('.quest-progress-fill').style.width = '100%';
      card.querySelector('.quest-tag').className = 'quest-tag done';
      card.querySelector('.quest-tag').textContent = '✓ Done';
    }
  }
  if (msg.type === 'stopped') {
    isRunning = false;
    setStatus('Idle');
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

// ── Init ─────────────────────────────────────────────────
loadSettings();
