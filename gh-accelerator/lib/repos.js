/**
 * 节点仓库源。
 * 精选 GitHub 上近期活跃的国内加速节点仓库，每个仓库配多个镜像依次降级。
 *
 * 按能力分两类：
 * - `full`     可加速仓库：支持 clone / git smart HTTP，也能下载文件
 * - `download` 下载专用：只能下载文件（raw / release / archive），不能加速仓库
 *
 * `parser` 决定清单格式的解析方式；`kind` 是该仓库节点的默认分类
 * （可被仓库自带的分类信息或运行时能力探测覆盖）。
 *
 * parser 取值：
 * - `pair`      `{ label, value }` 对象（ghproxy-next）
 * - `prefix`    `{ name, prefix }` 对象（github-fast）
 * - `text`      一行一个域名（adss）
 * - `json`      JSON 数组（自定义源）
 * - `mirrorhub` MirrorHub 的 nodes.json，自带能力分类
 * - `mirrors`   ns-emu-tools 的 github_mirrors.json，分 download / raw 两组
 * - `triple`    `["url", "name", "tip"]` 三元组（FastGithub）
 * - `urls`      从任意文本中提取 https:// 域名（兜底）
 */

/** 为一个仓库生成镜像地址列表 */
function mirrors(repo, branch, filePath) {
  return [
    `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${filePath}`,
    `https://fastly.jsdelivr.net/gh/${repo}@${branch}/${filePath}`,
    `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`,
    `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`,
  ];
}

/**
 * @typedef {Object} NodeRepo
 * @property {string} id
 * @property {string} name 仓库全名
 * @property {string} desc 说明
 * @property {string} url 仓库主页
 * @property {string[]} mirrors 镜像地址（按优先级）
 * @property {string} parser 清单格式：pair | prefix | text | json | mirrorhub | mirrors | triple | urls
 * @property {"full" | "download"} kind 该仓库节点的默认能力分类
 */

/** @type {NodeRepo[]} */
export const NODE_REPOS = [
  {
    id: "ghproxy-next",
    name: "hubporg/ghproxy-next",
    desc: "社区公益加速节点主清单，附测速实现（GPL-3.0）",
    url: "https://github.com/hubporg/ghproxy-next",
    mirrors: mirrors("hubporg/ghproxy-next", "main", "components/nodes.ts"),
    parser: "pair",
    kind: "full",
  },
  {
    id: "adss",
    name: "clion007/adss",
    desc: "ADSS 维护的 GitHub 节点清单，一行一个域名",
    url: "https://github.com/clion007/adss",
    mirrors: mirrors("clion007/adss", "master", "ghnodes/ghnodes.ini"),
    parser: "text",
    kind: "full",
  },
  {
    id: "github-fast",
    name: "lopinnn56/github-fast",
    desc: "github-fast 内置节点表（name / prefix 结构）",
    url: "https://github.com/lopinnn56/github-fast",
    mirrors: mirrors("lopinnn56/github-fast", "main", "src/lib/nodes-core.js"),
    parser: "prefix",
    kind: "full",
  },
  {
    id: "mirrorhub",
    name: "mihsian77/MirrorHub",
    desc: "自动发现 / 测速 / 清理的节点库，自带能力分类（通用代理、网页镜像、clone 专用、仅 raw）",
    url: "https://github.com/mihsian77/MirrorHub",
    mirrors: mirrors("mihsian77/MirrorHub", "main", "nodes.json"),
    parser: "mirrorhub",
    kind: "full",
  },
  {
    id: "ns-emu-tools",
    name: "triwinds/ns-emu-tools",
    desc: "整理自 XIU2 高速下载脚本，区分下载镜像与 raw 镜像",
    url: "https://github.com/triwinds/ns-emu-tools",
    mirrors: mirrors("triwinds/ns-emu-tools", "main", "github_mirrors.json"),
    parser: "mirrors",
    kind: "download",
  },
  {
    id: "userscript",
    name: "XIU2/UserScript",
    desc: "GithubEnhanced-High-Speed-Download 油猴脚本内置镜像（上述清单的原始出处）",
    url: "https://github.com/XIU2/UserScript",
    mirrors: mirrors(
      "XIU2/UserScript",
      "master",
      "GithubEnhanced-High-Speed-Download.user.js",
    ),
    parser: "urls",
    kind: "download",
  },
  {
    id: "fastgithub",
    name: "RC1844/FastGithub",
    desc: "快速跳转 GitHub 镜像站的油猴脚本，内嵌 MirrorUrl 三元组清单",
    url: "https://github.com/RC1844/FastGithub",
    mirrors: mirrors("RC1844/FastGithub", "master", "FastGithub.js"),
    parser: "triple",
    kind: "full",
  },
  {
    id: "mc-mirror",
    name: "KotobaWakusei/GitHubMirrorPlugin",
    desc: "自动测速选择最快 GitHub 镜像的插件配置",
    url: "https://github.com/KotobaWakusei/GitHubMirrorPlugin",
    mirrors: mirrors(
      "KotobaWakusei/GitHubMirrorPlugin",
      "master",
      "src/main/resources/config.yml",
    ),
    parser: "urls",
    kind: "full",
  },
];

/** 默认全部启用 */
export const DEFAULT_REPO_IDS = NODE_REPOS.map((repo) => repo.id);

/** 已知仅支持文件下载的节点（CDN 类，确定不支持 git） */
export const DOWNLOAD_ONLY_HOSTS = [
  "cdn.jsdelivr.net",
  "fastly.jsdelivr.net",
  "gcore.jsdelivr.net",
  "testingcf.jsdelivr.net",
  "originfastly.jsdelivr.net",
  "cdn.staticaly.com",
  "wget.la",
];

/**
 * 仓库按其默认能力分类
 * @param {string} id
 * @returns {"full" | "download"}
 */
export function repoKind(id) {
  const repo = NODE_REPOS.find((r) => r.id === id);
  return repo?.kind ?? "full";
}
