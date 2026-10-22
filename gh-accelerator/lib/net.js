/* ------------------------------------------------------------------
 * FGNet —— 远端节点同步 + 节点测速（延迟 / 带宽）
 * ------------------------------------------------------------------ */

var FGNet = (function () {
  /**
   * 解析节点清单。兼容三种形态：
   *  1) ghproxy-next 的 nodes.ts:  { label: "contribute", value: "gh-proxy.com" }
   *  2) JSON 数组: [{"value":"..."}] 或 ["gh-proxy.com"]
   *  3) 纯文本: 一行一个域名
   */
  function parseNodes(text) {
    if (!text) return [];
    const out = [];

    const pairRe =
      /\{\s*label\s*:\s*["']([^"']*)["']\s*,\s*value\s*:\s*["']([^"']+)["']\s*\}/g;
    let m;
    while ((m = pairRe.exec(text)) !== null) {
      out.push({ value: m[2].trim(), label: (m[1] || "contribute").trim() });
    }
    if (out.length) return out;

    const trimmed = text.trim();
    if (trimmed[0] === "[" || trimmed[0] === "{") {
      try {
        const data = JSON.parse(trimmed);
        const arr = Array.isArray(data) ? data : data.nodes || [];
        arr.forEach((item) => {
          if (typeof item === "string") out.push({ value: item.trim(), label: "remote" });
          else if (item && item.value) out.push({ value: String(item.value).trim(), label: item.label || "remote" });
        });
        if (out.length) return out;
      } catch (e) {
        /* 继续按纯文本处理 */
      }
    }

    text.split(/\r?\n/).forEach((line) => {
      const v = line.trim().replace(/^["',]+|["',]+$/g, "");
      if (!v || v.startsWith("//") || v.startsWith("#")) return;
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return;
      out.push({ value: v, label: "remote" });
    });
    return out;
  }

  async function fetchText(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "*/*" },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  /**
   * 从远端拉取节点清单，多镜像源依次降级
   * @returns {{ok:boolean, nodes:Array, source:string, error:string}}
   */
  async function fetchRemoteNodes(sources, timeoutMs) {
    const list = (sources && sources.length ? sources : []).filter(Boolean);
    const errors = [];
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      try {
        const text = await fetchText(src, timeoutMs || 15000);
        const nodes = parseNodes(text).filter((n) => n.value && n.value.indexOf(".") > 0);
        if (nodes.length) {
          return { ok: true, nodes: nodes, source: src, error: "" };
        }
        errors.push(src + " -> 解析为空");
      } catch (e) {
        errors.push(src + " -> " + ((e && e.message) || e));
      }
    }
    return { ok: false, nodes: [], source: "", error: errors.join(" | ") };
  }

  /**
   * 延迟探测：对节点根路径发起 HEAD(no-cors)，统计往返耗时
   * @returns {{latency:number|null, error:string}}
   */
  async function testLatency(node, timeoutMs) {
    const host = String(node || "").replace(/\/+$/, "");
    if (!host) return { latency: null, error: "empty" };
    const url = /^https?:\/\//i.test(host) ? host + "/" : "https://" + host + "/";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 6000);
    const t0 = performance.now();
    try {
      await fetch(url, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { latency: Math.round(performance.now() - t0), error: "" };
    } catch (e) {
      clearTimeout(timer);
      const err = e && e.name === "AbortError" ? "timeout" : "error";
      return { latency: null, error: err };
    }
  }

  /**
   * 带宽测速：经节点下载样本文件，重复多轮直到耗时足够（>=500ms）以降低误差
   * @returns {{speed:string, bytes:number, seconds:number, error:string}}
   */
  async function testSpeed(node, sampleUrl, timeoutMs) {
    const host = String(node || "").replace(/\/+$/, "");
    if (!host || !sampleUrl) return { speed: "-", bytes: 0, error: "empty" };

    const base = FGStore.buildProxyUrl(host, sampleUrl);
    const started = performance.now();
    let totalBytes = 0;
    let rounds = 0;
    let ok = false;

    while (rounds < 4) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs || 10000);
      try {
        const url = base + (base.indexOf("?") > -1 ? "&" : "?") + "t=" + Date.now();
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!res.ok) {
          clearTimeout(timer);
          break;
        }
        const buf = await res.arrayBuffer();
        clearTimeout(timer);
        totalBytes += buf.byteLength;
        ok = true;
        rounds++;
        if (performance.now() - started >= 500) break;
      } catch (e) {
        clearTimeout(timer);
        break;
      }
    }

    const seconds = (performance.now() - started) / 1000;
    if (!ok || seconds <= 0 || !totalBytes) {
      return { speed: "-", bytes: totalBytes, seconds: seconds, error: "unavailable" };
    }
    const mbps = totalBytes * 8 / seconds / (1024 * 1024);
    return {
      speed: mbps.toFixed(1) + " Mbps",
      bytes: totalBytes,
      seconds: seconds,
      error: "",
    };
  }

  /** 完整测速：延迟 + 带宽 */
  async function testNode(node, sampleUrl, opts) {
    const options = opts || {};
    const latencyResult = await testLatency(node, options.latencyTimeout);
    const latency =
      latencyResult.latency === null ? "timeout" : String(latencyResult.latency);

    let speed = "-";
    if (options.withSpeed !== false) {
      const speedResult = await testSpeed(node, sampleUrl, options.speedTimeout);
      speed = speedResult.speed;
    }
    return { value: node, latency: latency, speed: speed, ts: Date.now() };
  }

  return {
    parseNodes,
    fetchText,
    fetchRemoteNodes,
    testLatency,
    testSpeed,
    testNode,
  };
})();
