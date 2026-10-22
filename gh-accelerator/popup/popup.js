/* ------------------------------------------------------------------
 * 弹窗：查看/切换当前节点、测速、一键代理当前页
 * ------------------------------------------------------------------ */

(function () {
  const $ = (id) => document.getElementById(id);

  let settings = null;
  let currentTab = null;

  function toast(message, kind) {
    const wrap = $("toastWrap");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "fg-toast" + (kind ? " is-" + kind : "");
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 2400);
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

  function fmtLatency(value) {
    if (!value || value === "-") return "未测速";
    if (value === "timeout") return "超时";
    const n = parseInt(value, 10);
    if (isNaN(n)) return value;
    return n >= 1000 ? (n / 1000).toFixed(2) + " s" : n + " ms";
  }

  function render() {
    applyTheme();
    $("enabled").checked = !!settings.enabled;

    const best = FGStore.bestNode(settings);
    const stat = FGStore.statOf(settings, best);

    $("nodeValue").textContent = best || "—";
    $("nodeValue").title = best || "";
    $("strategyTag").textContent = settings.strategy === "manual" ? "手动" : "自动";
    $("nodeLatency").textContent = stat ? fmtLatency(stat.latency) : "未测速";
    $("nodeSpeed").textContent =
      stat && stat.speed && stat.speed !== "-" ? stat.speed : "未测速";
    $("syncInfo").textContent = settings.lastUpdate
      ? "最近同步：" + new Date(settings.lastUpdate).toLocaleString()
      : "尚未同步节点";

    const url = (currentTab && currentTab.url) || "";
    $("currentUrl").textContent = url || "无可用页面";
  }

  async function testCurrent() {
    const node = FGStore.bestNode(settings);
    $("btnTest").disabled = true;
    $("btnTest").textContent = "测速中";
    const r = await FGNet.testNode(node, settings.speedTestUrl, { withSpeed: true });
    await FGStore.saveStat(node, r.latency, r.speed);
    settings = await FGStore.get();
    $("btnTest").disabled = false;
    $("btnTest").textContent = "测速";
    render();
    toast("延迟 " + r.latency + " · 带宽 " + r.speed, "ok");
  }

  async function nextNode() {
    const list = FGStore.activeNodes(settings)
      .map((n) => Object.assign({}, n, { stat: FGStore.statOf(settings, n.value) }))
      .sort((a, b) => {
        const sa = a.stat ? parseFloat(String(a.stat.speed || "")) || 0 : 0;
        const sb = b.stat ? parseFloat(String(b.stat.speed || "")) || 0 : 0;
        if (sa !== sb) return sb - sa;
        const la = a.stat ? parseFloat(String(a.stat.latency || "")) || 9999 : 9999;
        const lb = b.stat ? parseFloat(String(b.stat.latency || "")) || 9999 : 9999;
        return la - lb;
      });

    if (!list.length) return;
    const current = FGStore.bestNode(settings);
    const idx = list.findIndex((n) => n.value === current);
    const next = list[(idx + 1) % list.length];
    settings = await FGStore.set({ strategy: "manual", manualNode: next.value });
    render();
    toast("已切换到 " + next.value, "ok");
  }

  async function syncNodes() {
    $("btnSync").disabled = true;
    $("btnSync").textContent = "同步中";
    const res = await chrome.runtime.sendMessage({ type: "syncNodes" });
    settings = await FGStore.get();
    $("btnSync").disabled = false;
    $("btnSync").textContent = "同步节点";
    render();
    toast(res && res.ok ? "节点同步成功" : "同步失败，稍后重试", res && res.ok ? "ok" : "err");
  }

  async function proxyCurrent() {
    const url = currentTab && currentTab.url;
    if (!url) return toast("没有可代理的页面", "err");
    const res = await chrome.runtime.sendMessage({ type: "proxyTab" });
    if (!res || !res.ok) {
      return toast((res && res.error) || "代理失败", "err");
    }
    window.close();
  }

  async function copyProxyLink() {
    const url = currentTab && currentTab.url;
    if (!url) return toast("没有可复制的页面", "err");

    const guard = await chrome.runtime.sendMessage({ type: "checkSensitive", url: url });
    if (guard && guard.blocked) {
      return toast("登录/私有页面已禁止走代理，凭证安全第一", "err");
    }

    const node = FGStore.bestNode(settings);
    const target = FGStore.buildProxyUrl(node, url);
    try {
      await navigator.clipboard.writeText(target);
      toast("已复制加速链接", "ok");
    } catch (e) {
      toast("复制失败：" + target, "err");
    }
  }

  function bind() {
    $("enabled").addEventListener("change", async (e) => {
      settings = await FGStore.set({ enabled: e.target.checked });
      toast(e.target.checked ? "已启用" : "已停用", "ok");
    });
    $("btnTest").addEventListener("click", testCurrent);
    $("btnNext").addEventListener("click", nextNode);
    $("btnSync").addEventListener("click", syncNodes);
    $("btnProxy").addEventListener("click", proxyCurrent);
    $("btnCopy").addEventListener("click", copyProxyLink);
    $("btnOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
  }

  async function boot() {
    settings = await FGStore.get();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab || null;
    bind();
    render();
  }

  boot();
})();
