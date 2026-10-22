[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")

# FAST-GitHub · GitHub 加速

国内访问 GitHub 慢、Release 下不动、仓库克隆不动？这个浏览器扩展把下载链接换成加速通道。

![Version](https://img.shields.io/badge/version-v2.3.1-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)
![License](https://img.shields.io/badge/license-Apache--2.0-green)
![Tests](https://img.shields.io/badge/tests-74%20logic%20%2B%2032%20e2e-brightgreen)

---

## ⚠️ 编写说明（请先阅读）

**本仓库的全部内容由 [WorkBuddy](https://www.workbuddy.cn) 应用中的免费模型（Hy-4-preview 与 Step-5-Preview）自动编写，仓库主人没有参与任何编写、审查与测试事宜。**

- 代码、文档、测试脚本均由模型生成，未经人工逐行审查
- 模型已做过自测（见下方「验证」），但**不保证**没有缺陷
- 使用前请自行阅读代码、评估风险，再决定是否安装
- 如发现安全问题，请提 Issue

---

## 📂 目录说明

| 目录 | 内容 | 状态 |
| --- | --- | --- |
| [`gh-accelerator/`](./gh-accelerator) | **当前版本 v2.3.1**，现代化 MV3 扩展 | ✅ 推荐使用 |
| [`legacy/`](./legacy) | 过往版本存档（gh-accelerator v2.2.0） | 📦 仅存档 |
| [`fast_github/`](./fast_github) | 旧版 v1.5.10 源码（Vite + React + Tailwind） | 📦 仅存档，不再维护 |
| [`tools/`](./tools) | 节点库生成与校验脚本 | ✅ 随新版维护 |

> 旧版的 `zip/` 打包目录已删除（v1.5.2 – v1.5.10 共 9 个安装包）。需要旧版请从
> [Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/github%E5%8A%A0%E9%80%9F/alhnbdjjbokpmilgemopoomnldpejihb)
> 或 git 历史获取。

### 各商店状态（旧版插件）

| 渠道 | 状态 |
| --- | --- |
| Chrome 网上应用店 | ❌ 已下架（2024-02）。原因：① 商店使用人数减少 ② 已有更好的加速方式 |
| macOS / 苹果商店 | ❌ 已下架。原因：① 维护者转行、账号到期 ② 收益 < 开发者年费 |
| Microsoft Edge 加载项 | ✅ 仍可安装（旧版 v1.5.10） |
| 本仓库源码 | ✅ 持续可用，新版在 `gh-accelerator/` |

---

## 🚀 当前版本：gh-accelerator v2.3.1

在旧版 v1.5.10 基础上完全重写的 MV3 扩展。上游项目为
[fhefh2015/Fast-GitHub](https://github.com/fhefh2015/Fast-GitHub)（Apache-2.0），
新版沿用同一许可证。

### 功能

**节点体系**
- 内置 **81 个**社区公益加速节点，开箱即用
- 精选 **3 个活跃节点仓库**，每 **24 小时**自动同步，每个仓库 4 个镜像依次降级
- 设置页可追加**自定义节点源**（与仓库合并同步，清空即移除）
- **重复节点查重合并**：统一大小写、协议、`www.`、端口、路径后归并，显示来源徽章

**测速与择优**
- 延迟探测（HEAD 计时）+ 真实带宽测算（下载样本文件换算 Mbps）
- 节点能力探测：是否支持 Range 断点续传、是否支持 git smart HTTP
- 真实使用成功率计入健康度评分，失败率高的节点自动降权

**智能路由（按域名分流）**
- `raw` 文件 → **jsDelivr CDN**（`cdn.jsdelivr.net`，商业 CDN，不经第三方节点）
- `api.github.com` / `codeload.github.com` → 直连可用则直连，省公益节点带宽
- github.com 页面 → 智能模式走节点保证渲染完整；失败时自动代理兜底
- 每 6 小时重新探测各域名连通性（两轮重试抗抖动），路由页可手动触发与自检
- jsDelivr 覆盖不到时（私有仓库、超 20MB）自动降级到加速节点

**安全**
- github.com 打不开时自动跳转代理节点，图标显示「代理」角标，页面注入安全提示条
- **登录保护白名单可编辑**：内置 33 条规则（登录、2FA、账号设置、组织与企业设置等），
  支持 `*` 通配、实时自检、增删改与恢复默认
- 私有仓库页面自动上报，加入运行时永不代理名单

**界面**
- 2026 设计语言：玻璃态、Bento 概览卡、大圆角、多层柔和阴影、微交互、深浅主题
- GitHub 页面注入渐变下拉面板，每条通道带延迟标签与一键复制

**架构**
- 零构建原生 MV3（ESM + JSDoc 类型注解），改完刷新即用
- 代码统一 **Biome** 规范（一个配置替代 Prettier + ESLint）

### 安装

**方式一：Release 压缩包（推荐）**

1. 前往 [Releases](https://github.com/Master-five-elements/Fast-GitHub/releases/latest) 下载 `gh-accelerator-v2.3.1.zip`
2. 解压得到 `gh-accelerator-v2.3.1/` 文件夹
3. 浏览器打开 `chrome://extensions`（Edge 为 `edge://extensions`）
4. 开启右上角「**开发者模式**」
5. 点「**加载已解压的扩展**」，选择刚才解压的文件夹

**方式二：仓库源码**

```bash
git clone https://github.com/Master-five-elements/Fast-GitHub.git
```

然后在 `chrome://extensions` 里直接加载 `gh-accelerator/` 目录（无需任何构建步骤）。


### 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置、节点与测速结果 |
| `alarms` | 24 小时节点同步、6 小时域名探测 |
| `webNavigation` | 感知 github.com 加载失败以触发自动代理 |
| `scripting` | 向代理页面注入安全提示条 |
| `https://*/*` `http://*/*` | 访问任意节点域名做测速与下载（加速类扩展的必要权限） |

### 验证

新版经过三层验证，全部通过：

```bash
node tools/smoke_test.mjs                                          # 74 项逻辑测试（mock chrome + fetch）
NODE_PATH=<workspace>/node_modules node tools/e2e_extension.js    # 32 项真实浏览器端到端（puppeteer-core 驱动本机 Edge）
```

- 逻辑层：节点归一化与查重、择优排序、白名单 glob 匹配、测速、多仓库与自定义源同步、路由决策
- 端到端：真实加载扩展、service worker 激活、81 节点渲染、白名单增删改与自检、
  **域名真实探测与路由判定**、14 个消息处理器逐一调用、content script 在模拟 GitHub 页面真实注入
- 代码规范：`biome check` 19 个文件零告警

---

## 🗂 过往版本

[`legacy/gh-accelerator-v2.2.0/`](./legacy/gh-accelerator-v2.2.0) 保留了上一版完整源码，
含当时的 22 个文件。该版本缺少后续新增的 jsDelivr CDN 通道、域名分流、能力探测、
自定义节点源与代码精简，仅作存档与对比，**请勿直接使用**。

更早的旧版 v1.5.10 源码在 [`fast_github/`](./fast_github)，需要 Vite 构建，已停止维护。

---

## 🔗 引用与致谢

本项目站在以下开源项目的肩膀上：

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [fhefh2015/Fast-GitHub](https://github.com/fhefh2015/Fast-GitHub) | **上游原项目**，旧版 v1.5.10 源码与图标来源 | Apache-2.0 |
| [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next) | 主要节点清单来源（`components/nodes.ts`，81 个节点）与测速实现参考 | GPL-3.0 |
| [clion007/adss](https://github.com/clion007/adss) | 节点仓库（`ghnodes/ghnodes.ini`，纯文本清单） | 见其仓库 |
| [lopinnn56/github-fast](https://github.com/lopinnn56/github-fast) | 节点仓库（`src/lib/nodes-core.js`，`name`/`prefix` 结构） | 见其仓库 |
| [conwnet/github1s](https://github.com/conwnet/github1s) | 文件树 Web IDE 入口参考 | MIT |
| [jsDelivr](https://www.jsdelivr.net) | 公共 CDN，raw 文件加速通道（`cdn.jsdelivr.net`） | 服务 |
| [DartNode](https://dartnode.com) | 为上游开源项目提供免费 VPS | — |

**许可证说明**：本仓库代码沿用上游的 Apache-2.0；内置节点数据源自 GPL-3.0 的
ghproxy-next，两者协议并不兼容，有合规需求的请遵循各原始项目的许可证声明。

---

## 📄 免责声明

1. **无关联**：本项目与 GitHub, Inc. 无任何关联，未获其授权或背书。"GitHub" 是 GitHub, Inc. 的注册商标。
2. **请求经第三方中转**：加速节点均为社区公益服务，请求会经过第三方服务器，节点运营方可以观测到请求目标与来源 IP。
3. **严禁用于敏感操作**：请勿通过加速节点访问私有仓库、登录 GitHub、或发送任何带 Token / Cookie 的请求。新版已内置登录保护，但请务必使用官方地址 `github.com/login` 登录。
4. **不保证可用性**：不保证任何节点的可用性、速度与可信度，节点随时可能变更或下线。
5. **合法使用**：仅可用于访问公开合法资源，请遵守所在地区法律法规与 GitHub 服务条款。
6. **责任豁免**：本软件按「现状」（AS IS）提供，不附带任何明示或默示担保。因使用本软件造成的任何损失，作者与贡献者不承担责任。
7. **AI 生成代码**：本仓库内容由 AI 模型自动生成（见上方「编写说明」），未经人工审查，使用风险自担。

**一句话：只用它下载公开资源，不要登录，不要传凭证。**

---

## 📜 许可证

代码沿用上游 [Apache-2.0](./LICENSE)。节点数据来源协议见「引用与致谢」。
