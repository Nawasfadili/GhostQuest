(function () {
  'use strict';

  const electronUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9163 Chrome/124.0.6367.243 Electron/30.2.0 Safari/537.36';

  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: function () {
        return electronUserAgent;
      },
      configurable: true,
    });

    Object.defineProperty(navigator, 'platform', {
      get: function () {
        return 'Win32';
      },
      configurable: true,
    });
  } catch (e) {
    // Ignore if already defined
  }
})();
