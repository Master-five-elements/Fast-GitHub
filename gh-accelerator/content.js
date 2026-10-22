/**
 * GitHub 页面注入脚本（ES Module）
 * 加速通道 / 下载 ZIP / 单文件下载 / Release 加速 / Web IDE / Issue 翻译
 */

/**
 * 动态载入共享模块。
 * content script 在部分浏览器上并不以 ES Module 方式执行，
 * 这里用动态 import + chrome.runtime.getURL，保证各版本 Chromium 都能运行。
 */
let store = null;

async function ensureStore() {
  if (!store) {
    const mod = await import(chrome.runtime.getURL("lib/store.js"));
    store = mod.FGStore;
  }
  return store;
}

const SPEED_ID = "fg-speed-btn";
const ROW_FLAG = "fg-row-done";

/** @type {import("./lib/store.js").Settings | null} */
let settings = null;
let busy = false;

/** 当前最优节点对应的代理地址 */
function nodeUrl(target) {
  return store.buildProxyUrl(store.bestNode(settings), target);
}

/**
 * @param {string} text
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 页面内轻提示 */
function flash(message) {
  let el = document.getElementById("fg-flash");
  if (!el) {
    el = document.createElement("div");
    el.id = "fg-flash";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("is-show"), 1800);
}

/**
 * 经节点下载文件，失败时退化为新窗口打开
 * @param {string} rawUrl
 * @param {string} fileName
 */
async function downloadViaNode(rawUrl, fileName) {
  const url = nodeUrl(rawUrl);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(anchor.href);
      anchor.remove();
    }, 2000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

/** 当前仓库的 clone 地址（经节点） */
function cloneUrl(node) {
  const origin = window.location.origin;
  const parts = window.location.pathname.split("/").filter(Boolean);
  const repo = `${origin}/${parts[0]}/${parts[1]}.git`;
  return store.buildProxyUrl(node, repo);
}

/** 查找压缩包下载地址 */
function zipHref() {
  const links = [...document.querySelectorAll("a")];
  const zip = links.find((a) =>
    /\/archive\/.+\.(zip|tar\.gz)$/.test(a.getAttribute("href") ?? ""),
  );
  if (zip) return zip.getAttribute("href");
  const menu = links.find((a) => (a.textContent ?? "").includes("Download ZIP"));
  return menu?.getAttribute("href") ?? null;
}

/** 仓库首页 / 目录页的「加速」下拉 */
function renderSpeedButton() {
  if (document.getElementById(SPEED_ID)) return;

  const anchor =
    document.querySelector(".file-navigation") ??
    document.querySelector('[data-testid="file-nav"]') ??
    document.querySelector("div.Box div.d-flex");
  if (!anchor) return;

  const list = store.channels(settings, settings.channelCount);
  const best = store.bestNode(settings);
  const total = store.activeNodes(settings).length;

  const wrap = document.createElement("div");
  wrap.id = SPEED_ID;
  wrap.className = "fg-speed";

  const items = list
    .map((node) => {
      const url = cloneUrl(node);
      const stat = store.statOf(settings, node);
      const latency =
        stat?.latency && stat.latency !== "timeout" ? `${stat.latency} ms` : "";
      return `
        <div class="fg-chan">
          <div class="fg-chan-head">
            <span class="fg-chan-name">${node}</span>
            ${node === best ? '<span class="fg-chan-tag">当前</span>' : ""}
            ${latency ? `<span class="fg-chan-lat">${latency}</span>` : ""}
          </div>
          <div class="fg-chan-row">
            <input class="fg-chan-input" type="text" readonly value="${url}" />
            <button class="fg-mini" type="button" data-copy="${url}">复制</button>
          </div>
        </div>`;
    })
    .join("");

  wrap.innerHTML = `
    <button class="fg-trigger" type="button">
      <span class="fg-bolt">⚡</span>加速<span class="fg-caret">▾</span>
    </button>
    <div class="fg-panel">
      <div class="fg-panel-title">
        可用通道<span class="fg-panel-sub">共 ${total} 个节点</span>
      </div>
      ${items}
      <div class="fg-panel-actions">
        <button class="fg-mini fg-mini-primary" type="button" id="fg-zip">下载 ZIP</button>
        <button class="fg-mini" type="button" id="fg-zip-copy">复制 ZIP 链接</button>
      </div>
    </div>`;

  anchor.appendChild(wrap);

  const trigger = wrap.querySelector(".fg-trigger");
  const panel = wrap.querySelector(".fg-panel");
  trigger?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    panel?.classList.toggle("is-open");
  });
  document.addEventListener("click", (event) => {
    if (!wrap.contains(/** @type {Node} */ (event.target))) {
      panel?.classList.remove("is-open");
    }
  });

  wrap.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const copyBtn = target.closest("[data-copy]");
    if (copyBtn) {
      const ok = await copyText(copyBtn.getAttribute("data-copy") ?? "");
      flash(ok ? "已复制加速链接" : "复制失败，请手动复制");
      return;
    }
    if (target.closest("#fg-zip") || target.closest("#fg-zip-copy")) {
      const href = zipHref();
      if (!href) {
        flash("未找到下载地址");
        return;
      }
      const proxyUrl = nodeUrl(window.location.origin + href);
      if (target.closest("#fg-zip")) {
        window.location.href = proxyUrl;
      } else {
        const ok = await copyText(proxyUrl);
        flash(ok ? "已复制 ZIP 加速链接" : "复制失败");
      }
    }
  });
}

/** 文件树：Web IDE 入口 + 单文件下载 */
function addIdeAndDownload() {
  const rows = document.querySelectorAll('div[role="row"], div.js-navigation-item');
  if (!rows.length) return;

  const webIDE = settings.webIDE;
  const ideHost =
    webIDE === "GitHub.Dev"
      ? "github.dev"
      : webIDE === "GitHub1s.Com"
        ? "github1s.com"
        : "";

  for (const row of rows) {
    if (row.classList.contains(ROW_FLAG)) continue;
    row.classList.add(ROW_FLAG);

    const link = row.querySelector('a[href*="/blob/"]');
    const href = link?.getAttribute("href");
    if (!href) continue;

    const holder = row.querySelector('div[role="gridcell"]:last-child') ?? row;

    if (ideHost && !row.querySelector(".fg-ide")) {
      const ide = document.createElement("a");
      ide.className = "fg-ide";
      ide.href = `https://${ideHost}${href}`;
      ide.target = "_blank";
      ide.rel = "noopener";
      ide.title = "使用 Web IDE 查看";
      ide.textContent = "IDE";
      holder.appendChild(ide);
    }

    if (row.querySelector(".fg-dl")) continue;
    const download = document.createElement("button");
    download.className = "fg-dl";
    download.type = "button";
    download.title = "经加速节点下载该文件";
    download.textContent = "下载";
    download.addEventListener("click", async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      download.textContent = "…";
      const rawUrl = `https://raw.githubusercontent.com${href.replace("/blob/", "/")}`;
      const name = href.split("/").pop() || "file";
      await downloadViaNode(rawUrl, name);
      download.textContent = "下载";
      busy = false;
    });
    holder.appendChild(download);
  }
}

/** Releases / Tags：追加「加速下载」 */
function addReleaseAccel() {
  const selectors = [
    'a[href*="/releases/download/"]',
    'a[href$=".zip"]',
    'a[href$=".tar.gz"]',
    'a[href$=".tgz"]',
  ];
  for (const selector of selectors) {
    for (const anchor of document.querySelectorAll(selector)) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      if (anchor.parentElement?.querySelector(".fg-accel")) continue;
      const tag = document.createElement("a");
      tag.className = "fg-accel";
      tag.href = nodeUrl(window.location.origin + href);
      tag.rel = "nofollow noopener";
      tag.target = "_blank";
      tag.textContent = "加速下载";
      anchor.parentElement?.appendChild(tag);
    }
  }
}

/** Issue / PR：一键翻译 */
function addTranslate() {
  if (!settings.token || settings.language === "nothing") return;
  const blocks = document.querySelectorAll("td.d-block.comment-body, .comment-body");
  for (const block of blocks) {
    if (block.querySelector(".fg-trans")) continue;
    const button = document.createElement("button");
    button.className = "fg-trans";
    button.type = "button";
    button.textContent = "翻译";
    button.addEventListener("click", async () => {
      const existing = block.parentElement?.querySelector(".fg-trans-out");
      if (existing) {
        existing.remove();
        button.textContent = "翻译";
        return;
      }
      button.textContent = "翻译中…";
      const text = (block.textContent ?? "").slice(0, 1500);
      const res = await chrome.runtime.sendMessage({ content: text });
      button.textContent = "收起译文";
      const out = document.createElement("div");
      out.className = "fg-trans-out";
      out.textContent = res?.content || "翻译失败";
      block.parentElement?.appendChild(out);
    });
    block.appendChild(button);
  }
}

async function main() {
  await ensureStore();
  settings = await store.get();
  if (!settings?.enabled) return;

  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return;

  const isPrivate = [...document.querySelectorAll("span.Label--secondary")].some(
    (span) => (span.textContent ?? "").trim() === "Private",
  );
  if (isPrivate) {
    // 私有仓库：不注入按钮，并上报后台加入永不代理名单
    await chrome.runtime.sendMessage({
      type: "markPrivate",
      url: window.location.href,
    });
    return;
  }

  const pageType = parts[2];
  if (!pageType || pageType === "tree") {
    renderSpeedButton();
    addIdeAndDownload();
  }
  if (pageType === "releases" || pageType === "tags") {
    addReleaseAccel();
    renderSpeedButton();
  }
  if (pageType === "issues" || pageType === "pull") {
    addTranslate();
  }
}

let timer = 0;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    main().catch((error) => console.debug("[FastGitHub]", error));
  }, 350);
});

observer.observe(document.documentElement ?? document.body, {
  childList: true,
  subtree: true,
});

main().catch((error) => console.debug("[FastGitHub]", error));
