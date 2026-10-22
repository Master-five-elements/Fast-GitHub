/* 仅用于离线预览：模拟 chrome.* API，不参与扩展打包 */
(function () {
  const mem = new Map();

  const preset = {
    fg_settings_v2: {
      enabled: true,
      autoUpdate: true,
      updateIntervalHours: 24,
      autoProxyOnFailure: true,
      fallbackNode: "gh-proxy.com",
      strategy: "auto",
      channelCount: 3,
      lastUpdate: Date.now() - 3600 * 1000,
      lastUpdateMessage: "预览数据 · 内置节点来自 hubporg/ghproxy-next",
      stats: {
        "gh-proxy.com": { latency: "120", speed: "8.4 Mbps", ts: Date.now() },
        "cdn.gh-proxy.com": { latency: "150", speed: "7.7 Mbps", ts: Date.now() },
        "ghfast.top": { latency: "260", speed: "5.1 Mbps", ts: Date.now() },
        "ghproxy.net": { latency: "880", speed: "1.2 Mbps", ts: Date.now() },
        "github.tbap.top": { latency: "340", speed: "3.3 Mbps", ts: Date.now() },
        "ghfile.geekertao.top": { latency: "520", speed: "2.1 Mbps", ts: Date.now() },
        "gh.dpik.top": { latency: "timeout", speed: "-", ts: Date.now() },
      },
    },
  };

  Object.keys(preset).forEach((k) => mem.set(k, preset[k]));

  const local = {
    async get(keys) {
      if (Array.isArray(keys)) {
        const o = {};
        keys.forEach((k) => (o[k] = mem.get(k)));
        return o;
      }
      if (keys && typeof keys === "object") {
        const o = {};
        Object.keys(keys).forEach((k) => (o[k] = mem.get(k)));
        return o;
      }
      return { [keys]: mem.get(keys) };
    },
    async set(obj) {
      Object.keys(obj).forEach((k) => mem.set(k, JSON.parse(JSON.stringify(obj[k]))));
    },
  };

  window.chrome = {
    storage: { local: local, sync: { async get() { return {}; } } },
    runtime: {
      async sendMessage() {
        return { ok: true };
      },
      openOptionsPage() {},
      onMessage: { addListener() {} },
    },
    tabs: {
      async query() {
        return [{ id: 1, url: "https://github.com/torvalds/linux" }];
      },
      update() {},
    },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    alarms: { create() {}, clear() {} },
  };
})();
