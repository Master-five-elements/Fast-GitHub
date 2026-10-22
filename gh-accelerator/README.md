# GitHub 加速 · 智能节点版

在 [Fast-GitHub](https://github.com/Master-five-elements/Fast-GitHub)（v1.5.10）基础上重做的现代化版本：
接入 [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next) 的社区公益节点，支持 **24 小时自动更新节点**、**节点测速**、**GitHub 打不开时自动代理**。

> 本项目为纯 MV3 扩展，**无需构建**，直接「加载已解压的扩展」即可使用。

---

## ✨ 相比原版的变化

| 能力 | 原版 v1.5.10 | 本版 |
| --- | --- | --- |
| 加速节点 | 用户手动往文本框里粘贴 | 内置 **81 个** ghproxy-next 社区节点 |
| 节点更新 | 无 | **每 24 小时自动同步**，多镜像源降级 |
| 节点测速 | 无 | 延迟探测 + 真实带宽测算，自动择优 |
| github.com 打不开 | 无能为力 | **自动跳转代理节点**重开页面 |
| 界面 | Tailwind 2 老式表单 | 全新设计系统：侧边栏导航、节点卡片、深色模式 |
| 登录安全 | 无（凭证可能走第三方节点） | 登录/账号/私有仓库**永不代理**，代理页顶部安全提示条 |
| 架构 | Vite + React + Tailwind（需构建） | 零依赖原生 MV3，改完即刷新 |

---

## 🚀 安装

1. 打开 `chrome://extensions/`（Edge 为 `edge://extensions/`）
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本目录（`gh-accelerator`）
4. 首次安装会自动打开设置页，点一次「保存设置」即可

> `preview/options.html` 是离线 UI 预览页（带 chrome API mock），**仅供查看界面**，不要加载它作为扩展。

---

## 🧩 功能说明

### 1. 节点自动更新（每 24 小时）

- 通过 `chrome.alarms` 定时触发，默认间隔 **24 小时**（设置页可改，最小 1 小时）
- 依次尝试以下镜像源，任一成功即停止：
  1. `cdn.jsdelivr.net/gh/hubporg/ghproxy-next`
  2. `fastly.jsdelivr.net/gh/hubporg/ghproxy-next`
  3. `gh-proxy.com` 代理的 raw.githubusercontent
  4. `raw.githubusercontent.com` 直连
- 解析 `components/nodes.ts` 中的节点清单，与内置节点合并去重
- 设置页可「立即同步」，也可自定义节点源地址（一行一个）

### 2. 节点测速

- **延迟**：对节点根路径发 HEAD 请求计时（6s 超时）
- **带宽**：经节点下载样本文件（默认 `package-lock.json`，72KB），不足 500ms 时自动重复多轮以降低误差，换算为 Mbps
- 节点数 > 20 时先全量测延迟，再对延迟最优的 20 个做完整测速，避免流量浪费
- 结果写入 `chrome.storage.local`，自动模式下始终使用「带宽最高 → 延迟最低」的节点

### 3. GitHub 打不开时自动代理

- 监听 `webNavigation.onErrorOccurred`，仅在主框架导航失败（超时 / 无法解析 / 连接被拒）时触发
- 自动跳转到 `https://<最优节点>/https://github.com/原地址`，并在扩展图标上打「代理」角标
- 同一地址最多重试 2 次，忽略用户主动中止与断网场景，不会死循环
- 弹窗里也有「一键代理 / 复制链接」手动入口

### 3.5 登录与凭证保护（默认开启）

公益节点会中转全部请求，**登录必须走直连**。因此以下地址即使加载失败也**不会**被自动代理：

| 类别 | 示例路径 |
| --- | --- |
| 登录 / 登出 | `/login`、`/logout`、`/session`、`/sessions/two-factor`、`/signup`、`/join`、`/password_reset` |
| 账号设置 | `/settings/**`、`/settings/tokens`、`/account`、`/security`、`/billing`、`/apps` |
| 组织 / 企业 | `/orgs/*/settings`、`/organizations/*/settings`、`/enterprises/*/settings` |
| 其他 | `/notifications`、`/sponsors/*/dashboard` |
| 私有仓库 | 内容脚本检测到页面带 `Private` 标签时自动上报并加入永不代理名单 |

配套行为：

- 弹窗的「一键代理 / 复制链接」对敏感地址直接拒绝并给出提示
- 经代理打开的页面顶部会注入橙色提示条：**"当前页面经由第三方公益节点代理访问，请勿登录或输入任何凭证"**
- 可在设置页「保护登录与私有内容」开关中关闭（不建议）

> `github.com/login` 通常可以直连访问，登录请直接用官方地址。

### 4. 页面增强（沿用原版）

- 仓库首页 / 目录页：⚡**加速**下拉，展示 N 条可用通道的 clone 地址（一键复制）、下载 ZIP
- 文件树：每个文件旁提供 **Web IDE** 入口与 **下载** 按钮（走加速节点拉 raw 文件）
- Releases / Tags：每个产物旁追加 **加速下载** 链接
- Issue：可选腾讯 AI 翻译（需自行填写 Token）

---

## 🔒 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存设置、节点表与测速结果 |
| `alarms` | 每 24 小时定时同步节点 |
| `webNavigation` | 感知 github.com 加载失败以触发自动代理 |
| `scripting` | 在代理页面注入安全提示条 |
| `https://*/*` `http://*/*` | 访问任意节点域名做测速与下载（加速类扩展的必要权限） |

⚠️ **安全提醒**：第三方公益节点会中转你的请求。请勿用于私有仓库、带 Token 或 Cookie 的地址，也不要用它们登录 GitHub 账号。

---

## 📁 目录结构

```
gh-accelerator/
├─ manifest.json              # MV3 清单
├─ background.js              # 定时同步 / 失败自动代理 / 消息中转
├─ content.js  content.css    # 注入 github.com 页面的加速按钮
├─ lib/
│  ├─ default-nodes.js        # 内置 81 个节点（由 tools/gen_nodes.py 生成）
│  ├─ store.js                # 设置与节点仓库
│  ├─ net.js                  # 远端同步 + 测速
│  └─ ui.css                  # 设计系统（浅色 / 深色）
├─ options/                   # 设置页：节点管理 / 通用设置 / 关于
├─ popup/                     # 弹窗：当前节点 / 测速 / 一键代理
├─ icons/                     # 沿用原版图标
└─ preview/                   # 离线 UI 预览（含 chrome mock，不参与打包）
```

---

## 🧪 开发校验

```bash
node tools/smoke_test.js    # 核心逻辑冒烟测试（节点合并/择优/测速/同步/登录白名单，mock chrome API）
node tools/check_ids.js     # DOM id 与静态资源引用校验
python tools/gen_nodes.py   # 重新生成内置节点库
```

---

## 📄 许可与来源

- 上游项目：[Master-five-elements/Fast-GitHub](https://github.com/Master-five-elements/Fast-GitHub)
- 节点来源：[hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next)（社区公益节点）
- 节点为第三方公益服务，随时可能变更或下线，请自行测速后择优使用。
