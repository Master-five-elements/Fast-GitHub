/**
 * 设置与节点仓库。
 * 被 service worker / options / popup / content script 共用。
 */

import { DEFAULT_NODES, NODES_SOURCE } from "./nodes.js";
import { DEFAULT_REPO_IDS, NODE_REPOS } from "./repos.js";

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

/**
 * 旧版单源机制遗留的默认源，仅用于兼容读取；
 * 现在的同步走 NODE_REPOS 多仓库机制，默认不再附加自定义源（避免重复拉取）。
 * @type {string[]}
 */
export const DEFAULT_SOURCES = [];

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
  repoEnabled: DEFAULT_REPO_IDS.reduce(
    (acc, id) => {
      acc[id] = true;
      return acc;
    },
    /** @type {Record<string, boolean>} */ ({}),
  ),
  repoCounts: {},
  disabledNodes: [],
  stats: {},
  routeMode: "auto",
  useJsDelivr: true,
  probes: {},
  capabilities: {},
  usage: {},
  webIDE: "GitHub1s.Com",
  token: "",
  language: "nothing",
  theme: "system",
};

/** @template T @param {T} obj @returns {T} */
const clone = (obj) => JSON.parse(JSON.stringify(obj));

/**
 * 域名归一化：统一大小写、去掉协议 / www / 端口 / 路径，
 * 使 `HTTPS://WWW.Gh-Proxy.com/` 与 `gh-proxy.com` 视为同一个节点。
 * @param {string} value
 * @returns {string}
 */
export function nodeKey(value) {
  let host = String(value ?? "")
    .trim()
    .toLowerCase();
  host = host.replace(/^[a-z]+:\/\//i, "");
  host = host.replace(/^www\./, "");
  host = host.split(/[/?#]/)[0];
  host = host.replace(/:\d+$/, "");
  host = host.replace(/^\.+|\.+$/g, "");
  return host;
}

/**
 * @param {Partial<NodeEntry>} node
 * @returns {NodeEntry}
 */
function normalize(node) {
  return {
    value: nodeKey(node?.value),
    label: node?.label ?? "custom",
    builtin: Boolean(node?.builtin),
    custom: Boolean(node?.custom),
  };
}

/**
 * 去重并合并：同 key 的节点合并为一个，来源（sources）取并集
 * @param {Partial<NodeEntry>[]} list
 * @returns {NodeEntry[]}
 */
function dedupe(list) {
  /** @type {Map<string, any>} */
  const map = new Map();

  for (const item of list ?? []) {
    const entry = normalize(item);
    if (!entry.value) continue;

    const sources = new Set([...(item?.sources ?? [])]);
    if (item?.source) sources.add(item.source);

    const prev = map.get(entry.value);
    if (prev) {
      prev.merged += 1;
      for (const source of sources) prev.sources.add(source);
      prev.builtin = prev.builtin || entry.builtin;
      prev.custom = prev.custom || entry.custom;
      continue;
    }

    map.set(entry.value, {
      ...entry,
      merged: 0,
      sources,
    });
  }

  return [...map.values()].map((entry) => {
    const { sources, ...rest } = entry;
    return { ...rest, sources: [...sources] };
  });
}

/**
 * 去重统计：用于 UI 展示"合并了多少重复项"
 * @param {Partial<NodeEntry>[]} list
 */
export function mergeStats(list) {
  const items = list ?? [];
  /** @type {Set<string>} */
  const keys = new Set();
  let invalid = 0;
  for (const item of items) {
    const key = nodeKey(item?.value);
    if (!key) invalid += 1;
    else keys.add(key);
  }
  const unique = keys.size;
  return {
    total: items.length,
    unique,
    merged: Math.max(0, items.length - invalid - unique),
    invalid,
  };
}

/**
 * 用某个仓库的最新节点替换列表中同来源的旧数据
 * @param {{ source?: string }[]} list
 * @param {string} repoId
 * @param {{ value: string; label?: string }[]} nodes
 */
export function replaceRepoNodes(list, repoId, nodes) {
  const others = (list ?? []).filter((item) => item?.source !== repoId);
  const fresh = (nodes ?? []).map((item) => ({
    value: nodeKey(item?.value),
    label: item?.label ?? "remote",
    source: repoId,
  }));
  return [...others, ...fresh];
}

/** 启用的节点仓库 */
export function enabledRepos(settings) {
  const enabled = settings?.repoEnabled ?? {};
  return NODE_REPOS.filter((repo) => enabled[repo.id] !== false);
}

/**
 * 内置 + 远端 + 自定义 合并后的完整节点表
 * @param {Settings} [settings]
 * @returns {NodeEntry[]}
 */
export function allNodes(settings) {
  const s = settings ?? DEFAULTS;
  const builtin = DEFAULT_NODES.map((n) => ({ ...n, builtin: true, source: "builtin" }));
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
 * 分值越小越优；真实使用失败率高的节点会被降权
 * @param {NodeStat | null} stat
 * @param {UsageStat | null} [usage]
 */
function scoreOf(stat, usage) {
  if (usage?.total && usage.total >= 3 && usage.fail / usage.total > 0.5) {
    return Number.MAX_SAFE_INTEGER - 3;
  }
  if (!stat) return Number.MAX_SAFE_INTEGER;
  const speed = Number.parseFloat(String(stat.speed ?? ""));
  if (!Number.isNaN(speed) && speed > 0) return 1000 - speed;
  const latency = Number.parseFloat(String(stat.latency ?? ""));
  if (!Number.isNaN(latency)) return 100000 + latency;
  return Number.MAX_SAFE_INTEGER - 1;
}

/**
 * @typedef {Object} UsageStat
 * @property {number} total
 * @property {number} ok
 * @property {number} fail
 * @property {number} avgMs
 * @property {boolean} [lastOk]
 * @property {number} [ts]
 */

/**
 * 节点健康度（基于真实使用记录）
 * @param {Settings} settings
 * @param {string} value
 */
export function healthOf(settings, value) {
  const usage = settings?.usage?.[value];
  if (!usage?.total) {
    return { score: null, label: "暂无数据", failRate: 0, uses: 0, avgMs: 0 };
  }
  const failRate = usage.fail / usage.total;
  const score = Math.round((1 - failRate) * 100);
  const label = score >= 90 ? "良好" : score >= 60 ? "一般" : "偏差";
  return { score, label, failRate, uses: usage.total, avgMs: usage.avgMs ?? 0 };
}

/**
 * 记录一次真实下载结果，用于健康度评分
 * @param {string} value
 * @param {boolean} ok
 * @param {number} [ms]
 */
export async function recordUsage(value, ok, ms) {
  const s = await get();
  const usage = { ...(s.usage ?? {}) };
  const prev = usage[value] ?? { total: 0, ok: 0, fail: 0, avgMs: 0 };
  const total = prev.total + 1;
  usage[value] = {
    total,
    ok: prev.ok + (ok ? 1 : 0),
    fail: prev.fail + (ok ? 0 : 1),
    avgMs: Math.round(((prev.avgMs ?? 0) * prev.total + (ms ?? 0)) / total),
    lastOk: Boolean(ok),
    ts: Date.now(),
  };
  return await set({ usage });
}

/**
 * 按评分排序的可用节点（带宽高 → 延迟低 → 失败率低的优先）。
 * bestNode 取首个，channels 取前 N 个，两处共用同一套排序。
 * @param {Settings} s
 */
function rankedNodes(s) {
  return activeNodes(s)
    .map((item) => ({ ...item, stat: statOf(s, item.value) }))
    .sort(
      (a, b) => scoreOf(a.stat, s.usage?.[a.value]) - scoreOf(b.stat, s.usage?.[b.value]),
    );
}

/**
 * 当前最优节点
 * @param {Settings} [settings]
 * @returns {string}
 */
export function bestNode(settings) {
  const s = settings ?? DEFAULTS;
  if (s.strategy === "manual" && s.manualNode) return s.manualNode;

  const list = rankedNodes(s);
  if (!list.length) return s.fallbackNode || "gh-proxy.com";

  // 全新安装（无任何测速数据）时优先用兜底节点
  const hasStats = list.some((n) => n.stat);
  if (!hasStats && list.some((n) => n.value === s.fallbackNode)) {
    return s.fallbackNode;
  }
  return list[0].value;
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
  const list = rankedNodes(s);
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
  NODE_REPOS,
  get,
  nodeKey,
  mergeStats,
  replaceRepoNodes,
  enabledRepos,
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
  healthOf,
  recordUsage,
};
