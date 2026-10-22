/* ------------------------------------------------------------------
 * GitHub 页面注入：加速通道 / 下载 ZIP / 文件下载 / Release 加速 / Web IDE
 * ------------------------------------------------------------------ */

(function () {
  const SPEED_ID = "fg-speed-btn";
  const IDE_FLAG = "fg-ide-done";
  const ROW_FLAG = "fg-row-done";

  let settings = null;
  let busy = false;

  /* ------------------------------ 工具 ------------------------------ */

  function nodeUrl(target) {
    return FGStore.buildProxyUrl(FGStore.bestNode(settings), target);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

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

  async function downloadViaNode(rawUrl, fileName) {
    const url = nodeUrl(rawUrl);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 2000);
      return true;
    } catch (e) {
      window.open(url, "_blank", "noopener");
      return false;
    }
  }

  /* --------------------------- 首页 / 目录页 --------------------------- */

  function cloneUrl(node) {
    const origin = window.location.origin;
    const parts = window.location.pathname.split("/").filter(Boolean);
    const repo = origin + "/" + parts[0] + "/" + parts[1] + ".git";
    return FGStore.buildProxyUrl(node, repo);
  }

  function renderSpeedButton() {
    if (document.getElementById(SPEED_ID)) return;

    const anchor =
      document.querySelector(".file-navigation") ||
      document.querySelector('[data-testid="file-nav"]') ||
      document.querySelector("div.Box div.d-flex");
    if (!anchor) return;

    const list = FGStore.channels(settings, settings.channelCount);
    const best = FGStore.bestNode(settings);

    const wrap = document.createElement("div");
    wrap.id = SPEED_ID;
    wrap.className = "fg-speed";

    const items = list
      .map((node) => {
        const url = cloneUrl(node);
        const stat = FGStore.statOf(settings, node);
        const lat = stat && stat.latency && stat.latency !== "timeout" ? stat.latency + " ms" : "";
        return (
          '<div class="fg-chan">' +
          '<div class="fg-chan-head">' +
          '<span class="fg-chan-name">' + node + "</span>" +
          (node === best ? '<span class="fg-chan-tag">当前</span>' : "") +
          (lat ? '<span class="fg-chan-lat">' + lat + "</span>" : "") +
          "</div>" +
          '<div class="fg-chan-row">' +
          '<input class="fg-chan-input" type="text" readonly value="' + url + '" />' +
          '<button class="fg-mini" data-copy="' + url + '">复制</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    wrap.innerHTML =
      '<button class="fg-trigger" type="button">' +
      '<span class="fg-bolt">⚡</span>加速<span class="fg-caret">▾</span>' +
      "</button>" +
      '<div class="fg-panel">' +
      '<div class="fg-panel-title">可用通道<span class="fg-panel-sub">共 ' +
      FGStore.activeNodes(settings).length +
      " 个节点</span></div>" +
      items +
      '<div class="fg-panel-actions">' +
      '<button class="fg-mini fg-mini-primary" id="fg-zip">下载 ZIP</button>' +
      '<button class="fg-mini" id="fg-use-zip-copy">复制 ZIP 加速链接</button>' +
      "</div>" +
      "</div>";

    anchor.appendChild(wrap);

    const trigger = wrap.querySelector(".fg-trigger");
    const panel = wrap.querySelector(".fg-panel");
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.classList.toggle("is-open");
    });
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) panel.classList.remove("is-open");
    });

    wrap.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-copy]");
      if (btn) {
        const ok = await copyText(btn.getAttribute("data-copy"));
        flash(ok ? "已复制加速链接" : "复制失败，请手动复制");
        return;
      }
      if (e.target.closest("#fg-zip")) {
        const href = zipHref();
        if (!href) return flash("未找到下载地址");
        window.location.href = nodeUrl(window.location.origin + href);
      }
      if (e.target.closest("#fg-use-zip-copy")) {
        const href = zipHref();
        if (!href) return flash("未找到下载地址");
        const ok = await copyText(nodeUrl(window.location.origin + href));
        flash(ok ? "已复制 ZIP 加速链接" : "复制失败");
      }
    });
  }

  function zipHref() {
    const links = Array.from(document.querySelectorAll("a"));
    const zip = links.find((a) => /\/archive\/.+\.(zip|tar\.gz)$/.test(a.getAttribute("href") || ""));
    if (zip) return zip.getAttribute("href");
    const menu = links.find((a) => (a.textContent || "").includes("Download ZIP"));
    return menu ? menu.getAttribute("href") : null;
  }

  /* ------------------------------ 文件树 ------------------------------ */

  function addIdeAndDownload() {
    const rows = document.querySelectorAll(
      'div[role="row"], div.js-navigation-item'
    );
    if (!rows.length) return;

    const webIDE = settings.webIDE;
    const ideHost =
      webIDE === "GitHub.Dev"
        ? "github.dev"
        : webIDE === "GitHub1s.Com"
        ? "github1s.com"
        : "";

    rows.forEach((row) => {
      if (row.classList.contains(ROW_FLAG)) return;
      row.classList.add(ROW_FLAG);

      const link = row.querySelector('a[href*="/blob/"]');
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href) return;

      const holder = row.querySelector('div[role="gridcell"]:last-child') || row;

      if (ideHost && !row.querySelector(".fg-ide")) {
        const a = document.createElement("a");
        a.className = "fg-ide";
        a.href = "https://" + ideHost + href;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = "使用 Web IDE 查看";
        a.textContent = "IDE";
        holder.appendChild(a);
      }

      if (row.querySelector(".fg-dl")) return;
      const dl = document.createElement("button");
      dl.className = "fg-dl";
      dl.type = "button";
      dl.title = "经加速节点下载该文件";
      dl.textContent = "下载";
      dl.addEventListener("click", async (e) => {
        e.preventDefault();
        if (busy) return;
        busy = true;
        dl.textContent = "…";
        const rawUrl =
          "https://raw.githubusercontent.com" + href.replace("/blob/", "/");
        const name = href.split("/").pop() || "file";
        await downloadViaNode(rawUrl, name);
        dl.textContent = "下载";
        busy = false;
      });
      holder.appendChild(dl);
    });
  }

  /* --------------------------- Releases / Tags --------------------------- */

  function addReleaseAccel() {
    const links = document.querySelectorAll('a[href*="/releases/download/"]');
    links.forEach((a) => {
      if (a.parentNode && a.parentNode.querySelector(".fg-accel")) return;
      const href = a.getAttribute("href");
      if (!href) return;
      const tag = document.createElement("a");
      tag.className = "fg-accel";
      tag.href = nodeUrl(window.location.origin + href);
      tag.rel = "nofollow noopener";
      tag.target = "_blank";
      tag.textContent = "加速下载";
      a.parentNode && a.parentNode.appendChild(tag);
    });

    const archives = document.querySelectorAll(
      'a[href$=".zip"], a[href$=".tar.gz"], a[href$=".tgz"]'
    );
    archives.forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!/\/archive\//.test(href)) return;
      if (a.parentNode && a.parentNode.querySelector(".fg-accel")) return;
      const tag = document.createElement("a");
      tag.className = "fg-accel";
      tag.href = nodeUrl(window.location.origin + href);
      tag.rel = "nofollow noopener";
      tag.target = "_blank";
      tag.textContent = "加速下载";
      a.parentNode && a.parentNode.appendChild(tag);
    });
  }

  /* ------------------------------ Issue 翻译 ------------------------------ */

  function addTranslate() {
    if (!settings.token || settings.language === "nothing") return;
    const blocks = document.querySelectorAll(
      "td.d-block.comment-body, .comment-body"
    );
    blocks.forEach((block) => {
      if (block.querySelector(".fg-trans")) return;
      const btn = document.createElement("button");
      btn.className = "fg-trans";
      btn.type = "button";
      btn.textContent = "翻译";
      btn.addEventListener("click", async () => {
        let out = block.parentNode && block.parentNode.querySelector(".fg-trans-out");
        if (out) {
          out.remove();
          return;
        }
        btn.textContent = "翻译中…";
        const text = (block.textContent || "").slice(0, 1500);
        const res = await chrome.runtime.sendMessage({ content: text });
        btn.textContent = "收起译文";
        out = document.createElement("div");
        out.className = "fg-trans-out";
        out.textContent = (res && res.content) || "翻译失败";
        block.parentNode && block.parentNode.appendChild(out);
      });
      block.appendChild(btn);
    });
  }

  /* ------------------------------ 路由 ------------------------------ */

  async function main() {
    settings = await FGStore.get();
    if (!settings || !settings.enabled) return;

    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return;

    const pageType = parts[2];

    // 私有仓库不注入，并上报后台加入永不代理名单
    const isPrivate = Array.from(document.querySelectorAll("span.Label--secondary")).some(
      (s) => (s.textContent || "").trim() === "Private"
    );
    if (isPrivate) {
      chrome.runtime.sendMessage({
        type: "markPrivate",
        url: window.location.href,
      }).catch(() => {});
      return;
    }

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

  /* --------------------------- 变更监听（PJAX） --------------------------- */

  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      main().catch((e) => console.debug("[FastGitHub]", e));
    }, 350);
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
  });

  main().catch((e) => console.debug("[FastGitHub]", e));
})();
