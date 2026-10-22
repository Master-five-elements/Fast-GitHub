/**
 * 真实浏览器端到端验证（puppeteer-core + 本机 Edge）
 *
 * A. 加载真实扩展目录：验证 service worker 激活、options / popup 渲染、
 *    白名单规则编辑与自检可用、无运行时报错
 * B. 用临时副本（matches 放开到 localhost）验证 content script 能真实注入 GitHub 页面按钮
 *
 * 用法：
 *   NODE_PATH=<workspace>/node_modules node tools/e2e_extension.js
 */

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const BASE = path.join(__dirname, "..");
const EXT = path.join(BASE, "gh-accelerator");
const EDGE =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

let failed = 0;
function check(name, ok, extra) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  -> ${extra}` : ""}`);
}

/** 递归复制目录 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

/** 模拟一个 GitHub 仓库页面（供注入验证使用） */
function startFakeGithub() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>repo</title></head>
      <body>
        <div class="file-navigation">
          <a href="/torvalds/linux/archive/refs/heads/master.zip">Download ZIP</a>
        </div>
      </body></html>`);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

async function launch(extPath) {
  return await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });
}

/** 从 service worker target 中解析扩展 ID */
async function findExtensionId(browser) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      const url = target.url();
      const match = /^chrome-extension:\/\/([a-z]{32})\//.exec(url);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function verifyOptions(browser, extId) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(`chrome-extension://${extId}/options/options.html`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector("#nodeList .node-item", { timeout: 15000 });

  const nodeRows = await page.$$eval("#nodeList .node-item", (els) => els.length);
  check("设置页渲染节点列表", nodeRows > 50, `${nodeRows} 行`);

  const total = await page.$eval("#statTotal", (el) => el.textContent);
  check("概览显示节点总数", /\d+ 个/.test(total ?? ""), total);

  const best = await page.$eval("#statBest", (el) => el.textContent);
  check("概览显示最优节点", (best ?? "") !== "—", best);

  // 节点仓库区块
  const repoItems = await page.$$eval("#repoList .repo-item", (els) => els.length);
  check("节点仓库列表渲染", repoItems === 3, `${repoItems} 个仓库`);

  const repoNames = await page.$$eval("#repoList .repo-name a", (els) =>
    els.map((el) => el.textContent.trim()),
  );
  check(
    "仓库名称正确",
    repoNames.includes("hubporg/ghproxy-next") && repoNames.includes("clion007/adss"),
    repoNames.join(" | "),
  );

  const mergeText = await page.$eval("#mergeInfo", (el) => (el.textContent ?? "").trim());
  check("显示去重统计信息", mergeText.length > 0, mergeText.slice(0, 46));

  await page.click("#btnDedupe");
  await new Promise((r) => setTimeout(r, 600));
  const afterDedupe = await page.$eval("#mergeInfo", (el) => (el.textContent ?? "").trim());
  check("点击去重按钮有反馈", afterDedupe.length > 0, afterDedupe.slice(0, 46));

  // 仓库开关
  await page.click('#repoList input[data-repo="adss"]');
  await new Promise((r) => setTimeout(r, 400));
  const adssOff = await page.$eval(
    '#repoList input[data-repo="adss"]',
    (el) => el.checked,
  );
  check("仓库开关可切换", adssOff === false);

  // 切换到「登录保护」
  await page.click('[data-tab="guard"]');
  await new Promise((r) => setTimeout(r, 400));
  const guardActive = await page.$eval(
    '[data-panel="guard"]',
    (el) => el.classList.contains("is-active"),
  );
  check("可切换到登录保护页", guardActive === true);

  const ruleCount = await page.$eval("#ruleCount", (el) => el.textContent);
  check("白名单规则已加载", Number(ruleCount) > 20, `${ruleCount} 条`);

  const chips = await page.$$eval("#ruleList .rule-chip", (els) => els.length);
  check("白名单规则渲染为可编辑条目", chips > 20, `${chips} 个`);

  // 添加一条自定义规则
  await page.type("#ruleInput", "/my-secret/*");
  await page.click("#btnAddRule");
  await new Promise((r) => setTimeout(r, 500));
  const afterAdd = await page.$eval("#ruleCount", (el) => Number(el.textContent));
  check("可新增白名单规则", afterAdd === Number(ruleCount) + 1, `${afterAdd} 条`);

  // 规则自检（先清掉可能遮挡按钮的 toast）
  await page.evaluate(() => {
    const wrap = document.getElementById("toastWrap");
    if (wrap) wrap.replaceChildren();
  });
  await page.type("#testUrlInput", "https://github.com/login");
  await page.click("#btnTestUrl");
  await new Promise((r) => setTimeout(r, 300));
  const blocked = await page.$eval("#testUrlResult", (el) => el.textContent ?? "");
  check("规则自检判定登录页受保护", blocked.includes("受保护"), blocked.trim());

  await page.evaluate(() => {
    const input = document.getElementById("testUrlInput");
    input.value = "https://github.com/torvalds/linux";
  });
  await page.click("#btnTestUrl");
  await new Promise((r) => setTimeout(r, 300));
  const allowed = await page.$eval("#testUrlResult", (el) => el.textContent ?? "");
  check("规则自检放行普通仓库页", allowed.includes("未命中"), allowed.trim());

  // 删除刚添加的规则（点最后一个 chip 的删除按钮）
  await page.evaluate(() => {
    const chips = document.querySelectorAll("#ruleList .rule-chip button");
    chips[chips.length - 1]?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const afterDel = await page.$eval("#ruleCount", (el) => Number(el.textContent));
  check("可删除白名单规则", afterDel === Number(ruleCount), `${afterDel} 条`);

  // 路由与诊断页
  await page.evaluate(() => {
    document.getElementById("toastWrap")?.replaceChildren();
  });
  await page.click('[data-tab="network"]');
  await new Promise((r) => setTimeout(r, 400));
  const networkActive = await page.$eval('[data-panel="network"]', (el) =>
    el.classList.contains("is-active"),
  );
  check("可切换到路由与诊断页", networkActive === true);

  const probeItems = await page.$$eval("#probeList .probe-item", (els) => els.length);
  check("域名探测列表渲染", probeItems === 4, `${probeItems} 项`);

  const healthItems = await page.$$eval("#healthList .health-item", (els) => els.length);
  check("健康度列表渲染", healthItems > 0, `${healthItems} 项`);

  await page.type(
    "#routeTestInput",
    "https://raw.githubusercontent.com/torvalds/linux/master/README",
  );
  await page.click("#btnRouteTest");
  await new Promise((r) => setTimeout(r, 400));
  const routeResult = await page.$eval("#routeTestResult", (el) => el.textContent ?? "");
  check(
    "路由自检给出判定",
    routeResult.length > 0,
    routeResult.replace(/\s+/g, " ").trim().slice(0, 44),
  );

  // 真实网络探测（最多等 25s）
  await page.evaluate(() => {
    document.getElementById("toastWrap")?.replaceChildren();
  });
  await page.click("#btnProbe");
  await new Promise((r) => setTimeout(r, 25000));
  const probeText = await page.$eval("#probeList", (el) => el.textContent ?? "");
  check(
    "域名连通性真实探测完成",
    /可达|不可达/.test(probeText),
    probeText.replace(/\s+/g, " ").trim().slice(0, 60),
  );

  // ESM service worker 是否真实响应消息
  const swResult = await page.evaluate(async () => {
    const res = await chrome.runtime.sendMessage({ type: "getSettings" });
    return res;
  });
  check(
    "background(ESM) 响应消息并返回设置",
    Boolean(swResult?.ok && swResult.settings?.sensitivePaths?.length),
    `规则 ${swResult?.settings?.sensitivePaths?.length ?? 0} 条`,
  );

  // 白名单拦截是否由后台真实执行
  const guard = await page.evaluate(async () => {
    const res = await chrome.runtime.sendMessage({
      type: "checkSensitive",
      url: "https://github.com/login",
    });
    return res;
  });
  check("后台判定登录页受保护", guard?.blocked === true, JSON.stringify(guard));

  check("设置页无运行时报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

async function verifyPopup(browser, extId) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`chrome-extension://${extId}/popup/popup.html`, {
    waitUntil: "networkidle2",
  });
  await new Promise((r) => setTimeout(r, 800));

  const node = await page.$eval("#nodeValue", (el) => el.textContent ?? "");
  check("弹窗显示当前节点", node !== "" && node !== "—", node);

  const hasButtons = await page.$$eval(".p-actions button", (els) => els.length);
  check("弹窗操作按钮齐全", hasButtons >= 5, `${hasButtons} 个`);

  check("弹窗无运行时报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
}

async function verifyContentScript(browser, extId) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));

  // 注入验证用副本放开到 localhost，这里访问同端口的模拟页
  const injected = await page
    .waitForSelector("#fg-speed-btn", { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  await page.close();
  return injected;
}

(async () => {
  console.log("\n=== A. 加载真实扩展 ===");
  const browser = await launch(EXT);
  const extId = await findExtensionId(browser);
  check("扩展已加载（service worker 激活）", Boolean(extId), extId ?? "未找到");

  if (!extId) {
    await browser.close();
    console.log("\n❌ 扩展未加载，终止");
    process.exit(1);
  }

  await verifyOptions(browser, extId);
  await verifyPopup(browser, extId);
  await browser.close();

  console.log("\n=== B. 验证 content script 注入 ===");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fg-e2e-"));
  const copy = path.join(tmp, "ext");
  copyDir(EXT, copy);

  const manifestPath = path.join(copy, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.content_scripts[0].matches = ["http://127.0.0.1/*"];
  manifest.web_accessible_resources[0].matches = ["http://127.0.0.1/*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const server = await startFakeGithub();
  const port = server.address().port;

  const browser2 = await launch(copy);
  const extId2 = await findExtensionId(browser2);
  check("副本扩展已加载", Boolean(extId2), extId2 ?? "未找到");

  const page = await browser2.newPage();
  const errors = [];
  const logs = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
  await page.goto(`http://127.0.0.1:${port}/torvalds/linux`, {
    waitUntil: "networkidle2",
  });
  await new Promise((r) => setTimeout(r, 2500));

  if (process.env.DEBUG_E2E) {
    console.log("  页面日志:", logs.slice(0, 12));
    const hasNav = await page.evaluate(
      () => !!document.querySelector(".file-navigation"),
    );
    console.log("  模拟页含 .file-navigation:", hasNav);
    const pathParts = await page.evaluate(
      () => location.pathname.split("/").filter(Boolean).length,
    );
    console.log("  路径段数:", pathParts);
  }

  const injected = await page
    .waitForSelector("#fg-speed-btn", { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  check("GitHub 页面成功注入加速按钮", injected);

  if (injected) {
    const channels = await page.$$eval("#fg-speed-btn .fg-chan", (els) => els.length);
    check("注入面板含多条通道", channels > 0, `${channels} 条`);

    const triggerText = await page.$eval(
      "#fg-speed-btn .fg-trigger",
      (el) => el.textContent ?? "",
    );
    check("加速按钮文案正确", triggerText.includes("加速"), triggerText.trim());
  }
  check("注入过程无运行时报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser2.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("\n" + (failed ? `❌ 失败 ${failed} 项` : "✅ 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("E2E 执行异常:", error);
  process.exit(1);
});
