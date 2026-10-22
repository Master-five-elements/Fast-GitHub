/**
 * 节点仓库源。
 * 精选近期活跃的 GitHub 国内代理/加速节点仓库，每个仓库配多个镜像依次降级。
 */

/** 为一个仓库生成镜像地址列表 */
function mirrors(repo, branch, path) {
  return [
    `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${path}`,
    `https://fastly.jsdelivr.net/gh/${repo}@${branch}/${path}`,
    `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/${branch}/${path}`,
    `https://raw.githubusercontent.com/${repo}/${branch}/${path}`,
  ];
}

/**
 * @typedef {Object} NodeRepo
 * @property {string} id
 * @property {string} name 仓库全名
 * @property {string} desc 说明
 * @property {string} url 仓库主页
 * @property {string[]} mirrors 镜像地址（按优先级）
 */

/** @type {NodeRepo[]} */
export const NODE_REPOS = [
  {
    id: "ghproxy-next",
    name: "hubporg/ghproxy-next",
    desc: "社区公益加速节点 + 节点测速实现（GPL-3.0）",
    url: "https://github.com/hubporg/ghproxy-next",
    mirrors: mirrors("hubporg/ghproxy-next", "main", "components/nodes.ts"),
  },
  {
    id: "adss",
    name: "clion007/adss",
    desc: "ADSS 维护的 GitHub 节点清单（纯文本，一行一个）",
    url: "https://github.com/clion007/adss",
    mirrors: mirrors("clion007/adss", "master", "ghnodes/ghnodes.ini"),
  },
  {
    id: "github-fast",
    name: "lopinnn56/github-fast",
    desc: "github-fast 内置节点表（name / prefix 结构）",
    url: "https://github.com/lopinnn56/github-fast",
    mirrors: mirrors("lopinnn56/github-fast", "main", "src/lib/nodes-core.js"),
  },
];

/** 默认全部启用 */
export const DEFAULT_REPO_IDS = NODE_REPOS.map((repo) => repo.id);
