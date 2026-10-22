/**
 * 扩展核心逻辑冒烟测试
 * 用 mock 的 chrome.* / fetch 在 Node 中加载 lib 下的脚本并验证关键行为
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BASE = path.join(__dirname, "..", "gh-accelerator");
const read = (p) =>
  fs.readFileSync(path.isAbsolute(p) ? p : path.join(BASE, p), "utf8");

// 节点清单 fixture：优先本地克隆，缺失时用仓库内置副本
const NODES_TS = [
  path.join(__dirname, "..", "src", "ghproxy-next-main", "components", "nodes.ts"),
  path.join(__dirname, "fixtures", "nodes.ts"),
].find((p) => fs.existsSync(p));

const memory = new Map();
let fetchMode = "ok";

const chromeMock = {
  storage: {
    local: {
      async get(keys) {
        if (Array.isArray(keys)) {
          const out = {};
          keys.forEach((k) => (out[k] = memory.get(k)));
          return out;
        }
        if (keys && typeof keys === "object") {
          const out = {};
          Object.keys(keys).forEach((k) => (out[k] = memory.get(k)));
          return out;
        }
        return { [keys]: memory.get(keys) };
      },
      async set(obj) {
        Object.keys(obj).forEach((k) => memory.set(k, JSON.parse(JSON.stringify(obj[k]))));
      },
    },
    sync: {
      async get() {
        return {};
      },
    },
  },
};

const sandbox = {
  chrome: chromeMock,
  console,
  performance,
  setTimeout,
  clearTimeout,
  AbortController,
  URL,
  async fetch(url, init) {
    if (fetchMode === "fail") {
      const err = new Error("boom");
      err.name = "TypeError";
      throw err;
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return fetchMode === "nodes" ? read(NODES_TS) : "{}";
      },
      async arrayBuffer() {
        return new ArrayBuffer(64 * 1024);
      },
      async json() {
        return {};
      },
    };
  },
};

vm.createContext(sandbox);
vm.runInContext(read("lib/default-nodes.js"), sandbox);
vm.runInContext(read("lib/store.js"), sandbox);
vm.runInContext(read("lib/net.js"), sandbox);

let failed = 0;
function check(name, cond, extra) {
  const ok = !!cond;
  if (!ok) failed++;
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (extra ? "  -> " + extra : ""));
}

(async () => {
  console.log("\n[1] 内置节点库");
  check("节点数量 > 80", sandbox.FG_DEFAULT_NODES.length > 80, sandbox.FG_DEFAULT_NODES.length + " 个");
  check(
    "包含 gh-proxy.com",
    sandbox.FG_DEFAULT_NODES.some((n) => n.value === "gh-proxy.com")
  );
  check(
    "包含 cdn.gh-proxy.com",
    sandbox.FG_DEFAULT_NODES.some((n) => n.value === "cdn.gh-proxy.com")
  );

  console.log("\n[2] 默认设置");
  const s = await sandbox.FGStore.get();
  check("自动更新默认开启", s.autoUpdate === true);
  check("更新间隔 24 小时", s.updateIntervalHours === 24);
  check("兜底节点 gh-proxy.com", s.fallbackNode === "gh-proxy.com");
  check("失败自动代理默认开启", s.autoProxyOnFailure === true);

  console.log("\n[3] 节点合并与择优");
  const all = sandbox.FGStore.allNodes(s);
  check("合并后节点数 >= 内置数", all.length >= sandbox.FG_DEFAULT_NODES.length, all.length + " 个");
  check("无测速数据时使用兜底节点", sandbox.FGStore.bestNode(s) === "gh-proxy.com");

  await sandbox.FGStore.saveStat("ghfast.top", "80", "33.3 Mbps");
  await sandbox.FGStore.saveStat("gh.dpik.top", "9999", "-");
  const s2 = await sandbox.FGStore.get();
  check("按测速结果选出最优节点", sandbox.FGStore.bestNode(s2) === "ghfast.top", sandbox.FGStore.bestNode(s2));

  const ch = sandbox.FGStore.channels(s2, 3);
  check("通道数量 = 3", ch.length === 3, ch.join(", "));
  check("最优通道排首位", ch[0] === "ghfast.top", ch[0]);

  console.log("\n[4] 代理链接构造");
  check(
    "gh-proxy.com 前缀拼接",
    sandbox.FGStore.buildProxyUrl("gh-proxy.com", "https://github.com/a/b") ===
      "https://gh-proxy.com/https://github.com/a/b",
    sandbox.FGStore.buildProxyUrl("gh-proxy.com", "https://github.com/a/b")
  );
  check(
    "已带协议的节点不重复拼接",
    sandbox.FGStore.buildProxyUrl("https://gh-proxy.com", "https://github.com/a/b") ===
      "https://gh-proxy.com/https://github.com/a/b"
  );

  console.log("\n[5] 远端节点解析");
  const nodesTs = read(NODES_TS);
  const parsed = sandbox.FGNet.parseNodes(nodesTs);
  check("解析 nodes.ts", parsed.length > 80, parsed.length + " 个");
  check(
    "解析 JSON 数组",
    sandbox.FGNet.parseNodes('[{"value":"a.com"},{"value":"b.com"}]').length === 2
  );
  check(
    "解析纯文本域名",
    sandbox.FGNet.parseNodes("a.com\nb.com\n# comment").length === 2
  );

  console.log("\n[6] 测速行为");
  fetchMode = "ok";
  const r = await sandbox.FGNet.testNode("gh-proxy.com", s.speedTestUrl, { withSpeed: true });
  check("正常节点返回延迟数字", String(r.latency) !== "timeout", "latency=" + r.latency);
  check("正常节点返回带宽", r.speed !== "-", r.speed);

  fetchMode = "fail";
  const r2 = await sandbox.FGNet.testNode("bad.example.com", s.speedTestUrl, { withSpeed: true });
  check("异常节点延迟标记为 timeout", r2.latency === "timeout", "latency=" + r2.latency);
  check("异常节点带宽为 -", r2.speed === "-");

  console.log("\n[7] 远端同步");
  fetchMode = "nodes";
  const sync = await sandbox.FGNet.fetchRemoteNodes(s.updateSources, 5000);
  check("同步成功", sync.ok === true, sync.source);
  check("同步结果节点数 > 80", sync.nodes.length > 80, sync.nodes.length + " 个");

  console.log("\n[8] 停用 / 启用");
  await sandbox.FGStore.set({ disabledNodes: ["ghfast.top"] });
  const s3 = await sandbox.FGStore.get();
  check("停用后不再被选中", sandbox.FGStore.bestNode(s3) !== "ghfast.top", sandbox.FGStore.bestNode(s3));
  check("停用后仍在完整列表中", sandbox.FGStore.allNodes(s3).some((n) => n.value === "ghfast.top"));
  check("停用后不在可用列表中", !sandbox.FGStore.activeNodes(s3).some((n) => n.value === "ghfast.top"));

  console.log("\n[9] 敏感页面保护（登录白名单）");
  // 从 background.js 中抽出真实的规则与判函数进行测试
  const bg = read("background.js");
  const a = bg.indexOf("const SENSITIVE_PATH_RE");
  const b = bg.indexOf("];", a) + 2;
  const c = bg.indexOf("function isSensitiveUrl");
  const d = bg.indexOf("\n}", c) + 2;
  vm.runInContext(
    "var privateUrls = new Set();\n" + bg.slice(a, b) + "\n" + bg.slice(c, d),
    sandbox
  );
  const sens = sandbox.isSensitiveUrl;
  check("登录页被保护", sens("https://github.com/login") === true);
  check("带参数的登录页被保护", sens("https://github.com/login?return_to=%2F") === true);
  check("两步验证被保护", sens("https://github.com/sessions/two-factor") === true);
  check("Token 设置被保护", sens("https://github.com/settings/tokens") === true);
  check("组织设置被保护", sens("https://github.com/orgs/acme/settings") === true);
  check("通知页被保护", sens("https://github.com/notifications") === true);
  check("公开仓库不被拦截", sens("https://github.com/torvalds/linux") === false);
  check("Releases 页不被拦截", sens("https://github.com/torvalds/linux/releases") === false);
  check("公开 raw 不被拦截", sens("https://raw.githubusercontent.com/a/b/main/c.js") === false);
  sandbox.privateUrls.add("https://github.com/someone/secret-repo");
  check("上报的私有仓库被保护", sens("https://github.com/someone/secret-repo") === true);

  console.log("\n" + (failed ? "❌ 失败 " + failed + " 项" : "✅ 全部通过"));
  process.exit(failed ? 1 : 0);
})();
