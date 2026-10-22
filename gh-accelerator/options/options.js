/**
 * 设置页逻辑：节点管理 / 登录保护白名单 / 通用设置
 */

import { FGNet } from "../lib/net.js";
import { decideRoute, HOST_PROFILES, JSDELIVR, toJsDelivr } from "../lib/routes.js";
import { DEFAULT_SENSITIVE_PATHS, FGStore, matchSensitive } from "../lib/store.js";

/** @type {import("../lib/store.js").Settings | null} */
let settings = null;
let dirty = false;
let testing = false;
let cancelTest = false;

const $ = (/** @type {string} */ id) => document.getElementById(id);

/* ------------------------------ 通用工具 ------------------------------ */

function toast(message, kind) {
  const wrap = $("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `fg-toast${kind ? ` is-${kind}` : ""}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "all .2s";
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

function markDirty() {
  dirty = true;
  const state = $("saveState");
  if (state) {
    state.textContent = "有未保存的修改";
    state.style.color = "var(--fg-amber)";
  }
}

function markSaved() {
  dirty = false;
  const state = $("saveState");
  if (state) {
    state.textContent = `已保存 · ${new Date().toLocaleTimeString()}`;
    state.style.color = "var(--fg-muted)";
  }
}

/** @param {number} ts */
function fmtTime(ts) {
  if (!ts) return "从未";
  const d = new Date(ts);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * 统一重绘界面。节点数据变化后调用，避免各处重复罗列 render 序列。
 * @param {{ repos?: boolean }} [opts] repos 为 true 时连同节点仓库区块一起重绘
 */
function refresh(opts) {
  fillForm();
  fillSelects();
  renderNodes();
  renderRules();
  renderStats();
  if (opts?.repos) {
    renderRepos();
    renderMergeInfo();
  }
}

/** @param {string} [value] */
function fmtLatency(value) {
  if (!value || value === "-") return null;
  if (value === "timeout") return { text: "超时", cls: "fg-badge-bad" };
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return null;
  const text = n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`;
  const cls = n < 400 ? "fg-badge-good" : n < 1000 ? "fg-badge-mid" : "fg-badge-bad";
  return { text, cls };
}

function applyTheme() {
  const mode = settings?.theme ?? "system";
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/* ------------------------------ 表单绑定 ------------------------------ */

const FIELDS = /** @type {const} */ ([
  { id: "autoUpdate", key: "autoUpdate", type: "check" },
  { id: "updateIntervalHours", key: "updateIntervalHours", type: "number" },
  { id: "enabled", key: "enabled", type: "check" },
  { id: "strategy", key: "strategy", type: "value" },
  { id: "manualNode", key: "manualNode", type: "value" },
  { id: "channelCount", key: "channelCount", type: "number" },
  { id: "autoProxyOnFailure", key: "autoProxyOnFailure", type: "check" },
  { id: "protectSensitive", key: "protectSensitive", type: "check" },
  { id: "fallbackNode", key: "fallbackNode", type: "value" },
  { id: "speedTestUrl", key: "speedTestUrl", type: "value" },
  { id: "webIDE", key: "webIDE", type: "value" },
  { id: "routeMode", key: "routeMode", type: "value" },
  { id: "useJsDelivr", key: "useJsDelivr", type: "check" },
  { id: "token", key: "token", type: "value" },
  { id: "language", key: "language", type: "value" },
  { id: "theme", key: "theme", type: "value" },
]);

function fillForm() {
  for (const field of FIELDS) {
    const el = $(field.id);
    if (!el || !settings) continue;
    const value = settings[/** @type {keyof typeof settings} */ (field.key)];
    if (field.type === "check") {
      el.checked = Boolean(value);
    } else {
      el.value = value === undefined || value === null ? "" : String(value);
    }
  }
  const sources = $("updateSources");
  if (sources) sources.value = (settings?.updateSources ?? []).join("\n");
  const message = $("syncMessage");
  if (message) {
    message.textContent =
      settings?.lastUpdateMessage ||
      (settings?.lastUpdate ? `上次同步：${fmtTime(settings.lastUpdate)}` : "尚未同步");
  }
  const manual = $("manualNodeField");
  if (manual) manual.hidden = settings?.strategy !== "manual";
}

function fillSelects() {
  const options = FGStore.allNodes(settings)
    .map((n) => `<option value="${n.value}">${n.value}</option>`)
    .join("");
  for (const [id, value] of [
    ["manualNode", settings?.manualNode],
    ["fallbackNode", settings?.fallbackNode],
  ]) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = options;
    el.value = String(value ?? "");
  }
}

function collectFromForm() {
  if (!settings) return;
  for (const field of FIELDS) {
    const el = $(field.id);
    if (!el) continue;
    if (field.type === "check") {
      settings[/** @type {keyof typeof settings} */ (field.key)] = el.checked;
    } else if (field.type === "number") {
      settings[/** @type {keyof typeof settings} */ (field.key)] = Number(el.value) || 0;
    } else {
      settings[/** @type {keyof typeof settings} */ (field.key)] = el.value;
    }
  }
}

async function collectAndSave() {
  collectFromForm();
  const patch = /** @type {Partial<import("../lib/store.js").Settings>} */ ({});
  for (const field of FIELDS) {
    patch[/** @type {keyof typeof patch} */ (field.key)] =
      settings[/** @type {keyof typeof settings} */ (field.key)];
  }
  patch.updateSources = String($("updateSources")?.value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  patch.updateIntervalHours = Math.max(1, patch.updateIntervalHours ?? 24);
  patch.channelCount = Math.max(1, patch.channelCount ?? 3);

  settings = await FGStore.set(patch);
  applyTheme();
  refresh();
  markSaved();
  toast("设置已保存", "ok");
}

/* ------------------------------ 概览数据 ------------------------------ */

function renderStats() {
  if (!settings) return;
  const total = FGStore.activeNodes(settings).length;
  const best = FGStore.bestNode(settings);
  const stat = FGStore.statOf(settings, best);
  $("statTotal").textContent = `${total} 个`;
  $("statBest").textContent = best || "—";
  $("statBest").title = best ?? "";
  $("statLatency").textContent = stat?.latency
    ? (fmtLatency(stat.latency)?.text ?? stat.latency)
    : "未测速";
  $("statSync").textContent = settings.lastUpdate ? fmtTime(settings.lastUpdate) : "从未";
}

/* ------------------------------ 节点列表 ------------------------------ */

function sortNodes(list) {
  const score = (/** @type {any} */ n) => {
    const stat = FGStore.statOf(settings, n.value);
    if (!stat) return Number.MAX_SAFE_INTEGER - 1;
    const speed = Number.parseFloat(String(stat.speed ?? ""));
    if (!Number.isNaN(speed) && speed > 0) return 1000 - speed;
    const latency = Number.parseFloat(String(stat.latency ?? ""));
    if (!Number.isNaN(latency)) return 100000 + latency;
    return Number.MAX_SAFE_INTEGER - 2;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}

function renderNodes() {
  if (!settings) return;
  const keyword = String($("nodeSearch")?.value ?? "")
    .trim()
    .toLowerCase();
  const filter = String($("nodeFilter")?.value ?? "all");
  const best = FGStore.bestNode(settings);

  let list = FGStore.allNodes(settings);
  if (filter === "enabled") list = list.filter((n) => !n.disabled);
  if (filter === "disabled") list = list.filter((n) => n.disabled);
  if (filter === "custom") list = list.filter((n) => n.custom);
  if (keyword) list = list.filter((n) => n.value.toLowerCase().includes(keyword));
  list = sortNodes(list);

  $("nodeCount").textContent = String(list.length);

  $("nodeList").innerHTML =
    list
      .map((node) => {
        const stat = FGStore.statOf(settings, node.value);
        const latency = fmtLatency(stat?.latency);
        const speed = stat?.speed && stat.speed !== "-" ? stat.speed : null;
        const isBest = node.value === best;
        return `
      <div class="node-item${node.disabled ? " is-disabled" : ""}${
        isBest ? " is-best" : ""
      }" data-value="${node.value}">
        <div class="node-domain">
          ${isBest ? '<span class="fg-badge fg-badge-accent">最优</span>' : ""}
          <span class="node-domain-text" title="${node.value}">${node.value}</span>
          <span class="fg-badge">${
            node.custom
              ? "自定义"
              : (node.sources ?? []).some((s) => s && s !== "builtin")
                ? repoShortName((node.sources ?? []).find((s) => s !== "builtin"))
                : "内置"
          }</span>
        </div>
        <div class="node-metric">
          ${
            latency
              ? `<span class="fg-badge ${latency.cls}">${latency.text}</span>`
              : '<span style="color:var(--fg-muted)">—</span>'
          }
        </div>
        <div class="node-metric">
          ${
            speed
              ? `<span class="fg-badge fg-badge-good">${speed}</span>`
              : '<span style="color:var(--fg-muted)">—</span>'
          }
        </div>
        <div class="node-actions">
          <button class="fg-btn fg-btn-sm" type="button" data-act="test">测速</button>
          <button class="fg-btn fg-btn-sm" type="button" data-act="toggle">
            ${node.disabled ? "启用" : "停用"}
          </button>
          <button class="fg-btn fg-btn-sm" type="button" data-act="use">首选</button>
          ${
            node.custom
              ? '<button class="fg-btn fg-btn-sm fg-btn-danger" type="button" data-act="del">删除</button>'
              : ""
          }
        </div>
      </div>`;
      })
      .join("") || '<div class="fg-empty">没有匹配的节点</div>';
}

/* --------------------------- 路由与诊断 --------------------------- */

function renderProbes() {
  const container = $("probeList");
  if (!container || !settings) return;
  const probes = settings.probes ?? {};

  container.innerHTML = HOST_PROFILES.map((profile) => {
    const result = probes[profile.id];
    const cls = !result
      ? "fg-badge"
      : result.reachable
        ? "fg-badge fg-badge-good"
        : "fg-badge fg-badge-bad";
    const text = !result
      ? "未探测"
      : result.reachable
        ? `可达 · ${result.latency} ms`
        : "不可达";
    return `
      <div class="probe-item">
        <div class="probe-main">
          <div class="probe-name">${profile.label}</div>
          <div class="probe-desc">${profile.desc}</div>
        </div>
        <span class="${cls}">${text}</span>
      </div>`;
  }).join("");
}

async function probeHostsNow() {
  const spinner = $("probeSpinner");
  const button = /** @type {HTMLButtonElement} */ ($("btnProbe"));
  if (spinner) spinner.hidden = false;
  if (button) button.disabled = true;

  await chrome.runtime.sendMessage({ type: "probeHosts" });
  settings = await FGStore.get();
  renderProbes();

  if (spinner) spinner.hidden = true;
  if (button) button.disabled = false;
  toast("域名连通性探测完成", "ok");
}

/** 路由模式 -> 展示用的标签与配色 */
const MODE_META = {
  direct: { label: "直连", cls: "fg-badge-good" },
  jsdelivr: { label: JSDELIVR.label, cls: "fg-badge-accent" },
  proxy: { label: "公益节点", cls: "fg-badge-mid" },
};

function routeCheck() {
  const input = /** @type {HTMLInputElement} */ ($("routeTestInput"));
  const output = $("routeTestResult");
  if (!input || !output || !settings) return;

  const url = String(input.value ?? "").trim();
  if (!url) {
    output.innerHTML = '<span style="color:var(--fg-muted)">请输入一个地址</span>';
    return;
  }

  const decision = decideRoute(url, { settings, probes: settings.probes ?? {} });
  const meta = MODE_META[decision.mode] ?? MODE_META.proxy;

  const target =
    decision.mode === "jsdelivr"
      ? (toJsDelivr(url) ?? url)
      : decision.mode === "proxy"
        ? FGStore.buildProxyUrl(FGStore.bestNode(settings), url)
        : url;

  output.innerHTML = `
    <span class="fg-badge ${meta.cls}">${meta.label}</span>
    <div class="route-reason">${decision.reason}</div>
    <div class="route-target">${target}</div>`;
}

function renderHealth() {
  const container = $("healthList");
  if (!container || !settings) return;
  const capabilities = settings.capabilities ?? {};
  const nodes = FGStore.activeNodes(settings).slice(0, 12);

  container.innerHTML = nodes
    .map((node) => {
      const health = FGStore.healthOf(settings, node.value);
      const caps = capabilities[node.value];
      const healthCls =
        health.score === null
          ? "fg-badge"
          : health.score >= 90
            ? "fg-badge fg-badge-good"
            : health.score >= 60
              ? "fg-badge fg-badge-mid"
              : "fg-badge fg-badge-bad";
      const capHtml = caps
        ? `<span class="fg-badge ${caps.range ? "fg-badge-good" : ""}">Range ${
            caps.range ? "✓" : "✗"
          }</span>
           <span class="fg-badge ${caps.git ? "fg-badge-good" : ""}">Git ${
             caps.git ? "✓" : "✗"
           }</span>`
        : '<span class="fg-badge">未探测</span>';
      return `
      <div class="health-item">
        <span class="health-name">${node.value}</span>
        <span class="${healthCls}">${health.label}${
          health.score === null ? "" : ` ${health.score}%`
        }</span>
        <span class="fg-badge">${health.uses} 次</span>
        ${capHtml}
      </div>`;
    })
    .join("");
}

async function probeCapsNow() {
  if (!settings) return;
  const node = FGStore.bestNode(settings);
  const res = await chrome.runtime.sendMessage({
    type: "probeCapabilities",
    value: node,
  });
  settings = await FGStore.get();
  renderHealth();
  toast(
    `${node} · Range ${res?.result?.range ? "支持" : "不支持"} / Git ${
      res?.result?.git ? "支持" : "不支持"
    }`,
    "ok",
  );
}

/* ------------------------------ 节点仓库 ------------------------------ */

function repoShortName(source) {
  const repo = FGStore.NODE_REPOS.find((r) => r.id === source);
  if (repo) return repo.name.split("/")[1] ?? repo.name;
  return source === "builtin" ? "内置" : (source ?? "remote");
}

function renderRepos() {
  const container = $("repoList");
  if (!container || !settings) return;
  const enabled = settings.repoEnabled ?? {};
  const counts = settings.repoCounts ?? {};

  container.innerHTML = FGStore.NODE_REPOS.map(
    (repo) => `
      <div class="repo-item">
        <div class="repo-main">
          <div class="repo-name">
            <a href="${repo.url}" target="_blank">${repo.name}</a>
            <span class="fg-badge">${counts[repo.id] ?? 0} 个</span>
          </div>
          <div class="repo-desc">${repo.desc}</div>
        </div>
        <label class="fg-switch">
          <span class="fg-sr-only">启用 ${repo.name}</span>
          <input type="checkbox" data-repo="${repo.id}" ${
            enabled[repo.id] !== false ? "checked" : ""
          } />
          <span class="fg-switch-track"></span>
        </label>
      </div>`,
  ).join("");
}

function renderMergeInfo() {
  const element = $("mergeInfo");
  if (!element || !settings) return;
  const raw = [...(settings.remoteNodes ?? []), ...(settings.customNodes ?? [])];
  const stats = FGStore.mergeStats(raw);
  const total = FGStore.mergeStats(FGStore.allNodes(settings));
  element.textContent = raw.length
    ? `仓库原始 ${stats.total} 条 → 去重后 ${stats.unique} 个（合并 ${stats.merged} 个重复项）；含内置共 ${total.unique} 个可用节点`
    : "尚未同步任何仓库";
}

/** 立即去重并写回：统一域名写法、合并重复项 */
async function dedupeNow() {
  if (!settings) return;
  const raw = [...(settings.remoteNodes ?? []), ...(settings.customNodes ?? [])];
  const stats = FGStore.mergeStats(raw);

  const remoteNodes = FGStore.dedupe(settings.remoteNodes ?? []).map((node) => ({
    value: node.value,
    label: node.label ?? "remote",
    source: (node.sources ?? [])[0] ?? "remote",
  }));
  const customNodes = FGStore.dedupe(settings.customNodes ?? []).map((node) => ({
    value: node.value,
    label: "custom",
  }));

  settings = await FGStore.set({ remoteNodes, customNodes });
  refresh({ repos: true });
  toast(
    stats.merged
      ? `已合并 ${stats.merged} 个重复节点，剩余 ${stats.unique} 个`
      : "没有发现重复节点",
    stats.merged ? "ok" : "err",
  );
}

async function toggleRepo(id, checked) {
  settings = await FGStore.set({
    repoEnabled: { ...(settings.repoEnabled ?? {}), [id]: checked },
  });
  renderRepos();
  toast(`${checked ? "已启用" : "已停用"}仓库 ${id}`, "ok");
}

async function toggleNode(value) {
  const disabled = new Set(settings?.disabledNodes ?? []);
  if (disabled.has(value)) disabled.delete(value);
  else disabled.add(value);
  settings = await FGStore.set({ disabledNodes: [...disabled] });
  renderNodes();
  renderStats();
}

async function deleteNode(value) {
  settings = await FGStore.set({
    customNodes: (settings?.customNodes ?? []).filter((n) => n.value !== value),
  });
  renderNodes();
  renderStats();
  fillSelects();
  toast(`已删除 ${value}`, "ok");
}

async function useNode(value) {
  settings = await FGStore.set({ strategy: "manual", manualNode: value });
  fillForm();
  renderNodes();
  renderStats();
  toast(`已设为首选节点：${value}`, "ok");
}

async function addNode() {
  const input = /** @type {HTMLInputElement} */ ($("customNodeInput"));
  const value = String(input?.value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!value) return;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
    toast("节点格式不正确", "err");
    return;
  }
  if (FGStore.allNodes(settings).some((n) => n.value === value)) {
    toast("节点已存在", "err");
    return;
  }
  settings = await FGStore.set({
    customNodes: [...(settings?.customNodes ?? []), { value, label: "custom" }],
  });
  input.value = "";
  fillSelects();
  renderNodes();
  renderStats();
  toast(`已添加 ${value}`, "ok");
}

/* ------------------------------ 测速 ------------------------------ */

async function runPool(items, limit, worker) {
  let index = 0;
  /** @type {Promise<void>[]} */
  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    runners.push(
      (async () => {
        while (index < items.length) {
          if (cancelTest) return;
          const current = index;
          index += 1;
          await worker(items[current], current);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

/** @param {boolean} withSpeed */
async function testNodes(withSpeed) {
  if (!settings) return;
  if (testing) {
    cancelTest = true;
    toast("正在停止测速…", "err");
    return;
  }

  const list = FGStore.activeNodes(settings);
  if (!list.length) {
    toast("没有可用节点", "err");
    return;
  }

  testing = true;
  cancelTest = false;
  const progress = $("testProgress");
  const bar = progress?.querySelector("i");
  const status = $("testStatus");
  if (progress) progress.hidden = false;
  if (status) status.hidden = false;

  /** @param {number} ratio */
  const setBar = (ratio) => {
    if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
  };

  let targets = list;
  if (withSpeed && list.length > 20) {
    // 先全量测延迟，再对延迟最优的 20 个做完整测速
    await runPool(list, 8, async (node, i) => {
      const result = await FGNet.testNode(node.value, settings.speedTestUrl, {
        withSpeed: false,
      });
      await FGStore.saveStat(node.value, result.latency, null);
      setBar(((i + 1) / list.length) * 0.45);
      if (status) status.textContent = `延迟探测 ${i + 1}/${list.length} · ${node.value}`;
      renderNodes();
    });
    targets = sortNodes(FGStore.activeNodes(settings)).slice(0, 20);
    setBar(0.45);
  }

  let done = 0;
  await runPool(targets, withSpeed ? 5 : 8, async (node) => {
    const result = await FGNet.testNode(node.value, settings.speedTestUrl, { withSpeed });
    await FGStore.saveStat(node.value, result.latency, result.speed);
    done += 1;
    const base = withSpeed && list.length > 20 ? 0.45 : 0;
    const span = withSpeed && list.length > 20 ? 0.55 : 1;
    setBar(base + (done / targets.length) * span);
    if (status) {
      status.textContent = `${withSpeed ? "测速" : "延迟探测"} ${done}/${targets.length} · ${node.value}`;
    }
    if (done % 3 === 0 || done === targets.length) renderNodes();
  });

  settings = await FGStore.get();
  renderNodes();
  renderStats();
  setBar(1);
  if (status) {
    status.textContent = cancelTest
      ? "测速已中止"
      : `测速完成 · 共 ${targets.length} 个节点，最优：${FGStore.bestNode(settings)}`;
  }
  testing = false;
  setTimeout(() => {
    if (progress) progress.hidden = true;
  }, 900);
  toast(cancelTest ? "测速已中止" : "测速完成", cancelTest ? "err" : "ok");
}

async function testOne(value) {
  if (!settings) return;
  const result = await FGNet.testNode(value, settings.speedTestUrl, { withSpeed: true });
  await FGStore.saveStat(value, result.latency, result.speed);
  settings = await FGStore.get();
  renderNodes();
  renderStats();
  toast(`${value} · 延迟 ${result.latency} · 带宽 ${result.speed}`, "ok");
}

/* ---------------------------- 白名单规则 ---------------------------- */

function renderRules() {
  const list = settings?.sensitivePaths ?? [];
  $("ruleCount").textContent = String(list.length);

  const container = $("ruleList");
  if (!container) return;

  container.innerHTML =
    list
      .map(
        (rule, index) => `
      <span class="rule-chip" data-index="${index}">
        ${rule}
        <button type="button" data-index="${index}" title="删除规则">×</button>
      </span>`,
      )
      .join("") || '<div class="fg-empty" style="padding:16px">暂无规则</div>';

  const hint = $("ruleHint");
  if (hint) {
    hint.textContent = list.length
      ? "规则即时写入本地，点击「保存设置」后由后台生效"
      : "未设置任何规则时，所有 GitHub 页面都可能被自动代理";
  }
}

/** 统一的规则变更入口：写 settings → 重渲染 → 标记未保存 */
async function updateRules(next, message) {
  settings = await FGStore.set({ sensitivePaths: next });
  renderRules();
  markDirty();
  if (message) toast(message, "ok");
}

async function addRule() {
  const input = /** @type {HTMLInputElement} */ ($("ruleInput"));
  let rule = String(input?.value ?? "").trim();
  if (!rule) return;
  if (!rule.startsWith("/")) rule = `/${rule}`;
  rule = rule.replace(/\/+$/, "");

  const list = settings?.sensitivePaths ?? [];
  if (list.includes(rule)) {
    toast("规则已存在", "err");
    return;
  }
  await updateRules([...list, rule], `已添加规则 ${rule}`);
  if (input) input.value = "";
}

async function removeRule(index) {
  const list = [...(settings?.sensitivePaths ?? [])];
  list.splice(index, 1);
  await updateRules(list);
}

function resetRules() {
  updateRules([...DEFAULT_SENSITIVE_PATHS], "已恢复默认规则");
}

function clearRules() {
  updateRules([], "已清空规则");
}

function checkUrl() {
  const input = /** @type {HTMLInputElement} */ ($("testUrlInput"));
  const url = String(input?.value ?? "").trim();
  const result = $("testUrlResult");
  if (!result) return;
  if (!url) {
    result.innerHTML = '<span style="color:var(--fg-muted)">请输入一个地址</span>';
    return;
  }
  const blocked = matchSensitive(url, settings?.sensitivePaths ?? []);
  result.innerHTML = blocked
    ? '<span class="fg-badge fg-badge-good">受保护 · 不会被自动代理</span>'
    : '<span class="fg-badge fg-badge-mid">未命中 · 失败时会被自动代理</span>';
}

/* ------------------------------ 节点同步 ------------------------------ */

async function syncNow() {
  if (!settings) return;
  const spinner = $("syncSpinner");
  const button = /** @type {HTMLButtonElement} */ ($("btnSyncNow"));
  if (spinner) spinner.hidden = false;
  if (button) button.disabled = true;

  const repos = FGStore.enabledRepos(settings);
  const before = FGStore.allNodes(settings).length;
  const sync = await FGNet.syncAllRepos(settings, repos, 15000);
  const totalSources =
    repos.length + (settings.updateSources?.filter(Boolean).length ? 1 : 0);

  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of sync.results) counts[item.id] = item.count;

  if (sync.okCount) {
    settings = await FGStore.set({
      remoteNodes: sync.nodes,
      repoCounts: counts,
      lastUpdate: Date.now(),
      lastUpdateMessage: `已同步 ${sync.okCount}/${totalSources} 个源 · 去重后 ${
        FGStore.mergeStats(FGStore.allNodes({ ...settings, remoteNodes: sync.nodes }))
          .unique
      } 个节点`,
    });
    refresh({ repos: true });
    toast(
      `同步成功：${before} → ${FGStore.allNodes(settings).length} 个节点（${sync.okCount}/${totalSources} 个源）`,
      "ok",
    );
  } else {
    settings = await FGStore.set({
      repoCounts: counts,
      lastUpdateMessage: `同步失败：${String(sync.results[0]?.error ?? "").slice(0, 120)}`,
    });
    refresh({ repos: true });
    toast("节点同步失败，已尝试全部节点源", "err");
  }

  if (spinner) spinner.hidden = true;
  if (button) button.disabled = false;
}

/* ------------------------------ 事件绑定 ------------------------------ */

/** 给输入框绑定「回车执行」 */
function onEnter(id, action) {
  $(id)?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") action();
  });
}

function bind() {
  // 侧边栏导航
  $("nav")?.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest(".nav-item");
    if (!button) return;
    for (const item of document.querySelectorAll(".nav-item")) {
      item.classList.remove("is-active");
    }
    button.classList.add("is-active");
    const tab = button.getAttribute("data-tab");
    for (const panel of document.querySelectorAll(".tab-panel")) {
      panel.classList.toggle("is-active", panel.getAttribute("data-panel") === tab);
    }
  });

  for (const field of FIELDS) {
    const el = $(field.id);
    if (!el) continue;
    el.addEventListener(field.type === "check" ? "change" : "input", () => {
      collectFromForm();
      markDirty();
      if (field.id === "strategy") {
        const manual = $("manualNodeField");
        if (manual) manual.hidden = settings?.strategy !== "manual";
      }
      if (field.id === "theme") applyTheme();
    });
  }

  /** id -> 处理函数，统一绑定 click */
  const clicks = {
    btnSaveBottom: collectAndSave,
    btnSyncNow: syncNow,
    btnAddNode: addNode,
    btnTestAll: () => testNodes(true),
    btnTestLatency: () => testNodes(false),
    btnDedupe: dedupeNow,
    btnProbe: probeHostsNow,
    btnRouteTest: routeCheck,
    btnProbeCaps: probeCapsNow,
    btnAddRule: addRule,
    btnResetRules: resetRules,
    btnClearRules: clearRules,
    btnTestUrl: checkUrl,
  };
  for (const [id, action] of Object.entries(clicks)) {
    $(id)?.addEventListener("click", action);
  }

  onEnter("customNodeInput", addNode);
  onEnter("routeTestInput", routeCheck);
  onEnter("ruleInput", addRule);
  onEnter("testUrlInput", checkUrl);

  $("updateSources")?.addEventListener("input", markDirty);
  $("nodeSearch")?.addEventListener("input", renderNodes);
  $("nodeFilter")?.addEventListener("change", renderNodes);

  $("nodeList")?.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest("button[data-act]");
    if (!button) return;
    const value = button.closest(".node-item")?.getAttribute("data-value") ?? "";
    switch (button.getAttribute("data-act")) {
      case "toggle":
        toggleNode(value);
        break;
      case "del":
        deleteNode(value);
        break;
      case "use":
        useNode(value);
        break;
      case "test":
        testOne(value);
        break;
      default:
        break;
    }
  });

  $("repoList")?.addEventListener("change", (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    const id = input.getAttribute("data-repo");
    if (id) toggleRepo(id, input.checked);
  });

  $("ruleList")?.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest(
      "button[data-index]",
    );
    if (!button) return;
    removeRule(Number(button.getAttribute("data-index")));
  });

  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

async function boot() {
  settings = await FGStore.get();
  applyTheme();
  bind();
  refresh({ repos: true });
  renderProbes();
  renderHealth();
  markSaved();
}

boot();
