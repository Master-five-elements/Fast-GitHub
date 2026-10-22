/* ------------------------------------------------------------------
 * 设置页逻辑：节点管理 / 测速 / 自动更新 / 通用设置
 * ------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);

  let settings = null;
  let dirty = false;
  let testing = false;
  let cancelTest = false;

  /* ------------------------------ 工具 ------------------------------ */

  function toast(message, kind) {
    const wrap = $("toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "fg-toast" + (kind ? " is-" + kind : "");
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
    const st = $("saveState");
    if (st) {
      st.textContent = "有未保存的修改";
      st.style.color = "var(--fg-amber)";
    }
  }

  function markSaved() {
    dirty = false;
    const st = $("saveState");
    if (st) {
      st.textContent = "已保存 · " + new Date().toLocaleTimeString();
      st.style.color = "var(--fg-muted)";
    }
  }

  function fmtTime(ts) {
    if (!ts) return "从未";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes())
    );
  }

  function fmtLatency(value) {
    if (!value || value === "-") return null;
    if (value === "timeout") return { text: "超时", cls: "fg-badge-bad" };
    const n = parseInt(value, 10);
    if (isNaN(n)) return null;
    const text = n >= 1000 ? (n / 1000).toFixed(2) + " s" : n + " ms";
    const cls = n < 400 ? "fg-badge-good" : n < 1000 ? "fg-badge-mid" : "fg-badge-bad";
    return { text: text, cls: cls };
  }

  function applyTheme() {
    const mode = (settings && settings.theme) || "system";
    const dark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }

  /* ------------------------------ 表单 ------------------------------ */

  const FIELDS = [
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
    { id: "token", key: "token", type: "value" },
    { id: "language", key: "language", type: "value" },
    { id: "theme", key: "theme", type: "value" },
  ];

  function fillForm() {
    FIELDS.forEach((f) => {
      const el = $(f.id);
      if (!el) return;
      const value = settings[f.key];
      if (f.type === "check") el.checked = !!value;
      else el.value = value === undefined || value === null ? "" : value;
    });
    $("updateSources").value = (settings.updateSources || []).join("\n");
    $("syncMessage").textContent =
      settings.lastUpdateMessage || (settings.lastUpdate ? "上次同步：" + fmtTime(settings.lastUpdate) : "尚未同步");
    toggleManualField();
  }

  function toggleManualField() {
    $("manualNodeField").hidden = settings.strategy !== "manual";
  }

  function fillSelects() {
    const nodes = FGStore.allNodes(settings);
    const options = nodes
      .map((n) => '<option value="' + n.value + '">' + n.value + "</option>")
      .join("");

    ["manualNode", "fallbackNode"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      const current = $(id) === $("manualNode") ? settings.manualNode : settings.fallbackNode;
      el.innerHTML = options;
      el.value = current || "";
    });
  }

  async function collectAndSave() {
    const patch = {};
    FIELDS.forEach((f) => {
      const el = $(f.id);
      if (!el) return;
      if (f.type === "check") patch[f.key] = el.checked;
      else if (f.type === "number") patch[f.key] = Number(el.value) || 0;
      else patch[f.key] = el.value;
    });

    patch.updateSources = String($("updateSources").value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (patch.updateIntervalHours < 1) patch.updateIntervalHours = 1;
    if (patch.channelCount < 1) patch.channelCount = 1;

    settings = await FGStore.set(patch);
    applyTheme();
    fillSelects();
    renderNodes();
    renderStats();
    markSaved();
    toast("设置已保存", "ok");
  }

  /* ------------------------------ 概览 ------------------------------ */

  function renderStats() {
    const nodes = FGStore.activeNodes(settings);
    const best = FGStore.bestNode(settings);
    const stat = FGStore.statOf(settings, best);

    $("statTotal").textContent = nodes.length + " 个";
    $("statBest").textContent = best || "—";
    $("statBest").title = best || "";
    $("statLatency").textContent =
      stat && stat.latency ? (fmtLatency(stat.latency) || {}).text || stat.latency : "未测速";
    $("statSync").textContent = settings.lastUpdate ? fmtTime(settings.lastUpdate) : "从未";
  }

  /* ---------------------------- 节点列表 ---------------------------- */

  function sortNodes(list) {
    const score = (n) => {
      const st = FGStore.statOf(settings, n.value);
      if (!st) return Number.MAX_SAFE_INTEGER - 1;
      const speed = parseFloat(String(st.speed || ""));
      if (!isNaN(speed) && speed > 0) return 1000 - speed;
      const latency = parseFloat(String(st.latency || ""));
      if (!isNaN(latency)) return 100000 + latency;
      return Number.MAX_SAFE_INTEGER - 2;
    };
    return list.slice().sort((a, b) => score(a) - score(b));
  }

  function renderNodes() {
    const keyword = String($("nodeSearch").value || "").trim().toLowerCase();
    const filter = $("nodeFilter").value;
    const best = FGStore.bestNode(settings);

    let list = FGStore.allNodes(settings);
    if (filter === "enabled") list = list.filter((n) => !n.disabled);
    if (filter === "disabled") list = list.filter((n) => n.disabled);
    if (filter === "custom") list = list.filter((n) => n.custom);
    if (keyword) list = list.filter((n) => n.value.toLowerCase().indexOf(keyword) > -1);

    list = sortNodes(list);
    $("nodeCount").textContent = list.length;

    const html = list
      .map((n) => {
        const st = FGStore.statOf(settings, n.value);
        const lat = fmtLatency(st && st.latency);
        const speed = st && st.speed && st.speed !== "-" ? st.speed : null;
        const isBest = n.value === best;

        return (
          '<div class="node-item' +
          (n.disabled ? " is-disabled" : "") +
          (isBest ? " is-best" : "") +
          '" data-value="' + n.value + '">' +
          '<div class="node-domain">' +
          (isBest ? '<span class="fg-badge fg-badge-accent">最优</span>' : "") +
          '<span class="node-domain-text" title="' + n.value + '">' + n.value + "</span>" +
          '<span class="fg-badge">' + (n.custom ? "自定义" : n.label || "node") + "</span>" +
          "</div>" +
          '<div class="node-metric">' +
          (lat ? '<span class="fg-badge ' + lat.cls + '">' + lat.text + "</span>" : '<span style="color:var(--fg-muted)">—</span>') +
          "</div>" +
          '<div class="node-metric">' +
          (speed ? '<span class="fg-badge fg-badge-good">' + speed + "</span>" : '<span style="color:var(--fg-muted)">—</span>') +
          "</div>" +
          '<div class="node-actions">' +
          '<button class="fg-btn fg-btn-sm" data-act="test">测速</button>' +
          '<button class="fg-btn fg-btn-sm" data-act="toggle">' + (n.disabled ? "启用" : "停用") + "</button>" +
          '<button class="fg-btn fg-btn-sm" data-act="use">首选</button>' +
          (n.custom ? '<button class="fg-btn fg-btn-sm fg-btn-danger" data-act="del">删除</button>' : "") +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    $("nodeList").innerHTML = html || '<div class="fg-empty">没有匹配的节点</div>';
  }

  async function toggleNode(value) {
    const disabled = new Set(settings.disabledNodes || []);
    if (disabled.has(value)) disabled.delete(value);
    else disabled.add(value);
    settings = await FGStore.set({ disabledNodes: Array.from(disabled) });
    renderNodes();
    renderStats();
  }

  async function deleteNode(value) {
    settings = await FGStore.set({
      customNodes: (settings.customNodes || []).filter((n) => n.value !== value),
    });
    renderNodes();
    renderStats();
    fillSelects();
    toast("已删除 " + value, "ok");
  }

  async function useNode(value) {
    settings = await FGStore.set({ strategy: "manual", manualNode: value });
    fillForm();
    renderNodes();
    renderStats();
    toast("已设为首选节点：" + value, "ok");
  }

  async function addNode() {
    const input = $("customNodeInput");
    let value = String(input.value || "").trim();
    if (!value) return;
    value = value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
      toast("节点格式不正确", "err");
      return;
    }
    const exists = FGStore.allNodes(settings).some((n) => n.value === value);
    if (exists) {
      toast("节点已存在", "err");
      return;
    }
    settings = await FGStore.set({
      customNodes: (settings.customNodes || []).concat([{ value: value }]),
    });
    input.value = "";
    fillSelects();
    renderNodes();
    renderStats();
    toast("已添加 " + value, "ok");
  }

  /* ------------------------------ 测速 ------------------------------ */

  async function runPool(items, limit, worker) {
    let index = 0;
    const runners = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      runners.push(
        (async () => {
          while (index < items.length) {
            if (cancelTest) return;
            const current = index++;
            await worker(items[current], current);
          }
        })()
      );
    }
    await Promise.all(runners);
  }

  async function testNodes(withSpeed) {
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
    const bar = progress.querySelector("i");
    const status = $("testStatus");
    progress.hidden = false;
    status.hidden = false;

    // 带宽测速较耗时，只对延迟最优的前 20 个做完整测速
    let targets = list;
    if (withSpeed && list.length > 20) {
      targets = list.slice(0, 0); // 先全量测延迟
      await runPool(list, 8, async (node, i) => {
        const r = await FGNet.testNode(node.value, settings.speedTestUrl, { withSpeed: false });
        await FGStore.saveStat(node.value, r.latency, null);
        bar.style.width = Math.round(((i + 1) / list.length) * 45) + "%";
        status.textContent = "延迟探测 " + (i + 1) + "/" + list.length + " · " + node.value;
        renderNodes();
      });
      const sorted = sortNodes(FGStore.activeNodes(settings));
      targets = sorted.slice(0, 20);
      bar.style.width = "45%";
    }

    let done = 0;
    await runPool(targets, withSpeed ? 5 : 8, async (node) => {
      const r = await FGNet.testNode(node.value, settings.speedTestUrl, { withSpeed: withSpeed });
      await FGStore.saveStat(node.value, r.latency, r.speed);
      done++;
      const base = withSpeed && list.length > 20 ? 45 : 0;
      const span = withSpeed && list.length > 20 ? 55 : 100;
      bar.style.width = base + Math.round((done / targets.length) * span) + "%";
      status.textContent = (withSpeed ? "测速 " : "延迟探测 ") + done + "/" + targets.length + " · " + node.value;
      if (done % 3 === 0 || done === targets.length) renderNodes();
    });

    settings = await FGStore.get();
    renderNodes();
    renderStats();
    bar.style.width = "100%";
    status.textContent = cancelTest
      ? "测速已中止"
      : "测速完成 · 共 " + targets.length + " 个节点，最优：" + FGStore.bestNode(settings);

    testing = false;
    setTimeout(() => {
      progress.hidden = true;
    }, 900);
    toast(cancelTest ? "测速已中止" : "测速完成", cancelTest ? "err" : "ok");
  }

  async function testOne(value) {
    const btn = document.querySelector('.node-item[data-value="' + value + '"] [data-act="test"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "…";
    }
    const r = await FGNet.testNode(value, settings.speedTestUrl, { withSpeed: true });
    await FGStore.saveStat(value, r.latency, r.speed);
    settings = await FGStore.get();
    renderNodes();
    renderStats();
    toast(value + " · 延迟 " + r.latency + " · 带宽 " + r.speed, "ok");
  }

  /* ---------------------------- 节点同步 ---------------------------- */

  async function syncNow() {
    const spinner = $("syncSpinner");
    const btn = $("btnSyncNow");
    spinner.hidden = false;
    btn.disabled = true;

    const result = await FGNet.fetchRemoteNodes(settings.updateSources, 15000);
    if (result.ok) {
      const nodes = FGStore.dedupe(result.nodes.map((n) => ({ value: n.value, label: n.label })));
      const before = FGStore.allNodes(settings).length;
      settings = await FGStore.set({
        remoteNodes: nodes,
        lastUpdate: Date.now(),
        lastUpdateMessage: "已同步 " + nodes.length + " 个节点 · " + (result.source || ""),
      });
      fillForm();
      fillSelects();
      renderNodes();
      renderStats();
      toast("同步成功：" + before + " → " + FGStore.allNodes(settings).length + " 个节点", "ok");
    } else {
      settings = await FGStore.set({ lastUpdateMessage: "同步失败：" + result.error.slice(0, 120) });
      fillForm();
      toast("节点同步失败，已尝试全部镜像源", "err");
    }

    spinner.hidden = true;
    btn.disabled = false;
  }

  /* ------------------------------ 事件 ------------------------------ */

  function bind() {
    // 侧边栏切换
    $("nav").addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-item");
      if (!btn) return;
      document.querySelectorAll(".nav-item").forEach((i) => i.classList.remove("is-active"));
      btn.classList.add("is-active");
      const tab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.classList.toggle("is-active", p.getAttribute("data-panel") === tab);
      });
    });

    FIELDS.forEach((f) => {
      const el = $(f.id);
      if (!el) return;
      el.addEventListener(f.type === "check" ? "change" : "input", () => {
        collectFromForm();
        markDirty();
        if (f.id === "strategy") toggleManualField();
        if (f.id === "theme") applyTheme();
      });
    });

    $("updateSources").addEventListener("input", () => markDirty());

    function collectFromForm() {
      FIELDS.forEach((f) => {
        const el = $(f.id);
        if (!el) return;
        if (f.type === "check") settings[f.key] = el.checked;
        else if (f.type === "number") settings[f.key] = Number(el.value) || 0;
        else settings[f.key] = el.value;
      });
    }

    $("btnSaveBottom").addEventListener("click", collectAndSave);
    $("btnSyncNow").addEventListener("click", syncNow);
    $("btnAddNode").addEventListener("click", addNode);
    $("customNodeInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addNode();
    });
    $("btnTestAll").addEventListener("click", () => testNodes(true));
    $("btnTestLatency").addEventListener("click", () => testNodes(false));
    $("nodeSearch").addEventListener("input", renderNodes);
    $("nodeFilter").addEventListener("change", renderNodes);

    $("nodeList").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const value = btn.closest(".node-item").getAttribute("data-value");
      const act = btn.getAttribute("data-act");
      if (act === "toggle") toggleNode(value);
      else if (act === "del") deleteNode(value);
      else if (act === "use") useNode(value);
      else if (act === "test") testOne(value);
    });

    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ------------------------------ 启动 ------------------------------ */

  async function boot() {
    settings = await FGStore.get();
    applyTheme();
    bind();
    fillForm();
    fillSelects();
    renderNodes();
    renderStats();
    markSaved();
  }

  boot();
})();
