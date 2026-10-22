/**
 * 核心逻辑冒烟测试（ESM 版）
 * 用 mock 的 chrome.storage / fetch 加载真实模块，验证关键行为
 *
 * 用法：node tools/smoke_test.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(TOOLS, "..");
const EXT = path.join(BASE, "gh-accelerator");

let failed = 0;
function check(name, ok, extra) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  -> ${extra}` : ""}`);
}

/* ---------------------------- mock chrome ---------------------------- */

const memory = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) out[k] = memory.get(k);
          return out;
        }
        if (keys && typeof keys === "object") {
          const out = {};
          for (const k of Object.keys(keys)) out[k] = memory.get(k);
          return out;
        }
        return { [keys]: memory.get(keys) };
      },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) {
          memory.set(k, JSON.parse(JSON.stringify(v)));
        }
      },
    },
    sync: { async get() { return {}; } },
  },
};

/* ------------------------------ mock fetch ------------------------------ */

const NODES_TS = [
  path.join(EXT, "..", "src", "ghproxy-next-main", "components", "nodes.ts"),
  path.join(TOOLS, "fixtures", "nodes.ts"),
].find((p) => {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
});

// 各仓库清单样例（用于验证解析器）
const ADSS_TEXT = "777.z321.cc.cd\ncdn.gh-proxy.com\n# comment\nfastgit.cc\n";
const FAST_TEXT =
  "export const DEFAULT_NODES = [\n" +
  "  { name: 'ghproxy.net', prefix: 'https://ghproxy.net/', mode: 'prefix' },\n" +
  "  { name: 'gh.dpik.top', prefix: 'https://gh.dpik.top/', mode: 'prefix' },\n" +
  "];";

let fetchMode = "ok";
globalThis.fetch = async (url) => {
  if (fetchMode === "fail") {
    const err = new Error("boom");
    err.name = "TypeError";
    throw err;
  }
  const target = String(url ?? "");
  // 模拟真实网络画像：raw 直连不通，api / codeload 可直连
  if (target.startsWith("https://raw.githubusercontent.com")) {
    const err = new Error("timeout");
    err.name = "AbortError";
    throw err;
  }
  let text = "{}";
  if (fetchMode === "nodes" || target.includes("nodes.ts")) {
    text = readFileSync(NODES_TS, "utf8");
  } else if (target.includes("adss")) {
    text = ADSS_TEXT;
  } else if (target.includes("github-fast")) {
    text = FAST_TEXT;
  }
  return {
    ok: true,
    status: 200,
    async text() {
      return text;
    },
    async arrayBuffer() {
      return new ArrayBuffer(64 * 1024);
    },
  };
};

/* ------------------------------ 加载模块 ------------------------------ */

const { DEFAULT_NODES, NODES_SOURCE } = await import("../gh-accelerator/lib/nodes.js");
const { FGStore, DEFAULT_SENSITIVE_PATHS } = await import(
  "../gh-accelerator/lib/store.js"
);
const { FGNet } = await import("../gh-accelerator/lib/net.js");
const { NODE_REPOS } = await import("../gh-accelerator/lib/repos.js");
const { HOST_PROFILES, decideRoute, toJsDelivr } = await import(
  "../gh-accelerator/lib/routes.js"
);

console.log("\n[1] 内置节点库");
check("节点数量 > 80", DEFAULT_NODES.length > 80, `${DEFAULT_NODES.length} 个`);
check("来源标注正确", NODES_SOURCE === "hubporg/ghproxy-next@main");
check(
  "包含 gh-proxy.com",
  DEFAULT_NODES.some((n) => n.value === "gh-proxy.com"),
);

console.log("\n[2] 默认设置");
const s = await FGStore.get();
check("自动更新默认开启", s.autoUpdate === true);
check("更新间隔 24 小时", s.updateIntervalHours === 24);
check("兜底节点 gh-proxy.com", s.fallbackNode === "gh-proxy.com");
check("登录保护默认开启", s.protectSensitive === true);
check("白名单默认 30+ 条", s.sensitivePaths.length > 30, `${s.sensitivePaths.length} 条`);

console.log("\n[3] 节点合并与择优");
const all = FGStore.allNodes(s);
check("合并后节点数 >= 内置数", all.length >= DEFAULT_NODES.length, `${all.length} 个`);
check("无测速数据时用兜底节点", FGStore.bestNode(s) === "gh-proxy.com");

await FGStore.saveStat("ghfast.top", "80", "33.3 Mbps");
await FGStore.saveStat("gh.dpik.top", "9999", "-");
const s2 = await FGStore.get();
check("按测速结果择优", FGStore.bestNode(s2) === "ghfast.top", FGStore.bestNode(s2));

const ch = FGStore.channels(s2, 3);
check("通道数量 = 3", ch.length === 3, ch.join(", "));
check("最优通道排首位", ch[0] === "ghfast.top");

console.log("\n[4] 代理链接构造");
check(
  "域名节点拼接",
  FGStore.buildProxyUrl("gh-proxy.com", "https://github.com/a/b") ===
    "https://gh-proxy.com/https://github.com/a/b",
);
check(
  "带协议节点不重复拼接",
  FGStore.buildProxyUrl("https://gh-proxy.com", "https://github.com/a/b") ===
    "https://gh-proxy.com/https://github.com/a/b",
);

console.log("\n[5] 白名单匹配");
const mock = { ...s2, sensitivePaths: [...DEFAULT_SENSITIVE_PATHS] };
check("登录页受保护", FGStore.matchSensitive("https://github.com/login", mock.sensitivePaths));
check(
  "带参数登录页受保护",
  FGStore.matchSensitive("https://github.com/login?return_to=%2F", mock.sensitivePaths),
);
check(
  "两步验证受保护",
  FGStore.matchSensitive("https://github.com/sessions/two-factor", mock.sensitivePaths),
);
check(
  "Token 设置受保护",
  FGStore.matchSensitive("https://github.com/settings/tokens", mock.sensitivePaths),
);
check(
  "组织设置受保护",
  FGStore.matchSensitive("https://github.com/orgs/acme/settings", mock.sensitivePaths),
);
check("公开仓库放行", !FGStore.matchSensitive("https://github.com/torvalds/linux", mock.sensitivePaths));
check(
  "Releases 放行",
  !FGStore.matchSensitive("https://github.com/torvalds/linux/releases", mock.sensitivePaths),
);
check(
  "自定义规则生效",
  FGStore.matchSensitive("https://github.com/foo/bar", ["/foo/*"]),
);

console.log("\n[6] 远端解析");
const parsed = FGNet.parseNodes(readFileSync(NODES_TS, "utf8"));
check("解析 nodes.ts", parsed.length > 80, `${parsed.length} 个`);
check("解析 JSON 数组", FGNet.parseNodes('[{"value":"a.com"},{"value":"b.com"}]').length === 2);
check("解析纯文本域名", FGNet.parseNodes("a.com\nb.com\n# c").length === 2);

console.log("\n[7] 测速行为");
fetchMode = "ok";
const r1 = await FGNet.testNode("gh-proxy.com", s.speedTestUrl, { withSpeed: true });
check("正常节点返回延迟", r1.latency !== "timeout", `latency=${r1.latency}`);
check("正常节点返回带宽", r1.speed !== "-", r1.speed);

fetchMode = "fail";
const r2 = await FGNet.testNode("bad.example.com", s.speedTestUrl, { withSpeed: true });
check("异常节点延迟标记 timeout", r2.latency === "timeout");
check("异常节点带宽为 -", r2.speed === "-");

console.log("\n[8] 远端同步");
fetchMode = "nodes";
const sync = await FGNet.fetchRemoteNodes(NODE_REPOS[0].mirrors, 5000);
check("同步成功", sync.ok === true, sync.source);
check("同步节点数 > 80", sync.nodes.length > 80, `${sync.nodes.length} 个`);

console.log("\n[8b] 自定义源参与仓库同步");
const withCustom = await FGNet.syncAllRepos(
  { ...s, updateSources: ["https://custom.example.com/nodes.json"] },
  NODE_REPOS,
  5000,
);
const customResult = withCustom.results.find((r) => r.id === "custom");
check("自定义源出现在同步结果里", Boolean(customResult), JSON.stringify(customResult));
check(
  "自定义源节点已并入",
  withCustom.nodes.some((n) => n.source === "custom"),
  `${withCustom.nodes.filter((n) => n.source === "custom").length} 个`,
);
const noCustom = await FGNet.syncAllRepos(s, NODE_REPOS, 5000);
check("未填自定义源时不产生 custom 结果", !noCustom.results.some((r) => r.id === "custom"));

// 自定义源是权威列表：清空后历史 custom 节点应被移除
const cleared = await FGNet.syncAllRepos(
  { ...s, remoteNodes: withCustom.nodes, updateSources: [] },
  NODE_REPOS,
  5000,
);
check(
  "清空自定义源后移除历史 custom 节点",
  !cleared.nodes.some((n) => n.source === "custom"),
  `剩余 ${cleared.nodes.filter((n) => n.source === "custom").length} 个`,
);

console.log("\n[9] 停用 / 启用");
await FGStore.set({ disabledNodes: ["ghfast.top"] });
const s3 = await FGStore.get();
check("停用后不再被选中", FGStore.bestNode(s3) !== "ghfast.top", FGStore.bestNode(s3));
check("停用后仍在完整列表", FGStore.allNodes(s3).some((n) => n.value === "ghfast.top"));
check("停用后不在可用列表", !FGStore.activeNodes(s3).some((n) => n.value === "ghfast.top"));

console.log("\n[10] 节点归一化");
check("去掉协议与 www", FGStore.nodeKey("HTTPS://WWW.Gh-Proxy.com/") === "gh-proxy.com");
check("去掉路径", FGStore.nodeKey("https://gh-proxy.com/foo/bar") === "gh-proxy.com");
check("去掉端口", FGStore.nodeKey("gh-proxy.com:443") === "gh-proxy.com");
check("去掉尾点", FGStore.nodeKey("gh-proxy.com.") === "gh-proxy.com");
check("保留多级域名", FGStore.nodeKey("cdn.gh-proxy.com") === "cdn.gh-proxy.com");

console.log("\n[11] 重复节点查重合并");
const dupList = [
  { value: "https://gh-proxy.com/", source: "ghproxy-next" },
  { value: "gh-proxy.com", source: "adss" },
  { value: "WWW.gh-proxy.com", source: "github-fast" },
  { value: "ghfast.top", source: "adss" },
];
const deduped = FGStore.dedupe(dupList);
check("重复写法合并为一个节点", deduped.length === 2, `${deduped.length} 个`);
const mergedNode = deduped.find((n) => n.value === "gh-proxy.com");
check(
  "合并后汇总全部来源",
  mergedNode?.sources?.length === 3,
  (mergedNode?.sources ?? []).join(","),
);
const stats = FGStore.mergeStats(dupList);
check(
  "统计：总数 4 / 唯一 2 / 重复 2",
  stats.total === 4 && stats.unique === 2 && stats.merged === 2,
  JSON.stringify(stats),
);
const replaced = FGStore.replaceRepoNodes(
  [
    { value: "a.com", source: "adss" },
    { value: "gh-proxy.com", source: "adss" },
  ],
  "adss",
  [{ value: "b.com" }],
);
check(
  "按仓库替换节点",
  replaced.length === 1 && replaced[0].value === "b.com" && replaced[0].source === "adss",
  JSON.stringify(replaced),
);

console.log("\n[12] 多仓库清单解析");
check("解析纯文本清单（adss）", FGNet.parseNodes(ADSS_TEXT).length === 3, `${FGNet.parseNodes(ADSS_TEXT).length} 个`);
const fastParsed = FGNet.parseNodes(FAST_TEXT);
check("解析 name/prefix 结构（github-fast）", fastParsed.length === 2, fastParsed.map((n) => n.value).join(","));
check(
  "prefix 结构提取到域名",
  fastParsed[0]?.value === "ghproxy.net",
  fastParsed[0]?.value ?? "",
);

console.log("\n[13] 多仓库同步");
fetchMode = "ok"; // 按 URL 分支返回各自格式，避免沿用上一段的样例
const syncAll = await FGNet.syncAllRepos(s2, NODE_REPOS, 5000);
check("同步全部仓库", syncAll.okCount === NODE_REPOS.length, `${syncAll.okCount}/${NODE_REPOS.length}`);
check(
  "每个仓库都标记了来源",
  syncAll.results.every((r) => r.ok && r.count > 0),
  syncAll.results.map((r) => `${r.id}:${r.count}`).join(" "),
);
const union = FGStore.mergeStats(FGStore.allNodes({ ...s2, remoteNodes: syncAll.nodes }));
check("合并去重后节点数 > 80", union.unique > 80, `${union.unique} 个（合并 ${union.merged} 个重复）`);
check(
  "同一节点只保留一条",
  FGStore.allNodes({ ...s2, remoteNodes: syncAll.nodes }).filter(
    (n) => n.value === "gh-proxy.com",
  ).length === 1,
);

console.log("\n[14] jsDelivr 通道转换");
check(
  "raw 地址转 jsDelivr",
  toJsDelivr("https://raw.githubusercontent.com/torvalds/linux/master/README") ===
    "https://cdn.jsdelivr.net/gh/torvalds/linux@master/README",
  toJsDelivr("https://raw.githubusercontent.com/torvalds/linux/master/README") ?? "",
);
check(
  "github raw 地址转 jsDelivr",
  toJsDelivr("https://github.com/torvalds/linux/raw/master/README") ===
    "https://cdn.jsdelivr.net/gh/torvalds/linux@master/README",
);
check(
  "blob 地址也支持",
  toJsDelivr("https://github.com/torvalds/linux/blob/master/MAINTAINERS") ===
    "https://cdn.jsdelivr.net/gh/torvalds/linux@master/MAINTAINERS",
);
check("非文件地址返回 null", toJsDelivr("https://github.com/torvalds/linux") === null);

/** 各探测项期望落在哪个主机上 */
function expectHost(id) {
  return (
    {
      web: "github.com",
      raw: "raw.githubusercontent.com",
      codeload: "codeload.github.com",
      api: "api.github.com",
    })[id] ?? "";
}

console.log("\n[15] 域名连通性探测");
fetchMode = "ok";
const probes = {};
for (const profile of HOST_PROFILES) {
  const result = await FGNet.probeHost(profile.probe, 3000);
  probes[profile.id] = { ...result, ts: Date.now() };
}check("api 域名探测为可达", probes.api?.reachable === true, `latency=${probes.api?.latency}`);
check(
  "raw 域名探测为不可达",
  probes.raw?.reachable === false,
  `latency=${probes.raw?.latency}`,
);

// 回归：探测地址不能是会 301 跳到别的主机的裸根
// （codeload.github.com/ 会跳到 github.com，raw 裸根不响应，都会让探测结果失真）
check(
  "各探测地址落在各自域名上",
  HOST_PROFILES.every((p) => new URL(p.probe).hostname === expectHost(p.id)),
  HOST_PROFILES.map((p) => `${p.id}=${new URL(p.probe).hostname}`).join(" "),
);
// codeload 裸根会 301 跳转到 github.com，raw 裸根不响应，
// 这两个域名必须用真实文件地址探测；github.com 首页本身就是目标，允许裸根
check(
  "codeload / raw 探测地址带真实路径",
  ["codeload", "raw"].every((id) => {
    const p = HOST_PROFILES.find((x) => x.id === id);
    return new URL(p.probe).pathname.length > 1;
  }),
  HOST_PROFILES.map((p) => `${p.id}=${new URL(p.probe).pathname}`).join(" "),
);

console.log("\n[16] 路由决策");
const base = { ...s2, sensitivePaths: DEFAULT_SENSITIVE_PATHS, probes };
check(
  "登录页强制直连",
  decideRoute("https://github.com/login", { settings: base }).mode === "direct",
);
check(
  "非 GitHub 地址直连",
  decideRoute("https://example.com/a", { settings: base }).mode === "direct",
);
check(
  "raw 文件走 jsDelivr",
  decideRoute("https://raw.githubusercontent.com/torvalds/linux/master/README", {
    settings: base,
  }).mode === "jsdelivr",
);
check(
  "codeload 打包因直连可用而直连",
  decideRoute("https://codeload.github.com/torvalds/linux/zip/refs/heads/master", {
    settings: base,
  }).mode === "direct",
  `${JSON.stringify(probes.codeload)} -> ${JSON.stringify(
    decideRoute("https://codeload.github.com/torvalds/linux/zip/refs/heads/master", {
      settings: base,
    }),
  )}`,
);
check(
  "主站页面走公益节点",
  decideRoute("https://github.com/torvalds/linux", { settings: base }).mode === "proxy",
);
check(
  "始终代理模式覆盖决策",
  decideRoute("https://raw.githubusercontent.com/a/b/main/c.js", {
    settings: { ...base, routeMode: "alwaysProxy" },
  }).mode === "proxy",
);
check(
  "关闭 CDN 后 raw 回落节点",
  decideRoute("https://raw.githubusercontent.com/a/b/main/c.js", {
    settings: { ...base, useJsDelivr: false },
  }).mode === "proxy",
);

console.log("\n[17] 节点能力探测");
const caps = await FGNet.probeCapabilities("gh-proxy.com", 3000);
check("能力探测返回结构完整", typeof caps.range === "boolean" && typeof caps.git === "boolean", JSON.stringify(caps));

console.log("\n[18] 健康度与使用统计");
const target = FGStore.bestNode(s2);
check("初始无使用记录", FGStore.healthOf(s2, target).score === null);
let usageSettings = await FGStore.recordUsage(target, true, 400);
usageSettings = await FGStore.recordUsage(target, true, 600);
usageSettings = await FGStore.recordUsage(target, false, 9000);
const health = FGStore.healthOf(usageSettings, target);
check("统计成功与失败次数", health.uses === 3 && health.score === 67, JSON.stringify(health));
check("失败率高的节点被降权", FGStore.bestNode(usageSettings) !== target, FGStore.bestNode(usageSettings));

console.log("\n" + (failed ? `❌ 失败 ${failed} 项` : "✅ 全部通过"));
process.exit(failed ? 1 : 0);
