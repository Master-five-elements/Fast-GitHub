/**
 * 远端节点同步 + 节点测速（延迟 / 带宽 / 能力）。
 */

import { DOWNLOAD_ONLY_HOSTS } from "./repos.js";
import { buildProxyUrl, replaceRepoNodes } from "./store.js";

/**
 * @typedef {Object} LatencyResult
 * @property {number | null} latency 毫秒；超时或失败为 null
 * @property {string} error
 */

/**
 * @typedef {Object} SpeedResult
 * @property {string} speed 形如 "8.4 Mbps"，失败为 "-"
 * @property {number} bytes
 * @property {number} seconds
 * @property {string} error
 */

/**
 * 带超时的 fetch。超时或网络失败统一返回 null，由调用方判定。
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [opts]
 * @returns {Promise<Response | null>}
 */
async function fetchWithTimeout(url, opts) {
  const { timeoutMs, ...init } = opts ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 15000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * HEAD(no-cors) 探测：能否完成一次往返及耗时。
 * 节点延迟探测与域名连通性探测共用这一实现。
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean; ms: number }>}
 */
async function headProbe(url, timeoutMs) {
  const start = performance.now();
  const res = await fetchWithTimeout(url, {
    method: "HEAD",
    mode: "no-cors",
    cache: "no-store",
    timeoutMs,
  });
  return { ok: Boolean(res), ms: Math.round(performance.now() - start) };
}

/**
 * 解析节点清单。
 *
 * 支持的 parser（见 lib/repos.js 的说明）：
 * `pair` / `prefix` / `text` / `json` / `mirrorhub` / `mirrors` / `triple` / `urls` / `auto`
 *
 * 每条结果带 `kind`：`full`（可加速仓库）或 `download`（仅下载文件）。
 * @param {string} text
 * @param {string} [parser]
 * @returns {{ value: string; label: string; kind?: "full" | "download" }[]}
 */
export function parseNodes(text, parser = "auto") {
  if (!text) return [];
  const type = parser || "auto";

  // 结构化 JSON 类优先按对应格式解析
  if (type === "mirrorhub") return parseMirrorHub(text);
  if (type === "mirrors") return parseMirrorsJson(text);
  if (type === "triple") return parseTriples(text);
  if (type === "urls") return parseUrls(text);

  /** @type {{ value: string; label: string; kind?: "full" | "download" }[]} */
  const out = [];

  if (type === "auto" || type === "pair") {
    const pairRe =
      /\{\s*label\s*:\s*["']([^"']*)["']\s*,\s*value\s*:\s*["']([^"']+)["']\s*\}/g;
    for (let m = pairRe.exec(text); m !== null; m = pairRe.exec(text)) {
      out.push({ value: m[2].trim(), label: (m[1] || "contribute").trim() });
    }
    if (out.length) return out;
  }

  if (type === "auto" || type === "prefix") {
    const prefixRe =
      /\{\s*name\s*:\s*["']([^"']+)["']\s*,\s*prefix\s*:\s*["']https?:\/\/([^/"']+)/g;
    for (let m = prefixRe.exec(text); m !== null; m = prefixRe.exec(text)) {
      out.push({ value: m[2].trim(), label: (m[1] || "node").trim() });
    }
    if (out.length) return out;
  }

  if (type === "auto" || type === "json") {
    const trimmed = text.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const data = JSON.parse(trimmed);
        const arr = Array.isArray(data) ? data : (data.nodes ?? []);
        for (const item of arr) {
          if (typeof item === "string") {
            out.push({ value: item.trim(), label: "remote" });
          } else if (item) {
            const value =
              item.value ??
              item.domain ??
              item.host ??
              item.url ??
              item.prefix ??
              item.name;
            if (value) {
              out.push({ value: String(value).trim(), label: item.label ?? "remote" });
            }
          }
        }
        if (out.length) return out;
      } catch {
        /* 继续按纯文本处理 */
      }
    }
  }

  if (type === "auto" || type === "text") {
    for (const line of text.split(/\r?\n/)) {
      const value = line.trim().replace(/^["',]+|["',]+$/g, "");
      if (!value || value.startsWith("//") || value.startsWith("#")) continue;
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) continue;
      out.push({ value, label: "remote" });
    }
    if (out.length) return out;
  }

  // 兜底：从任意文本提取 https:// 域名
  if (type === "auto") return parseUrls(text);
  return out;
}

/**
 * MirrorHub 的 nodes.json：categories.{universal_proxy,web_mirror,clone_specialized,cdn_raw}
 * 每个节点带 supports 数组，可直接得出能力分类。
 * @param {string} text
 */
function parseMirrorHub(text) {
  /** @type {{ value: string; label: string; kind?: "full" | "download" }[]} */
  const out = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  const cats = data?.categories ?? {};
  for (const [cat, val] of Object.entries(cats)) {
    const nodes = /** @type {any} */ (val)?.nodes;
    if (!Array.isArray(nodes)) continue;
    // cdn_raw 只能下 raw/blob 文件；其余三类都能加速仓库（clone / web）
    const kind = cat === "cdn_raw" ? "download" : "full";
    for (const n of nodes) {
      const host = hostOf(String(n?.url ?? ""));
      if (!host) continue;
      out.push({ value: host, label: String(n?.name ?? cat), kind });
    }
  }
  return out;
}

/**
 * ns-emu-tools 的 github_mirrors.json：{ download: [{url,kind}], raw: [{url,kind}] }
 * 两组都是文件下载向的镜像。
 * @param {string} text
 */
function parseMirrorsJson(text) {
  /** @type {{ value: string; label: string; kind?: "full" | "download" }[]} */
  const out = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  for (const group of ["download", "raw"]) {
    const list = data?.[group];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const host = hostOf(String(item?.url ?? ""));
      if (!host) continue;
      const label = String(item?.region ?? group) || group;
      out.push({ value: host, label, kind: "download" });
    }
  }
  return out;
}

/**
 * FastGithub 的 MirrorUrl[N] = ["url", "name", "tip"] 三元组。
 * 跳过注释行；git@ 开头的 SSH 地址不是 HTTP 代理，跳过。
 * @param {string} text
 */
function parseTriples(text) {
  /** @type {{ value: string; label: string; kind?: "full" | "download" }[]} */
  const out = [];
  const re = /MirrorUrl\[\s*\d+\s*\]\s*=\s*\[\s*"([^"]+)"\s*,\s*"([^"]*)"/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const url = m[1].trim();
    // 跳过被注释掉的行
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    if (text.slice(lineStart, m.index).trim().startsWith("//")) continue;
    if (/^git@|^ssh:/i.test(url)) continue;
    const host = hostOf(url);
    if (!host) continue;
    out.push({ value: host, label: m[2].trim() || "mirror" });
  }
  return out;
}

/**
 * 从任意文本提取 https:// 域名（兜底解析）。
 * 过滤 GitHub 自身域名与明显不相关的站点。
 * @param {string} text
 */
function parseUrls(text) {
  /** @type {{ value: string; label: string; kind?: "full" | "download" }[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  const re = /https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const host = m[1].toLowerCase().replace(/^www\./, "");
    if (seen.has(host)) continue;
    if (IGNORED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    seen.add(host);
    out.push({ value: host, label: "remote" });
  }
  return out;
}

/** 提取 URL 的 hostname；兼容不带协议的裸域名 */
function hostOf(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 确定某个节点的能力分类。
 * 已知 CDN 域名（含 jsdelivr.* 镜像）确定只能下载文件；其余按来源判定。
 * @param {string} value
 * @param {"full" | "download"} [fallback]
 * @returns {"full" | "download"}
 */
function kindForHost(value, fallback) {
  const host = hostOf(String(value ?? "").replace(/\/+$/, "")) || nodeKeyOf(value);
  if (DOWNLOAD_ONLY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return "download";
  }
  // jsDelivr 的各类镜像域名同样是纯 CDN，只能下文件
  if (host.startsWith("jsdelivr.") || host.endsWith(".jsdelivr.net")) return "download";
  return fallback === "download" ? "download" : "full";
}

/** 与 store.nodeKey 等价的轻量归一化（避免循环依赖） */
function nodeKeyOf(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^\.+|\.+$/g, "");
}

/** GitHub 自身及不相关站点，不应作为加速节点 */
const IGNORED_HOSTS = [
  "github.com",
  "githubusercontent.com",
  "github.io",
  "githubstatus.com",
  "gitee.com",
  "codechina.csdn.net",
  "bootcdn.net",
  "bootcss.com",
  "jsdelivr.net", // jsDelivr 走专门的 CDN 通道，不进公益节点池
  "staticaly.com",
  "cnpmjs.org",
  "npmmirror.com",
  "google.com",
  "cloudflare.com",
  "workers.dev", // CF Worker 域名本身不是节点
  "mozilla.org",
  "w3.org",
  "schema.org",
  "greasyfork.org", // 脚本托管站
  "example.com", // 文档占位
  "jsdelivr.net",
  "b-cdn.net", // BunnyCDN，jsDelivr 的上游 CDN
];

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export async function fetchText(url, timeoutMs) {
  const res = await fetchWithTimeout(url, {
    cache: "no-store",
    headers: { Accept: "*/*" },
    timeoutMs: timeoutMs ?? 15000,
  });
  if (!res) throw new Error("网络错误或超时");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * @typedef {Object} SyncResult
 * @property {boolean} ok
 * @property {{ value: string; label: string; kind?: "full" | "download" }[]} nodes
 * @property {string} source
 * @property {string} error
 */

/**
 * 从远端拉取节点清单，多镜像源依次降级
 * @param {string[]} sources
 * @param {number} [timeoutMs]
 * @param {string} [parser] 清单格式，默认 auto（自动识别）
 * @returns {Promise<SyncResult>}
 */
export async function fetchRemoteNodes(sources, timeoutMs, parser = "auto") {
  const list = (sources ?? []).filter(Boolean);
  /** @type {string[]} */
  const errors = [];

  for (const source of list) {
    try {
      const text = await fetchText(source, timeoutMs ?? 15000);
      const nodes = parseNodes(text, parser).filter((n) => n.value.includes("."));
      if (nodes.length) return { ok: true, nodes, source, error: "" };
      errors.push(`${source} -> 解析为空`);
    } catch (error) {
      errors.push(`${source} -> ${error instanceof Error ? error.message : error}`);
    }
  }
  return { ok: false, nodes: [], source: "", error: errors.join(" | ") };
}

/**
 * 延迟探测：对节点根路径发起 HEAD(no-cors)，统计往返耗时
 * @param {string} node
 * @param {number} [timeoutMs]
 * @returns {Promise<LatencyResult>}
 */
export async function testLatency(node, timeoutMs) {
  const host = String(node ?? "").replace(/\/+$/, "");
  if (!host) return { latency: null, error: "empty" };

  const url = /^https?:\/\//i.test(host) ? `${host}/` : `https://${host}/`;
  const { ok, ms } = await headProbe(url, timeoutMs ?? 6000);
  return ok ? { latency: ms, error: "" } : { latency: null, error: "timeout" };
}

/**
 * 带宽测速：经节点下载样本文件，不足 500ms 时重复多轮以降低误差
 * @param {string} node
 * @param {string} sampleUrl
 * @param {number} [timeoutMs]
 * @returns {Promise<SpeedResult>}
 */
export async function testSpeed(node, sampleUrl, timeoutMs) {
  const host = String(node ?? "").replace(/\/+$/, "");
  if (!host || !sampleUrl) {
    return { speed: "-", bytes: 0, seconds: 0, error: "empty" };
  }

  const base = buildProxyUrl(host, sampleUrl);
  const start = performance.now();
  let totalBytes = 0;
  let rounds = 0;
  let ok = false;

  while (rounds < 4) {
    const url = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
    const res = await fetchWithTimeout(url, {
      cache: "no-store",
      timeoutMs: timeoutMs ?? 10000,
    });
    if (!res?.ok) break;
    const buffer = await res.arrayBuffer().catch(() => null);
    if (!buffer) break;
    totalBytes += buffer.byteLength;
    ok = true;
    rounds += 1;
    if (performance.now() - start >= 500) break;
  }

  const seconds = (performance.now() - start) / 1000;
  if (!ok || seconds <= 0 || !totalBytes) {
    return { speed: "-", bytes: totalBytes, seconds, error: "unavailable" };
  }
  const mbps = ((totalBytes * 8) / seconds / (1024 * 1024)).toFixed(1);
  return { speed: `${mbps} Mbps`, bytes: totalBytes, seconds, error: "" };
}

/**
 * 探测某个域名是否直连可达
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<{ reachable: boolean; latency: number }>}
 */
export async function probeHost(url, timeoutMs) {
  const { ok, ms } = await headProbe(url, timeoutMs ?? 5000);
  return { reachable: ok, latency: ms };
}

/**
 * 探测节点能力：是否支持 Range 断点续传、是否支持 git smart HTTP
 * @param {string} node
 * @param {number} [timeoutMs]
 * @returns {Promise<{ range: boolean; git: boolean }>}
 */
export async function probeCapabilities(node, timeoutMs) {
  const host = String(node ?? "").replace(/\/+$/, "");
  if (!host) return { range: false, git: false };

  const base = buildProxyUrl(host, "https://github.com/octocat/Hello-World");
  const ms = timeoutMs ?? 8000;

  const rangeRes = await fetchWithTimeout(`${base}/README.md`, {
    headers: { Range: "bytes=0-127" },
    cache: "no-store",
    timeoutMs: ms,
  });
  const range =
    rangeRes?.status === 206 || Boolean(rangeRes?.headers?.get?.("content-range"));

  let git = false;
  const gitRes = await fetchWithTimeout(`${base}.git/info/refs?service=git-upload-pack`, {
    cache: "no-store",
    timeoutMs: ms,
  });
  if (gitRes?.ok) {
    const text = await gitRes.text().catch(() => "");
    git = text.includes("git-upload-pack") || text.includes("refs/");
  }

  return { range, git };
}

/**
 * @typedef {Object} TestResult
 * @property {string} value
 * @property {string} latency
 * @property {string} speed
 * @property {number} ts
 */

/**
 * 完整测速：延迟 + 带宽
 * @param {string} node
 * @param {string} sampleUrl
 * @param {{ withSpeed?: boolean; latencyTimeout?: number; speedTimeout?: number }} [opts]
 * @returns {Promise<TestResult>}
 */
export async function testNode(node, sampleUrl, opts) {
  const options = opts ?? {};
  const latencyResult = await testLatency(node, options.latencyTimeout);
  const latency =
    latencyResult.latency === null ? "timeout" : String(latencyResult.latency);

  let speed = "-";
  if (options.withSpeed !== false) {
    const speedResult = await testSpeed(node, sampleUrl, options.speedTimeout);
    speed = speedResult.speed;
  }
  return { value: node, latency, speed, ts: Date.now() };
}

/**
 * @typedef {Object} RepoSyncResult
 * @property {string} id
 * @property {string} name
 * @property {boolean} ok
 * @property {number} count
 * @property {string} [source]
 * @property {string} [error]
 */

/**
 * 依次同步多个节点仓库，按仓库标记来源后合并。
 * 每个仓库按自己的 parser 解析清单，节点带上能力分类（kind）。
 * @param {any} settings
 * @param {import("./repos.js").NodeRepo[]} repos
 * @param {number} [timeoutMs]
 * @returns {Promise<{ nodes: any[]; results: RepoSyncResult[]; okCount: number }>}
 */
export async function syncAllRepos(settings, repos, timeoutMs) {
  const list = repos ?? [];
  /** @type {RepoSyncResult[]} */
  const results = [];
  let nodes = [...(settings?.remoteNodes ?? [])];
  let okCount = 0;

  for (const repo of list) {
    const result = await fetchRemoteNodes(repo.mirrors, timeoutMs ?? 15000, repo.parser);
    if (result.ok) {
      okCount += 1;
      // 仓库默认分类 + 已知 CDN 域名校正
      const tagged = result.nodes.map((n) => ({
        ...n,
        kind: kindForHost(n.value, n.kind ?? repo.kind),
      }));
      nodes = replaceRepoNodes(nodes, repo.id, tagged);
      results.push({
        id: repo.id,
        name: repo.name,
        ok: true,
        count: result.nodes.length,
        source: result.source,
      });
    } else {
      results.push({
        id: repo.id,
        name: repo.name,
        ok: false,
        count: 0,
        error: result.error,
      });
    }
  }

  // 设置页「自定义节点源」文本域：作为额外的虚拟仓库参与同步。
  // 该列表是权威的——为空时要把历史遗留的 custom 节点一并清掉。
  const customSources = (settings?.updateSources ?? []).filter(Boolean);
  if (customSources.length) {
    const result = await fetchRemoteNodes(customSources, timeoutMs ?? 15000);
    if (result.ok) {
      okCount += 1;
      nodes = replaceRepoNodes(nodes, "custom", result.nodes);
    }
    results.push({
      id: "custom",
      name: "自定义源",
      ok: result.ok,
      count: result.nodes.length,
      source: result.source,
      error: result.error,
    });
  } else {
    nodes = nodes.filter((item) => item?.source !== "custom");
  }

  return { nodes, results, okCount };
}

export const FGNet = {
  parseNodes,
  syncAllRepos,
  fetchText,
  fetchRemoteNodes,
  testLatency,
  testSpeed,
  testNode,
  probeHost,
  probeCapabilities,
};
