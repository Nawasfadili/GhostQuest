/* =====================================================
   Discord Quest Completer — background.js (Service Worker)
   Core quest automation engine with:
   1. In-Tab Webpack Bridge (QuestsStore + internal API)
   2. Direct REST API fallback (/quests/@me, /video-progress, /heartbeat)
   3. Full Stealth Engine (Gaussian timing, Desktop Electron headers)
   ===================================================== */

const DISCORD_API = 'https://discord.com/api/v9';

const SUPPORTED_TASKS = [
  'WATCH_VIDEO',
  'WATCH_VIDEO_ON_MOBILE',
  'PLAY_ON_DESKTOP',
  'STREAM_ON_DESKTOP',
  'PLAY_ACTIVITY',
];

// ─────────────────────────────────────────────────────────
// 🛡️  STEALTH ENGINE
// ─────────────────────────────────────────────────────────
const Stealth = {
  gaussian(mean, stdDev) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },

  humanDelay(baseMs, spreadMs = null) {
    if (!state.jitter) return baseMs;
    if (!spreadMs) spreadMs = baseMs * 0.22;
    const val = this.gaussian(baseMs, spreadMs);
    return Math.max(baseMs * 0.5, Math.min(baseMs * 1.8, val));
  },

  nextStepDelay(baseSeconds, isVideo = false) {
    // Video quests report progress every ~7-12s; Play/Stream quests every ~20-35s
    const effectiveBase = isVideo ? Math.min(baseSeconds, 10) : baseSeconds;
    if (!state.jitter) return effectiveBase * 1000;
    return this.humanDelay(effectiveBase * 1000, effectiveBase * 220);
  },

  userAgent() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9163 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36';
  },

  superProperties() {
    const props = {
      os: 'Windows',
      browser: 'Discord Client',
      release_channel: 'stable',
      client_version: '1.0.9163',
      os_version: '10.0.22631',
      os_arch: 'x64',
      app_arch: 'x64',
      system_locale: 'en-US',
      browser_user_agent: this.userAgent(),
      browser_version: '30.2.0',
      client_build_number: 375366,
      native_build_number: 51784,
      client_event_source: null,
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(props))));
  },

  buildHeaders(token) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Discord-Locale': 'en-US',
      'X-Discord-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      'X-Super-Properties': this.superProperties(),
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (token) headers['Authorization'] = token;
    return headers;
  },

  isActiveHour(respectSchedule, activeStart, activeEnd) {
    if (!respectSchedule) return true;
    const hour = new Date().getHours();
    if (activeStart <= activeEnd) {
      return hour >= activeStart && hour < activeEnd;
    }
    return hour >= activeStart || hour < activeEnd;
  },

  _lastRequest: 0,
  async rateLimitGuard(minGapMs = 1200) {
    const now = Date.now();
    const gap = now - this._lastRequest;
    if (gap < minGapMs) {
      await sleep(minGapMs - gap + this.humanDelay(250, 80));
    }
    this._lastRequest = Date.now();
  },

  backoffDelay(attempt) {
    const base = Math.min(25000, 1000 * Math.pow(2, attempt));
    return base + this.humanDelay(base * 0.25, base * 0.1);
  },
};

// ─────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────
let state = {
  isRunning: false,
  cycleBusy: false,
  token: null,
  interval: 25,
  jitter: true,
  notifications: true,
  autoEnroll: true,
  respectSchedule: false,
  activeStart: 8,
  activeEnd: 23,
  quests: [],
  alarmName: 'quest-heartbeat-watchdog',
  loopTimer: null,
  stats: {
    heartbeats: 0,
    completed: 0,
    orbs: 0,
  },
  logs: [],
};

// ─────────────────────────────────────────────────────────
// LOGGER & STATS
// ─────────────────────────────────────────────────────────
function log(message, level = 'info') {
  const entry = {
    message,
    level,
    time: new Date().toLocaleTimeString('en-US', { hour12: false }),
  };
  state.logs.unshift(entry);
  if (state.logs.length > 150) state.logs.pop();
  chrome.storage.local.set({ logs: state.logs });
  chrome.runtime.sendMessage({ type: 'log', message, level }).catch(() => {});
}

function persistStats() {
  chrome.storage.local.set({ stats: state.stats });
  chrome.runtime.sendMessage({ type: 'stats', stats: state.stats }).catch(() => {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

// ─────────────────────────────────────────────────────────
// QUEST NORMALIZER (handles both QuestsStore & /quests/@me)
// ─────────────────────────────────────────────────────────
function normalizeQuest(q) {
  // Already normalized by page-bridge.js?
  if (q && typeof q.questName === 'string' && typeof q.secondsNeeded === 'number') {
    return q;
  }

  const cfg = q.config || {};
  const msgs = cfg.messages || {};
  const userStatus = q.userStatus || q.user_status || null;

  const questName = msgs.questName || msgs.quest_name || cfg.application?.name || `Quest ${q.id}`;
  const gameTitle = msgs.gameTitle || msgs.game_title || cfg.application?.name || '';
  const expiresAt = cfg.expiresAt || cfg.expires_at;
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  const taskConfig = cfg.taskConfig || cfg.taskConfigV2 || cfg.task_config || cfg.task_config_v2 || {};
  const tasks = taskConfig.tasks || {};
  const taskType = SUPPORTED_TASKS.find((t) => tasks[t] != null) || Object.keys(tasks)[0] || 'PLAY_ON_DESKTOP';
  const taskData = tasks[taskType] || {};

  const secondsNeeded = taskData.target || 900;
  const progressMap = userStatus?.progress || {};
  const currentProgress =
    progressMap[taskType]?.value ??
    userStatus?.streamProgressSeconds ??
    userStatus?.stream_progress_seconds ??
    0;

  const enrolledAt = userStatus?.enrolledAt || userStatus?.enrolled_at || null;
  const completedAt = userStatus?.completedAt || userStatus?.completed_at || null;
  const claimedAt = userStatus?.claimedAt || userStatus?.claimed_at || null;

  const applicationId =
    cfg.application?.id ||
    taskData.applications?.[0]?.id ||
    null;

  const rewardsList =
    cfg.rewardsConfig?.rewards ||
    cfg.rewards_config?.rewards ||
    cfg.rewards ||
    [];
  let orbReward = 0;
  let rewardName = '';
  for (const r of rewardsList) {
    const qty = r.orbQuantity ?? r.orb_quantity ?? 0;
    if (qty > 0) orbReward = qty;
    const rName = r.messages?.name || r.name || '';
    if (rName) rewardName = rName;
    if (!orbReward && rName) {
      const match = rName.match(/(\d+)\s*Orbs?/i);
      if (match) orbReward = parseInt(match[1], 10);
    }
  }

  return {
    id: q.id,
    questName,
    gameTitle,
    taskType,
    applicationId,
    secondsNeeded,
    currentProgress: Math.min(secondsNeeded, Math.floor(currentProgress)),
    isEnrolled: !!enrolledAt,
    isCompleted: !!completedAt || currentProgress >= secondsNeeded,
    isClaimed: !!claimedAt,
    isExpired,
    orbReward,
    rewardName: rewardName || (orbReward ? `${orbReward} Orbs` : 'Quest Reward'),
  };
}

// ─────────────────────────────────────────────────────────
// IN-TAB BRIDGE HELPERS
// ─────────────────────────────────────────────────────────
async function findDiscordTab() {
  const tabs = await chrome.tabs.query({
    url: [
      'https://discord.com/*',
      'https://ptb.discord.com/*',
      'https://canary.discord.com/*',
    ],
  });
  return tabs[0] || null;
}

async function ensureBridgeInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['user-agent-override.js', 'page-bridge.js'],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
      world: 'ISOLATED',
    });
  } catch {}
}

async function sendTabBridgeCommand(command, payload = {}) {
  const tab = await findDiscordTab();
  if (!tab) return null;

  try {
    let response = await chrome.tabs.sendMessage(tab.id, {
      action: 'bridgeCommand',
      command,
      payload,
    });
    if (response && response.success) return response.result;
  } catch {
    // Content script wasn't injected yet (tab was open before extension loaded)
    await ensureBridgeInjected(tab.id);
    await sleep(300);
    try {
      let response = await chrome.tabs.sendMessage(tab.id, {
        action: 'bridgeCommand',
        command,
        payload,
      });
      if (response && response.success) return response.result;
    } catch {}
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// DIRECT REST API HELPERS (Fixed endpoints: /quests/@me)
// ─────────────────────────────────────────────────────────
async function discordFetch(path, options = {}, retries = 2) {
  await Stealth.rateLimitGuard(1200);
  const url = `${DISCORD_API}${path}`;
  const headers = Stealth.buildHeaders(state.token);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
      });

      if (resp.status === 429) {
        const retryAfter = parseFloat(resp.headers.get('retry-after') || '5') * 1000;
        const wait = retryAfter + Stealth.humanDelay(1000, 300);
        log(`⏳ Rate limited. Waiting ${Math.round(wait / 1000)}s…`, 'warn');
        await sleep(wait);
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }

      if (resp.status === 204) return {};
      return await resp.json();
    } catch (e) {
      if (attempt < retries && !e.message.includes('401') && !e.message.includes('403') && !e.message.includes('404')) {
        const backoff = Stealth.backoffDelay(attempt);
        log(`Retry ${attempt + 1}/${retries} for ${path} in ${Math.round(backoff / 1000)}s`, 'warn');
        await sleep(backoff);
      } else {
        throw e;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// UNIFIED QUEST OPERATIONS (Tab Bridge first → Direct API fallback)
// ─────────────────────────────────────────────────────────
async function fetchQuests(tokenOverride = null) {
  if (tokenOverride) state.token = tokenOverride;

  // 1. Try reading directly from the open Discord tab's QuestsStore
  const bridgeRes = await sendTabBridgeCommand('GET_QUESTS');
  if (bridgeRes && Array.isArray(bridgeRes.quests) && bridgeRes.quests.length > 0) {
    if (bridgeRes.token && !state.token) {
      state.token = bridgeRes.token;
      chrome.storage.local.set({ token: state.token });
    }
    return bridgeRes.quests.map(normalizeQuest).filter((q) => !q.isExpired);
  }

  // If bridge returned a token even if QuestsStore was empty, save it
  if (bridgeRes?.token && !state.token) {
    state.token = bridgeRes.token;
    chrome.storage.local.set({ token: state.token });
  }

  if (!state.token) {
    throw new Error('No Discord tab ready or token missing. Keep discord.com/quest-home open.');
  }

  // 2. Fallback: Direct API call to GET /quests/@me (NOT /users/@me/quests)
  const data = await discordFetch('/quests/@me', { method: 'GET' });
  const rawList = data?.quests || (Array.isArray(data) ? data : []);
  return rawList.map(normalizeQuest).filter((q) => !q.isExpired);
}

async function enrollQuest(questId) {
  await sleep(Stealth.humanDelay(700, 200));

  const bridgeRes = await sendTabBridgeCommand('ENROLL_QUEST', { questId });
  if (bridgeRes) return bridgeRes;

  return discordFetch(`/quests/${questId}/enroll`, {
    method: 'POST',
    body: JSON.stringify({
      location: 11,
      is_targeted: false,
      metadata_raw: null,
    }),
  });
}

async function stepQuest(quest) {
  const isVideo = quest.taskType === 'WATCH_VIDEO' || quest.taskType === 'WATCH_VIDEO_ON_MOBILE';
  const stepSeconds = isVideo ? 10 : state.interval;

  // 1. Try via open Discord tab's internal API client
  const bridgeRes = await sendTabBridgeCommand('STEP_QUEST', {
    questId: quest.id,
    taskType: quest.taskType,
    currentProgress: quest.currentProgress,
    secondsNeeded: quest.secondsNeeded,
    stepSeconds,
  });

  if (bridgeRes && typeof bridgeRes.progress === 'number') {
    return bridgeRes;
  }

  // 2. Fallback: Direct REST API call
  if (isVideo) {
    const nextTime = Math.min(quest.secondsNeeded, quest.currentProgress + stepSeconds + Math.random());
    const res = await discordFetch(`/quests/${quest.id}/video-progress`, {
      method: 'POST',
      body: JSON.stringify({ timestamp: nextTime }),
    });
    const completed = res?.completed_at != null || nextTime >= quest.secondsNeeded;
    if (nextTime >= quest.secondsNeeded && !res?.completed_at) {
      await discordFetch(`/quests/${quest.id}/video-progress`, {
        method: 'POST',
        body: JSON.stringify({ timestamp: quest.secondsNeeded }),
      });
    }
    return {
      progress: Math.floor(nextTime),
      secondsNeeded: quest.secondsNeeded,
      completed,
    };
  } else {
    const streamKey = `call:${quest.id}:1`;
    const res = await discordFetch(`/quests/${quest.id}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({
        stream_key: streamKey,
        terminal: false,
      }),
    });
    const newProgress =
      res?.progress?.[quest.taskType]?.value ??
      res?.userStatus?.progress?.[quest.taskType]?.value ??
      res?.stream_progress_seconds ??
      Math.min(quest.secondsNeeded, quest.currentProgress + stepSeconds);

    const completed = !!res?.completed_at || newProgress >= quest.secondsNeeded;
    if (completed) {
      try {
        await discordFetch(`/quests/${quest.id}/heartbeat`, {
          method: 'POST',
          body: JSON.stringify({
            stream_key: streamKey,
            terminal: true,
          }),
        });
      } catch {}
    }
    return {
      progress: Math.floor(newProgress),
      secondsNeeded: quest.secondsNeeded,
      completed,
    };
  }
}

// ─────────────────────────────────────────────────────────
// CORE AUTOMATION CYCLE
// ─────────────────────────────────────────────────────────
async function runHeartbeatCycle() {
  if (!state.isRunning || state.cycleBusy) return;
  state.cycleBusy = true;

  try {
    if (!Stealth.isActiveHour(state.respectSchedule, state.activeStart, state.activeEnd)) {
      log('😴 Outside active hours schedule. Pausing cycle.', 'info');
      return;
    }

    const quests = await fetchQuests();
    state.quests = quests;
    chrome.storage.local.set({ quests });
    chrome.runtime.sendMessage({ type: 'quests', quests }).catch(() => {});

    // Filter quests that aren't completed yet
    const pendingQuests = quests.filter((q) => !q.isCompleted);

    if (pendingQuests.length === 0) {
      log('✨ All available quests are completed!', 'success');
      stopCompleter();
      return;
    }

    for (const quest of pendingQuests) {
      if (!state.isRunning) break;

      const label = quest.gameTitle ? `${quest.gameTitle} (${quest.questName})` : quest.questName;

      // Auto-enroll if not yet enrolled
      if (!quest.isEnrolled) {
        if (state.autoEnroll) {
          try {
            log(`📋 Enrolling in "${label}"…`, 'info');
            await enrollQuest(quest.id);
            quest.isEnrolled = true;
            log(`✅ Enrolled in "${label}"`, 'success');
          } catch (e) {
            log(`⚠️ Could not auto-enroll "${label}": ${e.message}. Click "Accept Quest" on Discord first.`, 'warn');
            continue;
          }
        } else {
          continue;
        }
      }

      // Send progress step (video-progress or heartbeat)
      try {
        const result = await stepQuest(quest);
        state.stats.heartbeats++;
        persistStats();

        quest.currentProgress = result.progress;
        quest.isCompleted = result.completed;

        const pct = Math.min(100, Math.round((quest.currentProgress / (quest.secondsNeeded || 1)) * 100));
        const icon = quest.taskType.startsWith('WATCH_VIDEO') ? '🎬' : '💓';
        log(`${icon} ${label} — ${pct}% (${quest.currentProgress}s / ${quest.secondsNeeded}s)`, 'beat');

        if (quest.isCompleted) {
          state.stats.completed++;
          state.stats.orbs += quest.orbReward || 0;
          persistStats();

          const orbText = quest.orbReward ? ` (+${quest.orbReward} Orbs)` : '';
          log(`🎉 Completed "${label}"!${orbText}`, 'success');
          chrome.runtime.sendMessage({ type: 'questComplete', questId: quest.id }).catch(() => {});

          if (state.notifications) {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: 'Discord Quest Completed! 🎉',
              message: `Finished "${label}"${orbText}! Click Claim Reward on Discord if needed.`,
            });
          }
        }
      } catch (e) {
        log(`Step error (${label}): ${e.message}`, 'error');
        if (e.message.includes('401')) {
          log('🔴 Authentication error (401). Please refresh your Discord tab and click Auto-Detect.', 'error');
          stopCompleter();
          return;
        }
      }

      // Human-like pause between quests
      await sleep(Stealth.humanDelay(1100, 300));
    }

    chrome.storage.local.set({ quests: state.quests });
    chrome.runtime.sendMessage({ type: 'quests', quests: state.quests }).catch(() => {});
  } catch (e) {
    log(`Cycle error: ${e.message}`, 'error');
  } finally {
    state.cycleBusy = false;
  }
}

function scheduleNextStep() {
  if (!state.isRunning) return;
  if (state.loopTimer) clearTimeout(state.loopTimer);

  // Use shorter interval if there is an active video quest
  const hasActiveVideo = state.quests.some(
    (q) => !q.isCompleted && q.isEnrolled && q.taskType?.startsWith('WATCH_VIDEO')
  );
  const delayMs = Stealth.nextStepDelay(state.interval, hasActiveVideo);
  log(`⏱ Next progress step in ~${Math.round(delayMs / 1000)}s`, 'info');

  state.loopTimer = setTimeout(async () => {
    if (!state.isRunning) return;
    await runHeartbeatCycle();
    scheduleNextStep();
  }, delayMs);
}

// ─────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────
async function startCompleter(config) {
  if (state.isRunning) return;

  if (config.token) state.token = config.token;
  state.interval = config.interval || 25;
  state.jitter = config.jitter !== false;
  state.notifications = config.notifications !== false;
  state.autoEnroll = config.autoEnroll !== false;
  state.respectSchedule = config.respectSchedule || false;
  state.activeStart = config.activeStart ?? 8;
  state.activeEnd = config.activeEnd ?? 23;
  state.isRunning = true;

  chrome.storage.local.set({ isRunning: true });
  log('🚀 Quest completer started (Stealth + In-Tab Bridge active)', 'success');

  // Keepalive alarm in case Chrome suspends the service worker
  chrome.alarms.create(state.alarmName, { periodInMinutes: 1, delayInMinutes: 1 });

  await runHeartbeatCycle();
  scheduleNextStep();
}

function stopCompleter() {
  state.isRunning = false;
  if (state.loopTimer) {
    clearTimeout(state.loopTimer);
    state.loopTimer = null;
  }
  chrome.alarms.clear(state.alarmName);
  chrome.storage.local.set({ isRunning: false });
  chrome.runtime.sendMessage({ type: 'stopped' }).catch(() => {});
  log('⏹ Stopped.', 'warn');
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === state.alarmName && state.isRunning && !state.cycleBusy) {
    // If setTimeout was cleared by service worker suspension, resume loop
    await runHeartbeatCycle();
    scheduleNextStep();
  }
});

// ─────────────────────────────────────────────────────────
// MESSAGE HANDLER (from popup)
// ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case 'start': {
        try {
          await startCompleter(msg);
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'stop': {
        stopCompleter();
        sendResponse({ success: true });
        break;
      }

      case 'fetchQuests': {
        try {
          const quests = await fetchQuests(msg.token);
          state.quests = quests;
          chrome.storage.local.set({ quests });
          sendResponse({ success: true, quests, token: state.token });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'autoDetectToken': {
        try {
          const res = await sendTabBridgeCommand('GET_TOKEN');
          const token = res?.token || null;
          if (token) {
            state.token = token;
            chrome.storage.local.set({ token });
          }
          sendResponse({ success: !!token, token });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
        break;
      }

      case 'getStatus': {
        sendResponse({
          isRunning: state.isRunning,
          stats: state.stats,
          quests: state.quests,
        });
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  return true;
});

// ─────────────────────────────────────────────────────────
// RESTORE STATE ON STARTUP
// ─────────────────────────────────────────────────────────
async function restoreState() {
  const data = await chrome.storage.local.get([
    'token', 'interval', 'jitter', 'notifications',
    'respectSchedule', 'activeStart', 'activeEnd',
    'isRunning', 'autoStart', 'stats', 'logs', 'quests',
  ]);

  if (data.token) state.token = data.token;
  if (data.stats) state.stats = data.stats;
  if (data.logs) state.logs = data.logs;
  if (data.quests) state.quests = data.quests;

  const shouldStart = data.isRunning || data.autoStart;
  if (shouldStart) {
    log('♻️ Resuming quest completer…', 'info');
    await startCompleter({
      token: data.token,
      interval: data.interval || 25,
      jitter: data.jitter !== false,
      notifications: data.notifications !== false,
      respectSchedule: data.respectSchedule || false,
      activeStart: data.activeStart ?? 8,
      activeEnd: data.activeEnd ?? 23,
    });
  }
}

chrome.runtime.onStartup.addListener(restoreState);
restoreState();
