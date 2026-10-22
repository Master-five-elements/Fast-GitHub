/**
 * 真实 DOM 渲染测试：用 jsdom 加载预览页，验证 UI 脚本无运行时错误且正确渲染
 */
const path = require("path");
const http = require("http");
const fs = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.join(__dirname, "..", "gh-accelerator");
const errors = [];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end("404");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "text/plain" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let failed = 0;
function check(name, cond, extra) {
  if (!cond) failed++;
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (extra ? "  -> " + extra : ""));
}

async function load(baseUrl, page) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(page + ": " + e.message));
  vc.on("error", (m) => errors.push(page + ": " + m));

  const dom = await JSDOM.fromURL(baseUrl + "/preview/" + page + ".html", {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  await new Promise((r) => setTimeout(r, 1500));
  return dom;
}

(async () => {
  const server = await startServer();
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  console.log("\n[options] 设置页渲染");
  const o = await load(baseUrl, "options");
  const od = o.window.document;

  const rows = od.querySelectorAll("#nodeList .node-item");
  check("节点列表已渲染", rows.length > 50, rows.length + " 行");

  const badges = od.querySelectorAll("#nodeList .fg-badge-good");
  check("测速徽章已渲染", badges.length > 0, badges.length + " 个");

  check("概览-节点总数", /\d+ 个/.test(od.getElementById("statTotal").textContent),
    od.getElementById("statTotal").textContent);
  check("概览-最优节点", od.getElementById("statBest").textContent !== "—",
    od.getElementById("statBest").textContent);
  check("概览-最近同步", od.getElementById("statSync").textContent !== "从未",
    od.getElementById("statSync").textContent);
  check("默认激活节点管理页", od.querySelector('[data-panel="nodes"]').classList.contains("is-active"));

  // 切页
  od.querySelector('[data-tab="general"]').click();
  check("可切换到通用设置", od.querySelector('[data-panel="general"]').classList.contains("is-active"));
  od.querySelector('[data-tab="about"]').click();
  check("可切换到关于页", od.querySelector('[data-panel="about"]').classList.contains("is-active"));

  // 搜索过滤
  od.querySelector('[data-tab="nodes"]').click();
  od.getElementById("nodeSearch").value = "gh-proxy";
  od.getElementById("nodeSearch").dispatchEvent(new o.window.Event("input"));
  const filtered = od.querySelectorAll("#nodeList .node-item");
  check("搜索过滤生效", filtered.length > 0 && filtered.length < rows.length, filtered.length + " 行");

  console.log("\n[popup] 弹窗渲染");
  const p = await load(baseUrl, "popup");
  const pd = p.window.document;
  check("当前节点已渲染", pd.getElementById("nodeValue").textContent !== "—",
    pd.getElementById("nodeValue").textContent);
  check("当前页地址已渲染", pd.getElementById("currentUrl").textContent !== "—",
    pd.getElementById("currentUrl").textContent);
  check("同步时间已渲染", pd.getElementById("syncInfo").textContent.includes("最近同步"),
    pd.getElementById("syncInfo").textContent);

  console.log("\n[运行时错误]");
  if (errors.length) {
    errors.slice(0, 10).forEach((e) => console.log("  FAIL  " + e));
    failed += errors.length;
  } else {
    console.log("  PASS  无 JS 运行时错误");
  }

  console.log("\n" + (failed ? "❌ 失败 " + failed + " 项" : "✅ 全部通过"));
  server.close();
  process.exit(failed ? 1 : 0);
})();
