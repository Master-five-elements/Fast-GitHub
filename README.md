[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")

# FAST-GitHub · GitHub 加速

国内访问 GitHub 慢、Release 下不动、仓库克隆不动？这个浏览器扩展把下载链接换成加速通道，让速度嗖嗖嗖的~！

![Version](https://img.shields.io/badge/version-v2.1.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)
![License](https://img.shields.io/badge/license-Apache--2.0-green)
[![Page Views Count](https://badges.toozhao.com/badges/01EH1R0YMQANV1ACQXTEBK7JCN/green.svg)](https://badges.toozhao.com/badges/01EH1R0YMQANV1ACQXTEBK7JCN/green.svg "Get your page views count badge on badges.toozhao.com")

> ## 🚀 新版已发布：`gh-accelerator` v2.1.0
>
> 本项目推出了重写的现代化 MV3 版本，位于 [`gh-accelerator/`](./gh-accelerator) 目录，**推荐新用户直接使用**：
>
> - 内置 **81 个**社区公益加速节点，开箱即用，不用再手动找节点
> - **每 24 小时**自动同步节点清单，4 个镜像源依次降级
> - **节点测速**：延迟探测 + 真实带宽测算，自动挑最快的那条
> - github.com 打不开时**自动走代理**；登录页 / 账号设置 / 私有仓库**永不代理**
> - 全新设计系统 UI（侧边栏导航、节点卡片、深色模式），零构建直接加载
>
> 完整说明见 [`gh-accelerator/README.md`](./gh-accelerator/README.md)。

---

## 项目状态

先说清楚现状，避免踩坑：

| 渠道 | 状态 |
| --- | --- |
| Chrome 网上应用店 | ❌ **已下架**（2024-02）<br>原因：① Chrome 商店使用人数逐渐减少 ② 已有更好的 GitHub 加速方式与工具 |
| macOS / 苹果商店 | ❌ **已下架**<br>原因：① 朋友转行、账号快到期 ② 插件收益 < 苹果开发者年费（$99） |
| Microsoft Edge 加载项 | ✅ **仍可安装**（见下方） |
| 本仓库源码 | ✅ **持续可用**，新版在 `gh-accelerator/` |

感谢购买过 macOS 版本插件的朋友，也感谢大家一直以来的支持。

> 旧版源码保留在 [`fast_github/`](./fast_github)，历史打包版本在 [`zip/`](./zip)，仅作存档，**不再维护**。

---

## 新版：gh-accelerator v2.1.0

### 相比旧版的变化

| 能力 | 旧版 v1.5.10 | 新版 v2.1.0 |
| --- | --- | --- |
| 加速节点 | 手动往文本框粘贴，得自己找 | 内置 81 个社区节点，可自动同步 |
| 节点更新 | 无 | 每 24 小时自动同步，多镜像源降级 |
| 节点测速 | 无 | 延迟 + 带宽测算，自动择优 |
| github.com 打不开 | 无能为力 | 自动跳转代理节点，图标显示角标 |
| 登录安全 | 凭证可能经过第三方节点 | 登录页 / 设置页 / 私有仓库永不代理，代理页有安全提示条 |
| 界面 | 老式表单 | 侧边栏导航、节点卡片、深色模式、Toast |
| 架构 | Vite + React + Tailwind（需构建） | 零依赖原生 MV3，改完刷新即可 |

### 安装

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本仓库中的 `gh-accelerator` 目录
4. 首次安装会自动打开设置页，点一次「保存设置」即可

也可从 [Releases](https://github.com/Master-five-elements/Fast-GitHub/releases) 下载打包好的版本。

### 目录结构

```
gh-accelerator/    扩展本体（MV3，零构建）
├─ lib/            节点库、设置仓库、测速模块、设计系统
├─ options/        设置页：节点管理 / 通用设置 / 关于
├─ popup/          弹窗：当前节点 / 测速 / 一键代理
└─ preview/        离线 UI 预览（仅用于查看界面）
tools/             节点库生成与校验脚本
fast_github/       旧版源码（存档）
zip/               旧版历史打包（存档）
```

---

## 旧版预览

<img width="1383" alt="旧版界面预览" src="https://user-images.githubusercontent.com/14891797/153814732-d43dbf95-38a3-4145-ac84-a628bc543509.png">

## 从 Edge 商店安装（旧版）

<table>
  <tbody>
    <tr>
      <td>
        <a href="https://microsoftedge.microsoft.com/addons/detail/github%E5%8A%A0%E9%80%9F/alhnbdjjbokpmilgemopoomnldpejihb" target="_blank">
          <img src="https://i.loli.net/2021/04/23/EnS3eDi4I86Yv2N.png" />
        </a>
      </td>
    </tr>
  </tbody>
</table>

---

## ⚠️ 免责声明

使用本项目前，请务必读完以下内容。

**1. 与 GitHub 官方无关**
本项目是第三方独立开发的工具，与 **GitHub, Inc. 没有任何关联、授权或背书**。"GitHub" 是 GitHub, Inc. 的注册商标，本项目仅作指向性引用。

**2. 请求会经过第三方服务器**
加速节点由**社区志愿者以公益性质提供**。使用加速即意味着你的下载请求会经由这些第三方服务器中转，节点运营方在技术上可以观测到请求目标、来源 IP、User-Agent 等信息。

**3. 严禁用于敏感内容**
- 请勿用于**私有仓库**、企业内部仓库或任何需要授权才能访问的资源
- 请勿在任何代理页面上**登录 GitHub 账号**或输入密码、2FA 验证码
- 请勿让带 **Token / Cookie / Authorization** 的请求走代理
- 新版已内置登录保护（登录页、账号设置、组织设置、私有仓库均不会被自动代理），但请自行核实后再使用

**4. 不保证可用性与安全性**
公益节点随时可能变更域名、限流、甚至永久下线，节点本身也不受本项目控制。本项目**不保证任何节点的可用性、速度、稳定性或可信度**，请自行测速并择优使用。

**5. 请合法使用**
请仅用于下载**公开、合法、你有权获取**的资源，并遵守所在地法律法规与 [GitHub 服务条款](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)。禁止用于绕过访问控制、抓取私有数据、批量盗取资源等用途。

**6. 责任豁免**
本项目按「原样」(AS IS) 提供，不含任何明示或默示的担保。对于因使用或无法使用本项目而导致的**数据泄露、账号损失、凭证外泄、下载内容侵权或任何法律责任**，作者不承担任何责任。继续使用即表示你已充分理解并接受上述全部风险。

> 一句话：**只用它下载公开资源，不要登录，不要传凭证。**

---

## 引用与致谢

本项目的实现离不开这些开源项目：

| 项目 | 说明 | 链接 |
| --- | --- | --- |
| **Master-five-elements/Fast-GitHub** | 本仓库，原版扩展 v1.5.10（Apache-2.0） | https://github.com/Master-five-elements/Fast-GitHub |
| **hubporg/ghproxy-next** | 新版加速节点来源（81 个社区公益节点）与节点测速实现参考（GPL-3.0） | https://github.com/hubporg/ghproxy-next |
| **hunshcn/gh-proxy** | 自建 GitHub 加速服务的参考实现 | https://github.com/hunshcn/gh-proxy |
| **conwnet/github1s** | GitHub1s，在浏览器中用 VS Code 阅读仓库 | https://github.com/conwnet/github1s |
| **fhefh2015/Fast-GitHub** | 原版扩展的另一镜像仓库，旧版使用说明引用自此 | https://github.com/fhefh2015/Fast-GitHub |
| **Cloudflare** | 为原版加速服务提供基础设施支持 | https://www.cloudflare.com/ |
| **DartNode** | 为开源项目提供免费 VPS | https://dartnode.com |

**关于许可证的说明**：本仓库代码沿用 **Apache License 2.0**；新版内置的加速节点清单源自 `hubporg/ghproxy-next`（**GPL-3.0**）。若你对节点数据的使用有合规要求，请遵循其原始许可证。

---

## 许可证

本项目基于 [Apache License 2.0](./LICENSE) 发布。
