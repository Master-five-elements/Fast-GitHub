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

let fetchMode = "ok";
globalThis.fetch = async () => {
  if (fetchMode === "fail") {
    const err = new Error("boom");
    err.name = "TypeError";
    throw err;
  }
  return {
    ok: true,
    status: 200,
    async text() {
      return fetchMode === "nodes" ? readFileSync(NODES_TS, "utf8") : "{}";
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
const sync = await FGNet.fetchRemoteNodes(s.updateSources, 5000);
check("同步成功", sync.ok === true, sync.source);
check("同步节点数 > 80", sync.nodes.length > 80, `${sync.nodes.length} 个`);

console.log("\n[9] 停用 / 启用");
await FGStore.set({ disabledNodes: ["ghfast.top"] });
const s3 = await FGStore.get();
check("停用后不再被选中", FGStore.bestNode(s3) !== "ghfast.top", FGStore.bestNode(s3));
check("停用后仍在完整列表", FGStore.allNodes(s3).some((n) => n.value === "ghfast.top"));
check("停用后不在可用列表", !FGStore.activeNodes(s3).some((n) => n.value === "ghfast.top"));

console.log("\n" + (failed ? `❌ 失败 ${failed} 项` : "✅ 全部通过"));
process.exit(failed ? 1 : 0);
