/**
 * 设置与节点仓库。
 * 被 service worker / options / popup / content script 共用。
 */

import { DEFAULT_NODES, NODES_SOURCE } from "./nodes.js";

/**
 * @typedef {Object} NodeEntry
 * @property {string} value 节点域名
 * @property {string} label 来源标记
 * @property {boolean} [builtin]
 * @property {boolean} [custom]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {Object} NodeStat
 * @property {string} [latency] 毫秒字符串或 "timeout"
 * @property {string} [speed] 形如 "8.4 Mbps"
 * @property {number} ts
 */

/**
 * @typedef {Object} Settings
 * @property {boolean} enabled
 * @property {boolean} autoUpdate
 * @property {number} updateIntervalHours
 * @property {string[]} updateSources
 * @property {number} lastUpdate
 * @property {string} lastUpdateMessage
 * @property {boolean} autoProxyOnFailure
 * @property {boolean} protectSensitive
 * @property {string[]} sensitivePaths
 * @property {string} fallbackNode
 * @property {"auto" | "manual"} strategy
 * @property {string} manualNode
 * @property {number} channelCount
 * @property {string} speedTestUrl
 * @property {NodeEntry[]} customNodes
 * @property {NodeEntry[]} remoteNodes
 * @property {string[]} disabledNodes
 * @property {Record<string, NodeStat>} stats
 * @property {string} webIDE
 * @property {string} token
 * @property {string} language
 * @property {"system" | "light" | "dark"} theme
 */

const KEY = "fg_settings_v2";
const LEGACY_KEY = "configs";
const LEGACY_LIST_KEY = "customList";

/** 节点清单远端镜像源，按顺序降级 */
export const DEFAULT_SOURCES = [
  "https://cdn.jsdelivr.net/gh/hubporg/ghproxy-next@main/components/nodes.ts",
  "https://fastly.jsdelivr.net/gh/hubporg/ghproxy-next@main/components/nodes.ts",
  "https://gh-proxy.com/https://raw.githubusercontent.com/hubporg/ghproxy-next/main/components/nodes.ts",
  "https://raw.githubusercontent.com/hubporg/ghproxy-next/main/components/nodes.ts",
];

/**
 * 默认的登录保护规则（可在设置页编辑）。
 * 支持 `*` 通配，匹配对象为 URL 的 pathname。
 */
export const DEFAULT_SENSITIVE_PATHS = [
  "/login",
  "/login/*",
  "/logout",
  "/session",
  "/session/*",
  "/sessions",
  "/sessions/*",
  "/signup",
  "/join",
  "/password_reset",
  "/settings",
  "/settings/*",
  "/account",
  "/account/*",
  "/notifications",
  "/notifications/*",
  "/apps",
  "/apps/*",
  "/billing",
  "/billing/*",
  "/security",
  "/security/*",
  "/sponsors/*/dashboard",
  "/orgs/*/settings",
  "/orgs/*/settings/*",
  "/orgs/*/people",
  "/orgs/*/teams",
  "/organizations/*/settings",
  "/organizations/*/settings/*",
  "/enterprises/*/settings",
  "/enterprises/*/security",
  "/enterprises/*/billing",
  "/users/*/settings",
];

/** @type {Settings} */
const DEFAULTS = {
  enabled: true,
  autoUpdate: true,
  updateIntervalHours: 24,
  updateSources: DEFAULT_SOURCES,
  lastUpdate: 0,
  lastUpdateMessage: "",
  autoProxyOnFailure: true,
  protectSensitive: true,
  sensitivePaths: DEFAULT_SENSITIVE_PATHS,
  fallbackNode: "gh-proxy.com",
  strategy: "auto",
  manualNode: "",
  channelCount: 3,
  speedTestUrl:
    "https://raw.githubusercontent.com/hubporg/ghproxy-next/main/package-lock.json",
  customNodes: [],
  remoteNodes: [],
  disabledNodes: [],
  stats: {},
  webIDE: "GitHub1s.Com",
  token: "",
  language: "nothing",
  theme: "system",
};

/** @template T @param {T} obj @returns {T} */
const clone = (obj) => JSON.parse(JSON.stringify(obj));

/**
 * @param {Partial<NodeEntry>} node
 * @returns {NodeEntry}
 */
function normalize(node) {
  return {
    value: String(node?.value ?? "").trim(),
    label: node?.label ?? "custom",
    builtin: Boolean(node?.builtin),
    custom: Boolean(node?.custom),
  };
}

/**
 * @param {Partial<NodeEntry>[]} list
 * @returns {NodeEntry[]}
 */
function dedupe(list) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {NodeEntry[]} */
  const out = [];
  for (const item of list) {
    const entry = normalize(item);
    if (!entry.value || seen.has(entry.value)) continue;
    seen.add(entry.value);
    out.push(entry);
  }
  return out;
}

/**
 * 内置 + 远端 + 自定义 合并后的完整节点表
 * @param {Settings} [settings]
 * @returns {NodeEntry[]}
 */
export function allNodes(settings) {
  const s = settings ?? DEFAULTS;
  const builtin = DEFAULT_NODES.map((n) => ({ ...n, builtin: true }));
  const remote = (s.remoteNodes ?? []).map((n) => ({ ...n, builtin: true }));
  const custom = (s.customNodes ?? []).map((n) => ({
    ...n,
    custom: true,
    label: "custom",
  }));
  const disabled = new Set(s.disabledNodes ?? []);
  return dedupe([...builtin, ...remote, ...custom]).map((n) => ({
    ...n,
    disabled: disabled.has(n.value),
  }));
}

/**
 * @param {Settings} [settings]
 * @returns {NodeEntry[]}
 */
export function activeNodes(settings) {
  return allNodes(settings).filter((n) => !n.disabled);
}

/**
 * @param {Settings} settings
 * @param {string} value
 * @returns {NodeStat | null}
 */
export function statOf(settings, value) {
  return settings?.stats?.[value] ?? null;
}

/**
 * 分值越小越优
 * @param {NodeStat | null} stat
 */
function scoreOf(stat) {
  if (!stat) return Number.MAX_SAFE_INTEGER;
  const speed = Number.parseFloat(String(stat.speed ?? ""));
  if (!Number.isNaN(speed) && speed > 0) return 1000 - speed;
  const latency = Number.parseFloat(String(stat.latency ?? ""));
  if (!Number.isNaN(latency)) return 100000 + latency;
  return Number.MAX_SAFE_INTEGER - 1;
}

/**
 * 当前最优节点
 * @param {Settings} [settings]
 * @returns {string}
 */
export function bestNode(settings) {
  const s = settings ?? DEFAULTS;
  if (s.strategy === "manual" && s.manualNode) return s.manualNode;

  const list = activeNodes(s);
  if (!list.length) return s.fallbackNode || "gh-proxy.com";

  const hasStats = list.some((n) => statOf(s, n.value));
  if (!hasStats && list.some((n) => n.value === s.fallbackNode)) {
    return s.fallbackNode;
  }

  let best = list[0];
  let bestScore = Number.MAX_SAFE_INTEGER;
  for (const node of list) {
    const score = scoreOf(statOf(s, node.value));
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best.value;
}

/**
 * 首页展示的通道列表
 * @param {Settings} [settings]
 * @param {number} [count]
 * @returns {string[]}
 */
export function channels(settings, count) {
  const s = settings ?? DEFAULTS;
  const n = Math.max(1, Math.min(count ?? s.channelCount ?? 3, 10));
  const list = activeNodes(s)
    .map((item) => ({ ...item, stat: statOf(s, item.value) }))
    .sort((a, b) => scoreOf(a.stat) - scoreOf(b.stat));
  if (!list.length) return [s.fallbackNode || "gh-proxy.com"];
  return list.slice(0, n).map((item) => item.value);
}

/**
 * 构造代理地址 `https://<node>/<原始URL>`
 * @param {string} node
 * @param {string} target
 */
export function buildProxyUrl(node, target) {
  const base = String(node ?? "").replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? `${base}/${target}` : `https://${base}/${target}`;
}

/**
 * glob（支持 `*`）转正则
 * @param {string} pattern
 */
export function globToRegExp(pattern) {
  const escaped = String(pattern ?? "")
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * 地址是否命中保护规则
 * @param {string} url
 * @param {string[]} patterns
 */
export function matchSensitive(url, patterns) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return (patterns ?? []).some((p) => {
    if (!p?.trim()) return false;
    try {
      return globToRegExp(p).test(pathname);
    } catch {
      return false;
    }
  });
}

/** @returns {Promise<Settings | null>} */
export async function raw() {
  const result = await chrome.storage.local.get(KEY);
  return /** @type {Settings | null} */ (result[KEY] ?? null);
}

/** 读取设置；首次运行时迁移旧版配置 */
export async function get() {
  const stored = await raw();
  /** @type {Settings} */
  const settings = { ...clone(DEFAULTS), ...(stored ?? {}) };

  if (!stored) {
    const legacy = await chrome.storage.sync.get([LEGACY_KEY, LEGACY_LIST_KEY]);
    const old = /** @type {any} */ (legacy[LEGACY_KEY]);
    const oldList = /** @type {string[]} */ (legacy[LEGACY_LIST_KEY] ?? []);

    /** @type {Partial<NodeEntry>[]} */
    let migrated = oldList
      .map((v) => ({ value: String(v).replace(/github_proxy/g, "") }))
      .filter((n) => n.value);

    if (old?.speedList) {
      migrated = dedupe([
        ...migrated,
        ...String(old.speedList)
          .split("\n")
          .map((v) => ({ value: v.trim() }))
          .filter((n) => n.value),
      ]);
    }
    if (migrated.length) settings.customNodes = /** @type {NodeEntry[]} */ (migrated);
    if (old?.token) settings.token = old.token;
    if (old?.language) settings.language = old.language;
    if (old?.webIDE) settings.webIDE = old.webIDE;

    await chrome.storage.local.set({ [KEY]: settings });
  }
  return settings;
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>}
 */
export async function set(patch) {
  const current = await get();
  const next = { ...current, ...(patch ?? {}) };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/**
 * @param {string} value
 * @param {string} [latency]
 * @param {string} [speed]
 */
export async function saveStat(value, latency, speed) {
  const s = await get();
  const stats = { ...(s.stats ?? {}) };
  const prev = stats[value] ?? {};
  stats[value] = {
    latency: latency ?? prev.latency,
    speed: speed ?? prev.speed,
    ts: Date.now(),
  };
  return await set({ stats });
}

export const FGStore = {
  KEY,
  DEFAULTS,
  NODES_SOURCE,
  DEFAULT_SOURCES,
  DEFAULT_SENSITIVE_PATHS,
  get,
  set,
  raw,
  allNodes,
  activeNodes,
  statOf,
  bestNode,
  channels,
  buildProxyUrl,
  matchSensitive,
  globToRegExp,
  saveStat,
  dedupe,
  normalize,
};
