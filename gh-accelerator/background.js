/**
 * Service Worker（ES Module）
 * - 每 24 小时自动同步加速节点
 * - github.com 加载失败时自动切换到代理节点
 * - 为 popup / options / content script 提供统一消息接口
 */

import { FGNet } from "./lib/net.js";
import { FGStore, matchSensitive } from "./lib/store.js";

const ALARM_SYNC = "fg-node-sync";

/** 这些错误不代表"打不开"，无需代理 */
const IGNORED_ERRORS = [
  "net::ERR_ABORTED",
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_BLOCKED_BY_CLIENT",
  "net::ERR_BLOCKED_BY_ORBIT",
  "net::ERR_CACHE_MISS",
];

/** @type {Map<string, number>} tabId|url -> 尝试次数 */
const failCounter = new Map();
/** @type {Set<string>} 内容脚本上报的私有仓库地址 */
const privateUrls = new Set();
/** @type {Set<number>} 等待注入安全提示条的 tabId */
const bannerPending = new Set();

/**
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 是否 GitHub 系域名
 * @param {string} url
 */
function isGithubHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "github.com" ||
      host.endsWith(".github.com") ||
      host === "githubusercontent.com" ||
      host.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}

/**
 * 敏感地址判定：动态白名单 + 运行时私有仓库集合
 * @param {string} url
 * @param {import("./lib/store.js").Settings} settings
 */
function isSensitiveUrl(url, settings) {
  if (!url) return false;
  if (privateUrls.has(url)) return true;
  return matchSensitive(url, settings.sensitivePaths ?? []);
}

/* ------------------------------ 节点同步 ------------------------------ */

/**
 * @param {"manual" | "install" | "startup" | "alarm"} reason
 */
async function syncNodes(reason) {
  const settings = await FGStore.get();
  if (!settings.autoUpdate && !["manual", "install"].includes(reason)) {
    return { ok: false, nodes: [], source: "", error: "autoUpdate disabled" };
  }

  const result = await FGNet.fetchRemoteNodes(settings.updateSources, 15000);

  if (result.ok) {
    await FGStore.set({
      remoteNodes: FGStore.dedupe(result.nodes),
      lastUpdate: Date.now(),
      lastUpdateMessage: `已同步 ${result.nodes.length} 个节点 · ${hostOf(result.source)}`,
    });
  } else {
    await FGStore.set({
      lastUpdateMessage: `同步失败：${String(result.error).slice(0, 140)}`,
    });
  }
  return result;
}

/** 按当前设置重建定时同步任务 */
async function scheduleSync() {
  const settings = await FGStore.get();
  await chrome.alarms.clear(ALARM_SYNC);
  if (!settings.autoUpdate) return;
  const hours = Math.max(1, Number(settings.updateIntervalHours) || 24);
  await chrome.alarms.create(ALARM_SYNC, {
    delayInMinutes: 1,
    periodInMinutes: hours * 60,
  });
}

/* --------------------------- 失败自动代理 ---------------------------- */

/** 在代理页面顶部注入安全提示条 */
function injectProxyBanner(tabId) {
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        if (document.getElementById("fg-proxy-banner")) return;
        const bar = document.createElement("div");
        bar.id = "fg-proxy-banner";
        bar.textContent =
          "⚠️ 当前页面经由第三方公益节点代理访问，请勿登录或输入任何凭证。";
        bar.style.cssText = [
          "position:fixed",
          "top:0",
          "left:0",
          "right:0",
          "z-index:2147483647",
          "padding:8px 14px",
          "background:#b45309",
          "color:#fff",
          "font-size:13px",
          "text-align:center",
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif",
          "box-shadow:0 2px 10px rgba(0,0,0,.3)",
        ].join(";");
        (document.documentElement ?? document.body).appendChild(bar);
      },
    })
    .catch(() => {
      /* 部分页面不允许注入，忽略 */
    });
}

/**
 * @param {number} tabId
 * @param {string} url
 */
async function autoProxyTab(tabId, url) {
  const settings = await FGStore.get();
  if (!settings.enabled || !settings.autoProxyOnFailure) return false;

  if (settings.protectSensitive && isSensitiveUrl(url, settings)) {
    console.warn("[FastGitHub] 敏感页面，已跳过自动代理:", url);
    return false;
  }

  const node = FGStore.bestNode(settings) || settings.fallbackNode;
  if (!node) return false;

  const target = FGStore.buildProxyUrl(node, url);
  try {
    await chrome.tabs.update(tabId, { url: target });
    bannerPending.add(tabId);
    try {
      await chrome.action.setBadgeBackgroundColor({ color: "#7c3aed", tabId });
      await chrome.action.setBadgeText({ text: "代理", tabId });
    } catch {
      /* badge 失败不影响主流程 */
    }
    console.info("[FastGitHub] 已自动代理 ->", target);
    return true;
  } catch (error) {
    console.warn("[FastGitHub] 自动代理失败", error);
    return false;
  }
}

chrome.webNavigation.onErrorOccurred.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    if (!details.url || !isGithubHost(details.url)) return;
    if (IGNORED_ERRORS.includes(details.error)) return;

    const settings = await FGStore.get();
    if (settings.protectSensitive && isSensitiveUrl(details.url, settings)) {
      console.warn("[FastGitHub] 敏感页面不做自动代理:", details.url);
      return;
    }

    const key = `${details.tabId}|${details.url}`;
    const tries = (failCounter.get(key) ?? 0) + 1;
    failCounter.set(key, tries);
    if (tries > 2) return;

    console.info("[FastGitHub] 检测到加载失败:", details.error, details.url);
    await autoProxyTab(details.tabId, details.url);
  },
  { url: [{ hostSuffix: "github.com" }, { hostSuffix: "githubusercontent.com" }] },
);

chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (isGithubHost(details.url)) {
    failCounter.delete(`${details.tabId}|${details.url}`);
  }
  if (bannerPending.has(details.tabId)) {
    bannerPending.delete(details.tabId);
    injectProxyBanner(details.tabId);
  }
  try {
    await chrome.action.setBadgeText({ text: "", tabId: details.tabId });
  } catch {
    /* ignore */
  }
});

/* ---------------------------- 腾讯翻译(可选) ---------------------------- */

const LANG_TABLE = {
  arabic: "ar",
  german: "de",
  russian: "ru",
  french: "fr",
  filipino: "fil",
  khmer: "km",
  korean: "ko",
  laos: "lo",
  portuguese: "pt",
  spanish: "es",
  italian: "it",
  indonesian: "id",
  english: "en",
  vietnamese: "vi",
  chinese: "zh",
};

/**
 * @param {string} content
 * @returns {Promise<[string | null, string | null]>}
 */
async function translateText(content) {
  const settings = await FGStore.get();
  if (!settings.token) return [null, "未配置腾讯 AI 翻译 Token"];
  if (!settings.language || settings.language === "nothing") {
    return [null, "未选择翻译目标语言"];
  }

  const post = (/** @type {unknown} */ body) =>
    fetch("https://transmart.qq.com/api/imt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  try {
    const detect = await post({
      header: { fn: "lang_detect", token: settings.token },
      text: content,
    });
    const code = LANG_TABLE[String(detect?.language ?? "").toLowerCase()];
    if (!code) return [null, "该语言无法识别"];

    const translated = await post({
      header: { fn: "auto_translation_block", token: settings.token },
      type: "plain",
      source: { lang: code, text_block: content },
      target: { lang: settings.language },
    });
    return [translated?.auto_translation ?? null, null];
  } catch {
    return [null, "翻译发生错误"];
  }
}

/* ------------------------------- 消息 ------------------------------- */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message ?? {};
  const type = msg.type ?? (msg.content !== undefined ? "translate" : "");

  const reply = (/** @type {unknown} */ payload) => {
    try {
      sendResponse(payload);
    } catch {
      /* 通道已关闭 */
    }
  };

  if (type === "translate") {
    translateText(msg.content).then(([data, error]) => {
      reply({ content: data ?? error ?? "" });
    });
    return true;
  }

  if (type === "getSettings") {
    FGStore.get().then((settings) => reply({ ok: true, settings }));
    return true;
  }

  if (type === "setSettings") {
    FGStore.set(msg.patch ?? {}).then(async (settings) => {
      await scheduleSync();
      reply({ ok: true, settings });
    });
    return true;
  }

  if (type === "syncNodes") {
    syncNodes("manual").then(async (result) => {
      await scheduleSync();
      reply({ ok: Boolean(result.ok), result });
    });
    return true;
  }

  if (type === "testNode") {
    (async () => {
      const settings = await FGStore.get();
      const result = await FGNet.testNode(msg.value, settings.speedTestUrl, {
        withSpeed: msg.withSpeed !== false,
      });
      await FGStore.saveStat(msg.value, result.latency, result.speed);
      reply({ ok: true, result });
    })();
    return true;
  }

  if (type === "testNodes") {
    (async () => {
      const settings = await FGStore.get();
      /** @type {any[]} */
      const results = [];
      for (const value of msg.values ?? []) {
        const result = await FGNet.testNode(value, settings.speedTestUrl, {
          withSpeed: msg.withSpeed !== false,
        });
        await FGStore.saveStat(value, result.latency, result.speed);
        results.push(result);
      }
      reply({ ok: true, results });
    })();
    return true;
  }

  if (type === "proxyTab") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        reply({ ok: false, error: "no tab" });
        return;
      }
      const settings = await FGStore.get();
      const source = tab.url ?? msg.url;

      if (settings.protectSensitive && isSensitiveUrl(source, settings)) {
        reply({
          ok: false,
          blocked: true,
          error: "该页面属于登录 / 账号 / 私有内容，已拒绝代理以保护凭证安全",
        });
        return;
      }

      const node = msg.node ?? FGStore.bestNode(settings) ?? settings.fallbackNode;
      const url = FGStore.buildProxyUrl(node, source);
      bannerPending.add(tab.id);
      await chrome.tabs.update(tab.id, { url });
      reply({ ok: true, url });
    })();
    return true;
  }

  if (type === "checkSensitive") {
    FGStore.get().then((settings) =>
      reply({
        blocked: Boolean(settings.protectSensitive && isSensitiveUrl(msg.url, settings)),
      }),
    );
    return true;
  }

  if (type === "markPrivate") {
    if (msg.url) privateUrls.add(msg.url);
    reply({ ok: true });
    return true;
  }

  return false;
});

/* ------------------------------ 生命周期 ------------------------------ */

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await syncNodes("install");
    await scheduleSync();
    await chrome.runtime.openOptionsPage();
    return;
  }
  await scheduleSync();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await FGStore.get();
  await scheduleSync();
  const hours = Math.max(1, Number(settings.updateIntervalHours) || 24);
  if (Date.now() - (settings.lastUpdate ?? 0) > hours * 3600 * 1000) {
    await syncNodes("startup");
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_SYNC) return;
  const settings = await FGStore.get();
  const hours = Math.max(1, Number(settings.updateIntervalHours) || 24);
  const stale = Date.now() - (settings.lastUpdate ?? 0) >= hours * 3600 * 1000 * 0.95;
  if (settings.autoUpdate && (stale || !settings.lastUpdate)) {
    await syncNodes("alarm");
  }
});
