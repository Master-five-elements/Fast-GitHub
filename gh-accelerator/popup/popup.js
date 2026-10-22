/**
 * 弹窗：查看/切换当前节点、测速、一键代理当前页
 */

import { FGNet } from "../lib/net.js";
import { FGStore } from "../lib/store.js";

/** @type {import("../lib/store.js").Settings | null} */
let settings = null;
/** @type {chrome.tabs.Tab | null} */
let currentTab = null;

const $ = (/** @type {string} */ id) => document.getElementById(id);

function toast(message, kind) {
  const wrap = $("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `fg-toast${kind ? ` is-${kind}` : ""}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function applyTheme() {
  const mode = settings?.theme ?? "system";
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/** @param {string} [value] */
function fmtLatency(value) {
  if (!value || value === "-") return "未测速";
  if (value === "timeout") return "超时";
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return value;
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`;
}

function render() {
  if (!settings) return;
  applyTheme();
  const enabled = $("enabled");
  if (enabled) enabled.checked = Boolean(settings.enabled);

  const best = FGStore.bestNode(settings);
  const stat = FGStore.statOf(settings, best);

  const nodeValue = $("nodeValue");
  if (nodeValue) {
    nodeValue.textContent = best || "—";
    nodeValue.title = best ?? "";
  }
  $("strategyTag").textContent = settings.strategy === "manual" ? "手动" : "自动";
  $("nodeLatency").textContent = stat ? fmtLatency(stat.latency) : "未测速";
  $("nodeSpeed").textContent = stat?.speed && stat.speed !== "-" ? stat.speed : "未测速";
  $("syncInfo").textContent = settings.lastUpdate
    ? `最近同步：${new Date(settings.lastUpdate).toLocaleString()}`
    : "尚未同步节点";
  $("currentUrl").textContent = currentTab?.url || "无可用页面";
}

async function testCurrent() {
  if (!settings) return;
  const node = FGStore.bestNode(settings);
  const button = /** @type {HTMLButtonElement} */ ($("btnTest"));
  if (button) {
    button.disabled = true;
    button.textContent = "测速中";
  }
  const result = await FGNet.testNode(node, settings.speedTestUrl, { withSpeed: true });
  await FGStore.saveStat(node, result.latency, result.speed);
  settings = await FGStore.get();
  if (button) {
    button.disabled = false;
    button.textContent = "测速";
  }
  render();
  toast(`延迟 ${result.latency} · 带宽 ${result.speed}`, "ok");
}

async function nextNode() {
  if (!settings) return;
  const list = FGStore.activeNodes(settings)
    .map((node) => ({ ...node, stat: FGStore.statOf(settings, node.value) }))
    .sort((a, b) => {
      const speedA = Number.parseFloat(String(a.stat?.speed ?? "")) || 0;
      const speedB = Number.parseFloat(String(b.stat?.speed ?? "")) || 0;
      if (speedA !== speedB) return speedB - speedA;
      const latA = Number.parseFloat(String(a.stat?.latency ?? "")) || 9999;
      const latB = Number.parseFloat(String(b.stat?.latency ?? "")) || 9999;
      return latA - latB;
    });
  if (!list.length) return;

  const current = FGStore.bestNode(settings);
  const index = list.findIndex((n) => n.value === current);
  const next = list[(index + 1) % list.length];
  settings = await FGStore.set({ strategy: "manual", manualNode: next.value });
  render();
  toast(`已切换到 ${next.value}`, "ok");
}

async function syncNodes() {
  const button = /** @type {HTMLButtonElement} */ ($("btnSync"));
  if (button) {
    button.disabled = true;
    button.textContent = "同步中";
  }
  const res = await chrome.runtime.sendMessage({ type: "syncNodes" });
  settings = await FGStore.get();
  if (button) {
    button.disabled = false;
    button.textContent = "同步节点";
  }
  render();
  toast(res?.ok ? "节点同步成功" : "同步失败，稍后重试", res?.ok ? "ok" : "err");
}

async function proxyCurrent() {
  if (!currentTab?.url) {
    toast("没有可代理的页面", "err");
    return;
  }
  const res = await chrome.runtime.sendMessage({ type: "proxyTab" });
  if (!res?.ok) {
    toast(res?.error || "代理失败", "err");
    return;
  }
  window.close();
}

async function copyProxyLink() {
  if (!settings || !currentTab?.url) {
    toast("没有可复制的页面", "err");
    return;
  }
  const guard = await chrome.runtime.sendMessage({
    type: "checkSensitive",
    url: currentTab.url,
  });
  if (guard?.blocked) {
    toast("登录 / 私有页面已禁止走代理，凭证安全第一", "err");
    return;
  }
  const node = FGStore.bestNode(settings);
  const target = FGStore.buildProxyUrl(node, currentTab.url);
  try {
    await navigator.clipboard.writeText(target);
    toast("已复制加速链接", "ok");
  } catch {
    toast(`复制失败：${target}`, "err");
  }
}

function bind() {
  $("enabled")?.addEventListener("change", async (event) => {
    const checked = /** @type {HTMLInputElement} */ (event.target).checked;
    settings = await FGStore.set({ enabled: checked });
    toast(checked ? "已启用" : "已停用", "ok");
  });
  $("btnTest")?.addEventListener("click", testCurrent);
  $("btnNext")?.addEventListener("click", nextNode);
  $("btnSync")?.addEventListener("click", syncNodes);
  $("btnProxy")?.addEventListener("click", proxyCurrent);
  $("btnCopy")?.addEventListener("click", copyProxyLink);
  $("btnOptions")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
}

async function boot() {
  settings = await FGStore.get();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;
  bind();
  render();
}

boot();
