/**
 * 网络路由：按域名连通性决定走直连、jsDelivr CDN 还是公益节点。
 */

import { matchSensitive } from "./store.js";

/** 需要探测的 GitHub 域名画像 */
/**
 * 各域名的探测地址说明：
 * - 不能用裸根路径。codeload.github.com/ 会 301 跳到 github.com，
 *   raw.githubusercontent.com/ 裸根不响应，测出来的都是别的主机或超时。
 * - 改用真实的小文件 / 真实打包地址，且固定用小仓库（本网络环境下
 *   大仓库的 raw 文件会单独超时，不能代表主机连通性）。
 */
export const HOST_PROFILES = [
  {
    id: "web",
    label: "github.com 主站",
    probe: "https://github.com/",
    desc: "仓库浏览、Releases 页面",
  },
  {
    id: "raw",
    label: "raw 文件",
    probe: "https://raw.githubusercontent.com/hubporg/ghproxy-next/main/package.json",
    desc: "单文件原始内容",
  },
  {
    id: "codeload",
    label: "codeload 打包",
    probe: "https://codeload.github.com/hubporg/ghproxy-next/zip/refs/heads/main",
    desc: "仓库 zip / tar 打包下载",
  },
  {
    id: "api",
    label: "GitHub API",
    probe: "https://api.github.com/rate_limit",
    desc: "Release 元数据、仓库信息",
  },
];

/** jsDelivr CDN（有 SLA 的公共 CDN，仅公开仓库） */
export const JSDELIVR = {
  id: "jsdelivr",
  label: "jsDelivr CDN",
  host: "cdn.jsdelivr.net",
  desc: "公开仓库文件走商业 CDN，不经第三方公益节点",
};

/**
 * 把 GitHub 文件地址转换为 jsDelivr 地址。
 * 支持：
 *   raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
 *   github.com/{owner}/{repo}/raw/{ref}/{path}
 *   github.com/{owner}/{repo}/blob/{ref}/{path}
 * @param {string} url
 * @returns {string | null}
 */
export function toJsDelivr(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (host === "raw.githubusercontent.com" && parts.length >= 4) {
    const [owner, repo, ref] = parts;
    const path = parts.slice(3).join("/");
    return `https://${JSDELIVR.host}/gh/${owner}/${repo}@${ref}/${path}`;
  }

  if ((host === "github.com" || host.endsWith(".github.com")) && parts.length >= 5) {
    const [owner, repo, marker, ref] = parts;
    if (marker !== "raw" && marker !== "blob") return null;
    const path = parts.slice(4).join("/");
    return `https://${JSDELIVR.host}/gh/${owner}/${repo}@${ref}/${path}`;
  }
  return null;
}

/** jsDelivr 是否适用于该地址（仅公开仓库的单文件） */
export function jsDelivrApplicable(url) {
  return Boolean(toJsDelivr(url));
}

/**
 * 路由决策
 * @param {string} url
 * @param {{
 *   settings: any;
 *   probes?: Record<string, { reachable: boolean; latency: number; ts: number }>;
 * }} ctx
 * @returns {{ mode: "direct" | "jsdelivr" | "proxy"; channel: string; reason: string }}
 */
export function decideRoute(url, ctx) {
  const settings = ctx?.settings ?? {};
  const probes = ctx?.probes ?? settings.probes ?? {};
  const mode = settings.routeMode ?? "auto";

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { mode: "proxy", channel: "", reason: "地址无法解析，交回节点处理" };
  }
  const host = parsed.hostname.toLowerCase();

  // 1. 敏感页面永远直连
  if (settings.protectSensitive && matchSensitive(url, settings.sensitivePaths ?? [])) {
    return { mode: "direct", channel: "", reason: "命中登录保护白名单，禁止代理" };
  }

  // 2. 非 GitHub 域名不处理
  const isGithub =
    host === "github.com" ||
    host.endsWith(".github.com") ||
    host.endsWith(".githubusercontent.com");
  if (!isGithub) {
    return { mode: "direct", channel: "", reason: "非 GitHub 地址，保持直连" };
  }

  // 3. 强制代理模式
  if (mode === "alwaysProxy") {
    return { mode: "proxy", channel: "", reason: "已设置为始终走加速节点" };
  }

  // 4. 探测可达 + 允许直连优先 → 直连
  const profile =
    HOST_PROFILES.find((p) => host === new URL(p.probe).hostname) ??
    (host.endsWith(".githubusercontent.com") ? HOST_PROFILES[1] : null);
  const probe = profile ? probes[profile.id] : null;

  if (mode === "directFirst" && probe?.reachable) {
    return {
      mode: "direct",
      channel: "",
      reason: `${profile?.label ?? host} 直连可用（${probe.latency} ms）`,
    };
  }

  // 自动模式：API 与 codeload 若直连通则直连，避免占用公益节点带宽
  if (
    mode === "auto" &&
    probe?.reachable &&
    (profile?.id === "api" || profile?.id === "codeload")
  ) {
    return {
      mode: "direct",
      channel: "",
      reason: `${profile.label} 直连可用（${probe.latency} ms），无需代理`,
    };
  }

  // 5. raw 文件优先走 jsDelivr
  if (
    settings.useJsDelivr !== false &&
    profile?.id === "raw" &&
    jsDelivrApplicable(url)
  ) {
    return {
      mode: "jsdelivr",
      channel: JSDELIVR.id,
      reason: "raw 文件走 jsDelivr CDN，不经第三方节点",
    };
  }

  return { mode: "proxy", channel: "", reason: "直连不可用，交给最优加速节点" };
}
