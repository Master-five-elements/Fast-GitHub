# GitHub 加速 · 智能节点版（gh-accelerator）

在 [Fast-GitHub](https://github.com/fhefh2015/Fast-GitHub) v1.5.10 基础上重写的现代化 MV3 扩展。汇聚多个近期活跃的 GitHub 国内加速节点仓库，支持 **24 小时自动更新节点**、**节点测速**、**重复节点自动查重合并**、**GitHub 打不开时自动代理**，以及**可编辑的登录保护白名单**。

> 纯原生 MV3，**无需构建**：`chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。

---

## 技术栈

| 项            | 选择                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| 模块规范      | **ES Modules**（service worker 与扩展页面原生 ESM；content script 用动态 `import()` 以兼容各版本 Chromium） |
| 类型          | **JSDoc + TypeScript 类型注解**（`// @ts-check` 可校验，零构建）                                            |
| 格式化 / Lint | **Biome 2.6**（一个配置文件替代 Prettier + ESLint，见 `biome.json`）                                        |
| 运行时依赖    | 无                                                                                                          |

`package.json` 仅用于声明 `type: module` 与开发脚本，扩展运行不依赖它。

```bash
npm run format   # Biome 格式化
npm run lint     # Biome 检查（format + lint + assist）
```

---

## 功能

### 1. 多仓库节点同步（每 24 小时）

精选 3 个近期活跃的 GitHub 国内加速节点仓库，可在设置页单独开关：

| 仓库                                                              | 清单文件                | 说明                         |
| ----------------------------------------------------------------- | ----------------------- | ---------------------------- |
| [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next)   | `components/nodes.ts`   | 社区公益加速节点，内置 81 个 |
| [clion007/adss](https://github.com/clion007/adss)                 | `ghnodes/ghnodes.ini`   | 纯文本清单，一行一个域名     |
| [lopinnn56/github-fast](https://github.com/lopinnn56/github-fast) | `src/lib/nodes-core.js` | `name` / `prefix` 结构节点表 |
- `chrome.alarms` 定时触发，默认 **24 小时**（可改，最小 1 小时）
- 每个仓库配 4 个镜像依次降级：jsdelivr → fastly.jsdelivr → gh-proxy 代理的 raw → raw 直连
- 解析器兼容 4 种形态：`{label,value}`、`{name,prefix}`、JSON 数组（`value`/`domain`/`host`/`url`）、纯文本域名
- 设置页的「**自定义节点源**」文本框可追加任意清单地址，与上方仓库合并同步；该列表是权威的——清空后同步会移除之前来自自定义源的节点

### 2. 重复节点查重合并

不同仓库经常收录同一个节点，写法还不统一。扩展会把它们归并为一条：
- 归一化规则：统一小写，去掉协议、`www.`、端口、路径与尾点
  —— `HTTPS://WWW.Gh-Proxy.com/`、`gh-proxy.com`、`www.gh-proxy.com` 视为同一个节点
- 合并后保留一条记录，用 `sources` 汇总它出现在哪些仓库（节点列表会显示来源徽章）
- 设置页顶部实时显示「仓库原始 N 条 → 去重后 M 个（合并 K 个重复项）」，并提供**立即去重合并**按钮
- 手动添加自定义节点时也会先归一化，避免重复录入

### 3. 节点测速

- **延迟**：对节点根路径发 HEAD 请求计时（6s 超时）
- **带宽**：经节点下载样本文件，不足 500ms 自动重复多轮以降低误差，换算 Mbps
- **能力探测**：检测节点是否支持 Range 断点续传、是否支持 git smart HTTP
- 节点 > 20 时先全量测延迟，再对延迟最优的 20 个做完整测速
- 结果持久化，自动模式始终使用「带宽最高 → 延迟最低」的节点

### 4. GitHub 打不开时自动代理

- `webNavigation.onErrorOccurred` 捕获主框架失败（超时 / 无法解析 / 连接被拒）
- 跳转到 `https://<最优节点>/https://github.com/原地址`，图标打「代理」角标，页面顶部注入安全提示条
- 同址最多重试 2 次，忽略主动中止与断网，不会死循环

### 5. 智能路由与 jsDelivr CDN 通道

实测发现 GitHub 各域名的连通性并不一致（本机：`api.github.com` 698ms 可达，主站与 raw 间歇超时），
「一律走第三方节点」会把本可直连的流量也送进别人服务器。因此增加了按域名分流：

| 目标                             | 策略                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `raw.githubusercontent.com` 文件 | **走 jsDelivr CDN**（`cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}`），商业 CDN 有 SLA，不涉及凭证中转 |
| `api.github.com`                 | 直连可用则直连（省公益节点带宽）                                                                          |
| `codeload.github.com` 打包       | 直连可用则直连（大 zip 不占用公益节点带宽）                                                               |
| github.com 页面                  | 智能模式下走节点保证渲染完整；直连优先模式下尝试直连，失败再由自动代理兜底                                |
| 登录 / 私有内容                  | 永远直连，见下一节                                                                                        |
- 每 **6 小时**自动重新探测各域名连通性，也可在设置页手动触发
- 探测带**两轮重试**：本机网络呈间歇性中断，单次采样曾把可用域名误判为不可达
- jsDelivr 覆盖不到时（私有仓库、超过 20MB）**自动降级**到加速节点重试
- 三种路由模式可切换：**智能分流**（默认）/ **直连优先** / **始终走节点**

### 6. 登录保护白名单（可编辑）

设置页「登录保护」是一个独立页面，规则完全可视化编辑：
- 规则以 chip 展示，可**逐条删除**、**自由添加**、**一键恢复默认**、**一键清空**
- 支持 `*` 通配单级路径段（如 `/settings/*`、`/orgs/*/settings`）
- 内置 **33 条**默认规则：登录、登出、2FA、账号设置、通知、计费、安全、组织与企业设置等
- 提供**规则自检**：输入任意 GitHub 地址即可验证是否会被拦截
- 私有仓库被访问时由内容脚本自动上报，加入运行时永不代理名单
- 弹窗的「一键代理 / 复制链接」对命中规则的地址直接拒绝

### 7. 页面增强

- 仓库首页 / 目录页：⚡**加速**下拉，多条通道的 clone 地址一键复制、下载 ZIP
- 文件树：Web IDE 入口 + 单文件下载（走节点拉 raw）
- Releases / Tags：每个产物旁追加「加速下载」
- Issue / PR：可选腾讯 AI 翻译（需自填 Token）

---

## UI

2026 设计语言：
- 大圆角（12 / 18px）、多层柔和阴影、渐变强调色（indigo → violet → cyan）
- 玻璃态顶栏与侧边栏（`backdrop-filter`）
- Bento 风格概览卡片，悬停微上浮
- 按钮按压反馈、面板入场动画、Toast 提示
- 完整的深浅色主题，注入元素也跟随 GitHub 自身的明暗模式

---

## 权限

| 权限                       | 用途                               |
| -------------------------- | ---------------------------------- |
| `storage`                  | 设置、节点表与测速结果             |
| `alarms`                   | 每 24 小时同步节点                 |
| `webNavigation`            | 感知 github.com 加载失败           |
| `scripting`                | 在代理页面注入安全提示条           |
| `https://*/*` `http://*/*` | 访问任意节点域名做测速与下载       |
| `web_accessible_resources` | content script 动态载入 `lib/*.js` |

---

## 目录结构

```
gh-accelerator/
├─ manifest.json          # MV3（background 为 ESM service worker）
├─ background.js          # 定时同步 / 域名探测 / 失败自动代理 / 消息中转
├─ content.js             # 注入 github.com 的加速按钮（动态 import 共享模块）
├─ content.css
├─ lib/
│  ├─ nodes.js            # 内置 81 个节点（由 tools/gen_nodes.py 生成）
│  ├─ repos.js            # 节点仓库源定义（3 个仓库 + 镜像降级）
│  ├─ routes.js           # 域名画像、jsDelivr 转换、路由决策
│  ├─ store.js            # 设置仓库、节点择优、健康度、白名单匹配
│  ├─ net.js              # 远端同步 + 测速 + 域名探测 + 能力探测
│  └─ ui.css              # 设计系统
├─ options/               # 设置页：节点管理 / 登录保护 / 路由与诊断 / 通用设置 / 关于
├─ popup/                 # 弹窗
├─ icons/
└─ biome.json             # Biome 配置
```

---

## 验证

两层，均已通过：

```bash
node tools/smoke_test.mjs    # 逻辑层：节点合并/择优/白名单匹配/测速/同步/路由（mock chrome + fetch）
NODE_PATH=<workspace>/node_modules node tools/e2e_extension.js   # 真实浏览器
```

端到端测试用 `puppeteer-core` 驱动本机 Edge 真实加载扩展，覆盖 31 项：扩展加载与 service worker 激活、设置页 81 个节点渲染、3 个节点仓库渲染与开关、白名单增删改与自检、**路由页域名真实探测与路由自检**、background(ESM) 消息响应、弹窗渲染、**content script 在模拟 GitHub 页面真实注入加速按钮**。

此外另跑过一轮**消息处理器全覆盖**验证（14 个 handler 逐一真实调用）：getSettings / setSettings / route / checkSensitive / recordUsage / markPrivate / probeHosts / testNode / probeCapabilities 全部正常，未知消息正确放行，旧版「带 content 即翻译」的兼容路径保留。实测 `testNode("gh-proxy.com")` 延迟 1959ms，`probeCapabilities` 返回 `{range:false, git:true}`（该节点支持 git smart HTTP、不支持 Range）。

真实网络下的探测与路由结果（本机实测）：

```
探测    api ✅ 580ms   codeload ✅ 1413ms   raw ✅ 1333ms   web ✅ 1070ms
路由    raw 文件      → jsDelivr CDN（不经第三方节点）
        codeload 打包 → 直连（1413ms 可达，省公益节点带宽）
        api.github.com → 直连（580ms 可达）
        github.com 页面 → 加速节点（智能模式，保证渲染完整）
        github.com/login → 直连（命中白名单，禁止代理）
```

---

## 安全提醒

第三方公益节点会中转你的请求。**请勿用于私有仓库、带 Token 或 Cookie 的地址，也不要在代理页面登录 GitHub 账号。** 登录请直连 `github.com/login`。

## 来源与许可

- 上游：[fhefh2015/Fast-GitHub](https://github.com/fhefh2015/Fast-GitHub)（Apache-2.0）
- 节点仓库：[hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next)（GPL-3.0）、[clion007/adss](https://github.com/clion007/adss)、[lopinnn56/github-fast](https://github.com/lopinnn56/github-fast)
- 节点均为社区公益服务，随时可能变更或下线，请自行测速后择优使用
- 本目录代码沿用仓库的 Apache-2.0；各节点仓库的协议以其自身声明为准
