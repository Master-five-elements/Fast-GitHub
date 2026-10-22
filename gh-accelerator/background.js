/* ------------------------------------------------------------------
 * Service Worker
 *  - 每 24 小时自动同步加速节点
 *  - github.com 加载失败时自动切换到代理节点
 *  - 为 popup / options / content script 提供统一消息接口
 * ------------------------------------------------------------------ */

importScripts(
  "lib/default-nodes.js",
  "lib/store.js",
  "lib/net.js"
);

const ALARM_SYNC = "fg-node-sync";
const IGNORED_ERRORS = [
  "net::ERR_ABORTED",
  "net::ERR_INTERNET_DISCONNECTED",
  "net::ERR_BLOCKED_BY_CLIENT",
  "net::ERR_BLOCKED_BY_ORBIT",
  "net::ERR_CACHE_MISS",
];

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return url;
  }
}

/* ------------------------------ 节点同步 ------------------------------ */

async function syncNodes(reason) {
  const settings = await FGStore.get();
  if (!settings.autoUpdate && reason !== "manual" && reason !== "install") {
    return { ok: false, skipped: true, error: "autoUpdate disabled" };
  }

  const result = await FGNet.fetchRemoteNodes(settings.updateSources, 15000);

  if (result.ok) {
    const nodes = FGStore.dedupe(
      result.nodes.map((n) => ({ value: n.value, label: n.label || "remote" }))
    );
    await FGStore.set({
      remoteNodes: nodes,
      lastUpdate: Date.now(),
      lastUpdateMessage:
        "已同步 " + nodes.length + " 个节点 · " + hostOf(result.source),
    });
  } else {
    await FGStore.set({
      lastUpdateMessage: "同步失败：" + String(result.error || "").slice(0, 140),
    });
  }
  return result;
}

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

const failCounter = new Map(); // tabId|url -> 尝试次数
const privateUrls = new Set(); // 内容脚本上报的私有仓库地址
const bannerPending = new Set(); // 等待注入安全提示条的 tabId

/* ------------------------------------------------------------------
 * 敏感页面保护：登录 / 账号 / 设置 / 私有仓库等一律不代理
 * 凭证绝不能经过第三方公益节点
 * ------------------------------------------------------------------ */

const SENSITIVE_PATH_RE = [
  /^\/login(\/|\?|$)/i,
  /^\/logout(\/|\?|$)/i,
  /^\/sessions?(\/|\?|$)/i,
  /^\/signup(\/|\?|$)/i,
  /^\/join(\/|\?|$)/i,
  /^\/password_reset(\/|\?|$)/i,
  /^\/settings(\/|\?|$)/i,
  /^\/account(\/|\?|$)/i,
  /^\/notifications(\/|\?|$)/i,
  /^\/apps(\/|\?|$)/i,
  /^\/billing(\/|\?|$)/i,
  /^\/security(\/|\?|$)/i,
  /^\/sponsors\/[^/]+\/dashboard/i,
  /^\/orgs\/[^/]+\/(settings|people|teams|billing|security)/i,
  /^\/organizations\/[^/]+\/settings/i,
  /^\/enterprises\/[^/]+\/(settings|security|billing)/i,
  /^\/users\/[^/]+\/settings/i,
  /^\/settings\/tokens/i,
];

function isGithubHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "github.com" || host.endsWith(".github.com") ||
      host === "githubusercontent.com" || host.endsWith(".githubusercontent.com");
  } catch (e) {
    return false;
  }
}

/** 是否属于永不代理的敏感地址 */
function isSensitiveUrl(url) {
  if (!url) return false;
  if (privateUrls.has(url)) return true;
  try {
    const path = new URL(url).pathname;
    return SENSITIVE_PATH_RE.some((re) => re.test(path));
  } catch (e) {
    return false;
  }
}

/** 在代理页面上注入安全提示条（提醒不要登录） */
function injectProxyBanner(tabId) {
  chrome.scripting
    .executeScript({
      target: { tabId: tabId },
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
        (document.documentElement || document.body).appendChild(bar);
      },
    })
    .catch(() => {
      /* 某些页面不允许注入，忽略 */
    });
}

async function autoProxyTab(tabId, url) {
  const settings = await FGStore.get();
  if (!settings.enabled || !settings.autoProxyOnFailure) return false;

  // 敏感页面（登录 / 设置 / 私有仓库）永不代理
  if (settings.protectSensitive && isSensitiveUrl(url)) {
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
      await chrome.action.setBadgeBackgroundColor({ color: "#7c3aed", tabId: tabId });
      await chrome.action.setBadgeText({ text: "代理", tabId: tabId });
    } catch (e) {
      /* badge 失败不影响主流程 */
    }
    console.info("[FastGitHub] 已自动代理 ->", target);
    return true;
  } catch (e) {
    console.warn("[FastGitHub] 自动代理失败", e);
    return false;
  }
}

chrome.webNavigation.onErrorOccurred.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    if (!details.url || !isGithubHost(details.url)) return;
    if (IGNORED_ERRORS.indexOf(details.error) > -1) return;

    const currentSettings = await FGStore.get();
    if (currentSettings.protectSensitive && isSensitiveUrl(details.url)) {
      console.warn("[FastGitHub] 敏感页面不做自动代理:", details.url);
      return;
    }

    const key = details.tabId + "|" + details.url;
    const tries = (failCounter.get(key) || 0) + 1;
    failCounter.set(key, tries);
    if (tries > 2) return;

    console.info("[FastGitHub] 检测到加载失败:", details.error, details.url);
    await autoProxyTab(details.tabId, details.url);
  },
  {
    url: [
      { hostSuffix: "github.com" },
      { hostSuffix: "githubusercontent.com" },
    ],
  }
);

// 页面恢复可访问后清除角标
chrome.webNavigation.onCompleted.addListener(
  async (details) => {
    if (details.frameId !== 0) return;
    if (isGithubHost(details.url)) {
      failCounter.delete(details.tabId + "|" + details.url);
    }
    if (bannerPending.has(details.tabId)) {
      bannerPending.delete(details.tabId);
      injectProxyBanner(details.tabId);
    }
    try {
      await chrome.action.setBadgeText({ text: "", tabId: details.tabId });
    } catch (e) {
      /* ignore */
    }
  }
);

/* ---------------------------- 腾讯翻译(可选) ---------------------------- */

async function translateText(content) {
  const settings = await FGStore.get();
  if (!settings.token) return [null, "未配置腾讯 AI 翻译 Token"];
  if (!settings.language || settings.language === "nothing") {
    return [null, "未选择翻译目标语言"];
  }

  const post = (body) =>
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
    const lang = detect && detect.language;
    const table = {
      arabic: "ar", german: "de", russian: "ru", french: "fr", filipino: "fil",
      khmer: "km", korean: "ko", laos: "lo", portuguese: "pt", spanish: "es",
      italian: "it", indonesian: "id", english: "en", vietnamese: "vi",
      chinese: "zh",
    };
    const code = table[String(lang || "").toLowerCase()];
    if (!code) return [null, "该语言无法识别"];

    const translated = await post({
      header: { fn: "auto_translation_block", token: settings.token },
      type: "plain",
      source: { lang: code, text_block: content },
      target: { lang: settings.language },
    });
    return [translated && translated.auto_translation, null];
  } catch (e) {
    return [null, "翻译发生错误"];
  }
}

/* ------------------------------- 消息 ------------------------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message || {};
  const type = msg.type || (msg.content !== undefined ? "translate" : "");

  const reply = (payload) => {
    try {
      sendResponse(payload);
    } catch (e) {
      /* 通道已关闭 */
    }
  };

  if (type === "translate") {
    translateText(msg.content).then(([data, error]) => {
      reply({ content: data || error || "" });
    });
    return true;
  }

  if (type === "getSettings") {
    FGStore.get().then((s) => reply({ ok: true, settings: s }));
    return true;
  }

  if (type === "setSettings") {
    FGStore.set(msg.patch || {})
      .then(async (s) => {
        await scheduleSync();
        reply({ ok: true, settings: s });
      });
    return true;
  }

  if (type === "syncNodes") {
    syncNodes("manual")
      .then(async (r) => {
        await scheduleSync();
        reply({ ok: !!r.ok, result: r });
      });
    return true;
  }

  if (type === "testNode") {
    (async () => {
      const s = await FGStore.get();
      const r = await FGNet.testNode(msg.value, s.speedTestUrl, {
        withSpeed: msg.withSpeed !== false,
      });
      await FGStore.saveStat(msg.value, r.latency, r.speed);
      reply({ ok: true, result: r });
    })();
    return true;
  }

  if (type === "testNodes") {
    (async () => {
      const s = await FGStore.get();
      const values = msg.values || [];
      const out = [];
      for (let i = 0; i < values.length; i++) {
        const r = await FGNet.testNode(values[i], s.speedTestUrl, {
          withSpeed: msg.withSpeed !== false,
        });
        await FGStore.saveStat(values[i], r.latency, r.speed);
        out.push(r);
      }
      reply({ ok: true, results: out });
    })();
    return true;
  }

  if (type === "proxyTab") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return reply({ ok: false, error: "no tab" });
      const s = await FGStore.get();
      const source = tab.url || msg.url;

      if (s.protectSensitive && isSensitiveUrl(source)) {
        return reply({
          ok: false,
          blocked: true,
          error: "该页面属于登录/账号/私有内容，已拒绝代理以保护凭证安全",
        });
      }

      const node = msg.node || FGStore.bestNode(s) || s.fallbackNode;
      const url = FGStore.buildProxyUrl(node, source);
      bannerPending.add(tab.id);
      await chrome.tabs.update(tab.id, { url: url });
      reply({ ok: true, url: url });
    })();
    return true;
  }

  if (type === "checkSensitive") {
    FGStore.get().then((s) =>
      reply({
        blocked: !!(s.protectSensitive && isSensitiveUrl(msg.url)),
      })
    );
    return true;
  }

  // 内容脚本检测到私有仓库时上报，加入永不代理名单
  if (type === "markPrivate") {
    if (msg.url) privateUrls.add(msg.url);
    reply({ ok: true });
    return true;
  }

  return false;
});

/* ------------------------------ 生命周期 ------------------------------ */

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await FGStore.get();

  if (details.reason === "install") {
    await syncNodes("install");
    await scheduleSync();
    chrome.runtime.openOptionsPage();
    return;
  }

  await scheduleSync();
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await FGStore.get();
  await scheduleSync();
  const hours = Math.max(1, Number(settings.updateIntervalHours) || 24);
  if (Date.now() - (settings.lastUpdate || 0) > hours * 3600 * 1000) {
    await syncNodes("startup");
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_SYNC) return;
  const settings = await FGStore.get();
  const hours = Math.max(1, Number(settings.updateIntervalHours) || 24);
  const stale = Date.now() - (settings.lastUpdate || 0) >= hours * 3600 * 1000 * 0.95;
  if (settings.autoUpdate && (stale || !settings.lastUpdate)) {
    await syncNodes("alarm");
  }
});

chrome.action.onClicked && chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
