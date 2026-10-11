/* =====================================================
   Discord Quest Completer — page-bridge.js (MAIN World)
   Hooks into Discord's internal Webpack stores & API client
   so requests use the real browser session, cookies, and
   X-Super-Properties without 404 or 401 errors.
   ===================================================== */

(function () {
  'use strict';

  const SUPPORTED_TASKS = [
    'WATCH_VIDEO',
    'WATCH_VIDEO_ON_MOBILE',
    'PLAY_ON_DESKTOP',
    'STREAM_ON_DESKTOP',
    'PLAY_ACTIVITY',
  ];

  let cachedModules = null;

  function getWebpackRequire() {
    if (typeof window.webpackChunkdiscord_app === 'undefined') return null;
    try {
      const origDollar = window.$;
      try { delete window.$; } catch {}
      let wpRequire = null;
      window.webpackChunkdiscord_app.push([
        [Symbol()],
        {},
        (r) => { wpRequire = r; },
      ]);
      window.webpackChunkdiscord_app.pop();
      if (origDollar !== undefined) window.$ = origDollar;
      return wpRequire;
    } catch {
      return null;
    }
  }

  function findModule(wpRequire, predicate) {
    if (!wpRequire || !wpRequire.c) return null;
    for (const mod of Object.values(wpRequire.c)) {
      if (!mod || !mod.exports) continue;
      const exp = mod.exports;
      try {
        if (exp.A && predicate(exp.A)) return exp.A;
        if (exp.Ay && predicate(exp.Ay)) return exp.Ay;
        if (exp.ZP && predicate(exp.ZP)) return exp.ZP;
        if (exp.default && predicate(exp.default)) return exp.default;
        if (exp.h && predicate(exp.h)) return exp.h;
        if (predicate(exp)) return exp;
      } catch {}
    }
    return null;
  }

  function getModules() {
    if (cachedModules && cachedModules.QuestsStore && cachedModules.api) {
      return cachedModules;
    }
    const wpRequire = getWebpackRequire();
    if (!wpRequire) return null;

    const QuestsStore = findModule(wpRequire, (m) => m?.__proto__?.getQuest || m?.getQuest);
    const ChannelStore = findModule(wpRequire, (m) => m?.__proto__?.getAllThreadsForParent || m?.getSortedPrivateChannels);
    const GuildChannelStore = findModule(wpRequire, (m) => m?.getSFWDefaultChannel || m?.getAllGuilds);
    const RunningGameStore = findModule(wpRequire, (m) => m?.getRunningGames);
    const FluxDispatcher = findModule(wpRequire, (m) => m?.__proto__?.flushWaitQueue || m?.dispatch);
    const AuthStore = findModule(wpRequire, (m) => typeof m?.getToken === 'function' && !m?.getUsers);
    const apiMod = findModule(wpRequire, (m) => m?.Bo?.get || m?.tn?.get || (typeof m?.get === 'function' && typeof m?.post === 'function'));
    const api = apiMod?.Bo || apiMod?.tn || apiMod;

    cachedModules = {
      QuestsStore,
      ChannelStore,
      GuildChannelStore,
      RunningGameStore,
      FluxDispatcher,
      AuthStore,
      api,
    };
    return cachedModules;
  }

  function extractToken() {
    try {
      const mods = getModules();
      if (mods?.AuthStore?.getToken) {
        const t = mods.AuthStore.getToken();
        if (t) return t;
      }
    } catch {}

    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      const raw = iframe.contentWindow.localStorage.getItem('token');
      iframe.remove();
      if (raw) return raw.replace(/^"|"$/g, '');
    } catch {}

    return null;
  }

  function normalizeQuest(q) {
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

    // Extract Orb reward amount
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

  async function fetchQuestsFromClient() {
    const mods = getModules();
    let rawQuests = [];

    if (mods?.QuestsStore?.quests) {
      if (mods.QuestsStore.quests instanceof Map) {
        rawQuests = [...mods.QuestsStore.quests.values()];
      } else if (Array.isArray(mods.QuestsStore.quests)) {
        rawQuests = mods.QuestsStore.quests;
      } else if (typeof mods.QuestsStore.quests === 'object') {
        rawQuests = Object.values(mods.QuestsStore.quests);
      }
    }

    // If store wasn't populated yet, call GET /quests/@me via internal API
    if (rawQuests.length === 0 && mods?.api?.get) {
      try {
        const res = await mods.api.get({ url: '/quests/@me' });
        rawQuests = res?.body?.quests || (Array.isArray(res?.body) ? res.body : []);
      } catch {}
    }

    const normalized = rawQuests
      .map(normalizeQuest)
      .filter((q) => !q.isExpired);

    return normalized;
  }

  async function enrollQuestInClient(questId) {
    const mods = getModules();
    if (!mods?.api?.post) throw new Error('Discord internal API not ready');
    const res = await mods.api.post({
      url: `/quests/${questId}/enroll`,
      body: {
        location: 11,
        is_targeted: false,
        metadata_raw: null,
      },
    });
    return res?.body;
  }

  function getStreamKey(mods, questId) {
    let channelId = null;
    try {
      channelId = mods.ChannelStore?.getSortedPrivateChannels?.()?.[0]?.id;
      if (!channelId && mods.GuildChannelStore?.getAllGuilds) {
        const guilds = Object.values(mods.GuildChannelStore.getAllGuilds());
        const withVocal = guilds.find((g) => g?.VOCAL?.length > 0);
        if (withVocal) channelId = withVocal.VOCAL[0].channel.id;
      }
    } catch {}
    return channelId ? `call:${channelId}:1` : `call:${questId}:1`;
  }

  async function stepQuestInClient(payload) {
    const { questId, taskType, currentProgress, secondsNeeded, stepSeconds } = payload;
    const mods = getModules();
    if (!mods?.api?.post) throw new Error('Discord internal API not ready');

    const isVideo = taskType === 'WATCH_VIDEO' || taskType === 'WATCH_VIDEO_ON_MOBILE';

    if (isVideo) {
      const delta = (stepSeconds || 10) + Math.random();
      const nextTime = Math.min(secondsNeeded, currentProgress + delta);
      const res = await mods.api.post({
        url: `/quests/${questId}/video-progress`,
        body: { timestamp: nextTime },
      });
      const completed = res?.body?.completed_at != null || nextTime >= secondsNeeded;
      if (nextTime >= secondsNeeded && !res?.body?.completed_at) {
        await mods.api.post({
          url: `/quests/${questId}/video-progress`,
          body: { timestamp: secondsNeeded },
        });
      }
      return {
        progress: Math.floor(nextTime),
        secondsNeeded,
        completed,
      };
    } else {
      const streamKey = getStreamKey(mods, questId);
      const res = await mods.api.post({
        url: `/quests/${questId}/heartbeat`,
        body: {
          stream_key: streamKey,
          terminal: false,
        },
      });
      const body = res?.body || {};
      const newProgress =
        body.progress?.[taskType]?.value ??
        body.userStatus?.progress?.[taskType]?.value ??
        body.stream_progress_seconds ??
        Math.min(secondsNeeded, currentProgress + (stepSeconds || 25));

      const completed = !!body.completed_at || newProgress >= secondsNeeded;
      if (completed) {
        try {
          await mods.api.post({
            url: `/quests/${questId}/heartbeat`,
            body: {
              stream_key: streamKey,
              terminal: true,
            },
          });
        } catch {}
      }
      return {
        progress: Math.floor(newProgress),
        secondsNeeded,
        completed,
      };
    }
  }

  // Listen for bridge requests from content.js
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'DQC_CONTENT') return;

    const { reqId, command, payload } = msg;
    try {
      let result = null;
      if (command === 'GET_TOKEN') {
        result = { token: extractToken() };
      } else if (command === 'GET_QUESTS') {
        const quests = await fetchQuestsFromClient();
        result = { quests, token: extractToken() };
      } else if (command === 'ENROLL_QUEST') {
        const body = await enrollQuestInClient(payload.questId);
        result = { body };
      } else if (command === 'STEP_QUEST') {
        result = await stepQuestInClient(payload);
      }

      window.postMessage(
        {
          source: 'DQC_PAGE',
          reqId,
          success: true,
          result,
        },
        '*'
      );
    } catch (err) {
      window.postMessage(
        {
          source: 'DQC_PAGE',
          reqId,
          success: false,
          error: err?.message || String(err),
        },
        '*'
      );
    }
  });
})();
