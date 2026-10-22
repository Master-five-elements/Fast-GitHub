/* ------------------------------------------------------------------
 * FGStore —— 设置与节点仓库
 * 同时被 service worker / options / popup / content script 引用
 * ------------------------------------------------------------------ */

var FGStore = (function () {
  const KEY = "fg_settings_v2";
  const LEGACY_KEY = "configs";
  const LEGACY_LIST_KEY = "customList";

  const DEFAULT_SOURCES = [
    "https://cdn.jsdelivr.net/gh/hubporg/ghproxy-next@main/components/nodes.ts",
    "https://fastly.jsdelivr.net/gh/hubporg/ghproxy-next@main/components/nodes.ts",
    "https://gh-proxy.com/https://raw.githubusercontent.com/hubporg/ghproxy-next/main/components/nodes.ts",
    "https://raw.githubusercontent.com/hubporg/ghproxy-next/main/components/nodes.ts",
  ];

  const DEFAULTS = {
    enabled: true,
    // 节点自动更新
    autoUpdate: true,
    updateIntervalHours: 24,
    updateSources: DEFAULT_SOURCES,
    lastUpdate: 0,
    lastUpdateMessage: "",
    // 失败自动代理
    autoProxyOnFailure: true,
    protectSensitive: true, // 登录/设置/私有仓库等敏感页面永不走代理
    fallbackNode: "gh-proxy.com",
    // 节点选择策略
    strategy: "auto", // auto(最优节点) | manual(手动指定)
    manualNode: "",
    channelCount: 3, // 首页展示的通道数量
    // 测速
    speedTestUrl:
      "https://raw.githubusercontent.com/hubporg/ghproxy-next/main/package-lock.json",
    // 节点数据
    customNodes: [], // [{ value }]
    remoteNodes: [], // [{ value, label }] 最近一次远端同步结果
    disabledNodes: [], // [value]
    stats: {}, // value -> { latency, speed, ts }
    // 原有功能
    webIDE: "GitHub1s.Com",
    token: "",
    language: "nothing",
    theme: "system", // system | light | dark
  };

  const clone = (obj) => JSON.parse(JSON.stringify(obj));

  function normalize(node) {
    const value = String((node && node.value) || "").trim();
    return {
      value: value,
      label: (node && node.label) || "custom",
      builtin: !!(node && node.builtin),
      custom: !!(node && node.custom),
    };
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      const n = normalize(item);
      if (!n.value) return;
      if (seen.has(n.value)) return;
      seen.add(n.value);
      out.push(n);
    });
    return out;
  }

  /** 内置 + 远端 + 自定义 合并后的完整节点表 */
  function allNodes(settings) {
    const s = settings || DEFAULTS;
    const builtin = (typeof FG_DEFAULT_NODES !== "undefined"
      ? FG_DEFAULT_NODES
      : []
    ).map((n) => Object.assign({}, n, { builtin: true }));

    const remote = (s.remoteNodes || []).map((n) =>
      Object.assign({}, n, { builtin: true })
    );

    const custom = (s.customNodes || []).map((n) =>
      Object.assign({}, n, { custom: true, label: "custom" })
    );

    const disabled = new Set(s.disabledNodes || []);
    return dedupe(builtin.concat(remote, custom)).map((n) =>
      Object.assign(n, { disabled: disabled.has(n.value) })
    );
  }

  function activeNodes(settings) {
    return allNodes(settings).filter((n) => !n.disabled);
  }

  function statOf(settings, value) {
    const st = (settings.stats || {})[value];
    if (!st) return null;
    return st;
  }

  function scoreOf(stat) {
    if (!stat) return Number.MAX_SAFE_INTEGER;
    const speed = parseFloat(String(stat.speed || ""));
    const latency = parseFloat(String(stat.latency || ""));
    if (!isNaN(speed) && speed > 0) return 1000 - speed; // 带宽优先
    if (!isNaN(latency)) return 100000 + latency;
    return Number.MAX_SAFE_INTEGER - 1;
  }

  /** 当前最优节点：手动优先，其次按 带宽↓ 延迟↑ */
  function bestNode(settings) {
    const s = settings || DEFAULTS;
    if (s.strategy === "manual" && s.manualNode) return s.manualNode;

    const list = activeNodes(s);
    if (!list.length) return s.fallbackNode || "gh-proxy.com";

    // 还没有任何测速数据时，优先使用兜底节点（默认 gh-proxy.com）
    const hasStats = list.some((n) => statOf(s, n.value));
    if (!hasStats && s.fallbackNode && list.some((n) => n.value === s.fallbackNode)) {
      return s.fallbackNode;
    }

    let best = list[0];
    let bestScore = Number.MAX_SAFE_INTEGER;
    list.forEach((n) => {
      const sc = scoreOf(statOf(s, n.value));
      if (sc < bestScore) {
        bestScore = sc;
        best = n;
      }
    });
    return best.value;
  }

  /** 若干条可用通道（首页 clone 链接用） */
  function channels(settings, count) {
    const s = settings || DEFAULTS;
    const n = Math.max(1, Math.min(count || s.channelCount || 3, 10));
    const list = activeNodes(s)
      .map((item) => Object.assign({}, item, { stat: statOf(s, item.value) }))
      .sort((a, b) => scoreOf(a.stat) - scoreOf(b.stat));
    if (!list.length) return [s.fallbackNode || "gh-proxy.com"];
    return list.slice(0, n).map((item) => item.value);
  }

  function buildProxyUrl(node, target) {
    const base = String(node || "").replace(/\/+$/, "");
    if (/^https?:\/\//i.test(base)) return base + "/" + target;
    return "https://" + base + "/" + target;
  }

  async function raw() {
    const result = await chrome.storage.local.get(KEY);
    return result[KEY] || null;
  }

  async function get() {
    const stored = await raw();
    const settings = Object.assign(clone(DEFAULTS), stored || {});
    if (!stored) {
      // 首次运行：尝试继承 v1.5 之前的配置
      const legacy = await chrome.storage.sync.get([LEGACY_KEY, LEGACY_LIST_KEY]);
      const old = legacy[LEGACY_KEY];
      const oldList = legacy[LEGACY_LIST_KEY] || [];
      if (oldList && oldList.length) {
        settings.customNodes = oldList
          .map((v) => String(v).replace(/github_proxy/g, ""))
          .filter(Boolean)
          .map((v) => ({ value: v }));
      }
      if (old) {
        if (old.speedList) {
          settings.customNodes = dedupe(
            settings.customNodes.concat(
              String(old.speedList)
                .split("\n")
                .map((v) => ({ value: v.trim() }))
                .filter((i) => i.value)
            )
          );
        }
        if (old.token) settings.token = old.token;
        if (old.language) settings.language = old.language;
        if (old.webIDE) settings.webIDE = old.webIDE;
      }
      await chrome.storage.local.set({ [KEY]: settings });
    }
    return settings;
  }

  async function set(patch) {
    const current = await get();
    const next = Object.assign(current, patch || {});
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  async function saveStat(value, latency, speed) {
    const s = await get();
    const stats = Object.assign({}, s.stats || {});
    const old = stats[value] || {};
    stats[value] = {
      latency: latency === undefined || latency === null ? old.latency : latency,
      speed: speed === undefined || speed === null ? old.speed : speed,
      ts: Date.now(),
    };
    return await set({ stats: stats });
  }

  return {
    KEY,
    DEFAULTS,
    DEFAULT_SOURCES,
    get,
    set,
    raw,
    allNodes,
    activeNodes,
    statOf,
    bestNode,
    channels,
    buildProxyUrl,
    saveStat,
    dedupe,
    normalize,
  };
})();
