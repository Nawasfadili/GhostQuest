/* =====================================================
   Discord Quest Completer — content.js (ISOLATED World)
   Forwards commands between background.js/popup.js and
   page-bridge.js running in the MAIN world.
   ===================================================== */

(function () {
  'use strict';

  if (!location.hostname.includes('discord.com')) return;

  let reqCounter = 0;
  const pendingRequests = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'DQC_PAGE') return;

    const resolver = pendingRequests.get(msg.reqId);
    if (resolver) {
      pendingRequests.delete(msg.reqId);
      resolver(msg);
    }
  });

  function callPageBridge(command, payload = {}, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const reqId = ++reqCounter;
      const timer = setTimeout(() => {
        pendingRequests.delete(reqId);
        resolve({ success: false, error: 'Page bridge timed out' });
      }, timeoutMs);

      pendingRequests.set(reqId, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      window.postMessage(
        {
          source: 'DQC_CONTENT',
          reqId,
          command,
          payload,
        },
        '*'
      );
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg.action === 'bridgeCommand') {
        const res = await callPageBridge(msg.command, msg.payload);
        sendResponse(res);
      } else if (msg.action === 'getToken') {
        const res = await callPageBridge('GET_TOKEN');
        sendResponse({ token: res?.result?.token || null });
      }
    })();
    return true;
  });
})();
