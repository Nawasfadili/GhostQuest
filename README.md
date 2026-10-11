# 👻 GhostQuest — Automated Discord Quest & Orb Completer

**GhostQuest** is a stealthy Manifest V3 Chromium extension that automatically completes Discord Quests (*Watch Video*, *Play on Desktop*, *Stream on Desktop*, and *Play Activity*) directly in your browser to earn Discord Orbs effortlessly.

> ⚠️ **Disclaimer:** For educational purposes only. Automating Discord Quests may violate Discord's Terms of Service. Use at your own risk.

---

## ✨ Key Features

- **All Quest Types Supported:** Completes `WATCH_VIDEO`, `WATCH_VIDEO_ON_MOBILE`, `PLAY_ON_DESKTOP`, `STREAM_ON_DESKTOP`, and `PLAY_ACTIVITY` quests.
- **No Desktop App Required:** Spoofs Discord Desktop (`Electron`) headers via `declarativeNetRequest` and `navigator.userAgent` override so desktop-only quests work right inside Chrome, Brave, or Edge.
- **In-Tab Webpack Bridge:** Hooks directly into Discord's live `QuestsStore` and internal API client on `discord.com/quest-home` for real-time progress bar updates.
- **Built-in Stealth Engine:**
  - **Box-Muller Gaussian Timing Jitter:** Intervals cluster naturally around your target interval rather than flat robotic timing.
  - **Active Hours Schedule:** Optionally pause automation overnight and only run during your chosen hours.
  - **Rate-Limit & Backoff Guard:** Automatically respects HTTP `429` `Retry-After` headers and enforces human reaction delays.
- **Auto-Enroll & Live Dashboard:** Automatically accepts available quests, tracks progress bars, logs activity, and notifies you when Orbs are ready to claim.

---

## 📦 Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Nawasfadili/GhostQuest.git
   ```
2. Open Chrome, Brave, or Edge and navigate to `chrome://extensions` (or `brave://extensions`).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"** and select the `GhostQuest` folder.

---

## 🚀 How to Use

1. Open [discord.com/quest-home](https://discord.com/quest-home) in a browser tab and make sure you're logged in.
2. Click the **GhostQuest** extension icon in your browser toolbar.
3. Your active quests and session will auto-sync (or click **Auto-Detect** / **Refresh**).
4. Click **Start Completing** — GhostQuest will automatically enroll and progress through each quest!

---

## ⚙️ Settings

| Setting | Description |
|---------|-------------|
| **Heartbeat Interval** | Base interval between progress signals (20–120 seconds) |
| **Auto-start on load** | Automatically resume when the browser starts |
| **Show notifications** | Desktop notification when a quest finishes |
| **Gaussian jitter timing** | Natural Box-Muller normal distribution variation on intervals |
| **Active hours only** | Restrict quest completion to specific hours of the day (24h format) |

---

## 📁 Project Structure

```text
GhostQuest/
├── manifest.json            # Extension configuration (Manifest V3)
├── background.js            # Service worker — stealth engine & quest scheduler
├── page-bridge.js           # MAIN-world bridge for Discord's QuestsStore & internal API
├── user-agent-override.js   # MAIN-world navigator.userAgent override for Desktop quests
├── content.js               # ISOLATED-world message relay
├── rules.json               # declarativeNetRequest rules for Electron User-Agent header
├── popup.html               # Extension popup UI
├── popup.css                # Discord-themed dark styles
├── popup.js                 # Popup UI controller
├── icons/                   # Extension icons (16, 32, 48, 128px)
└── README.md
```

---

*Built with Manifest V3 · Educational Use Only*
