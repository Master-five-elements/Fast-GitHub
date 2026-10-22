/**
 * 远端节点同步 + 节点测速（延迟 / 带宽）。
 */

import { buildProxyUrl } from "./store.js";

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
 * 解析节点清单，兼容三种形态：
 * 1. ghproxy-next 的 nodes.ts：`{ label: "…", value: "…" }`
 * 2. JSON 数组：`[{ value }]` 或 `["a.com"]`
 * 3. 纯文本：一行一个域名
 * @param {string} text
 * @returns {{ value: string; label: string }[]}
 */
export function parseNodes(text) {
  if (!text) return [];
  /** @type {{ value: string; label: string }[]} */
  const out = [];

  const pairRe =
    /\{\s*label\s*:\s*["']([^"']*)["']\s*,\s*value\s*:\s*["']([^"']+)["']\s*\}/g;
  for (let match = pairRe.exec(text); match !== null; match = pairRe.exec(text)) {
    out.push({ value: match[2].trim(), label: (match[1] || "contribute").trim() });
  }
  if (out.length) return out;

  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data) ? data : (data.nodes ?? []);
      for (const item of arr) {
        if (typeof item === "string") {
          out.push({ value: item.trim(), label: "remote" });
        } else if (item?.value) {
          out.push({ value: String(item.value).trim(), label: item.label ?? "remote" });
        }
      }
      if (out.length) return out;
    } catch {
      /* 继续按纯文本处理 */
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const value = line.trim().replace(/^["',]+|["',]+$/g, "");
    if (!value || value.startsWith("//") || value.startsWith("#")) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) continue;
    out.push({ value, label: "remote" });
  }
  return out;
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {Object} SyncResult
 * @property {boolean} ok
 * @property {{ value: string; label: string }[]} nodes
 * @property {string} source
 * @property {string} error
 */

/**
 * 从远端拉取节点清单，多镜像源依次降级
 * @param {string[]} sources
 * @param {number} [timeoutMs]
 * @returns {Promise<SyncResult>}
 */
export async function fetchRemoteNodes(sources, timeoutMs) {
  const list = (sources ?? []).filter(Boolean);
  /** @type {string[]} */
  const errors = [];

  for (const source of list) {
    try {
      const text = await fetchText(source, timeoutMs ?? 15000);
      const nodes = parseNodes(text).filter((n) => n.value.includes("."));
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 6000);
  const start = performance.now();
  try {
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return { latency: Math.round(performance.now() - start), error: "" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { latency: null, error: name === "AbortError" ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? 10000);
    try {
      const url = `${base}${base.includes("?") ? "&" : "?"}t=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) {
        clearTimeout(timer);
        break;
      }
      const buffer = await res.arrayBuffer();
      clearTimeout(timer);
      totalBytes += buffer.byteLength;
      ok = true;
      rounds += 1;
      if (performance.now() - start >= 500) break;
    } catch {
      clearTimeout(timer);
      break;
    }
  }

  const seconds = (performance.now() - start) / 1000;
  if (!ok || seconds <= 0 || !totalBytes) {
    return { speed: "-", bytes: totalBytes, seconds, error: "unavailable" };
  }
  const mbps = ((totalBytes * 8) / seconds / (1024 * 1024)).toFixed(1);
  return { speed: `${mbps} Mbps`, bytes: totalBytes, seconds, error: "" };
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

export const FGNet = {
  parseNodes,
  fetchText,
  fetchRemoteNodes,
  testLatency,
  testSpeed,
  testNode,
};
