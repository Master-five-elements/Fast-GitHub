# GitHub 加速 · 智能节点版（gh-accelerator）

在 [Fast-GitHub](https://github.com/Master-five-elements/Fast-GitHub) v1.5.10 基础上重写的现代化 MV3 扩展。接入 [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next) 的社区公益节点，支持 **24 小时自动更新节点**、**节点测速**、**GitHub 打不开时自动代理**，以及**可编辑的登录保护白名单**。

> 纯原生 MV3，**无需构建**：`chrome://extensions/` → 开发者模式 → 加载已解压的扩展程序 → 选择本目录。

---

## 技术栈

| 项 | 选择 |
| --- | --- |
| 模块规范 | **ES Modules**（service worker 与扩展页面原生 ESM；content script 用动态 `import()` 以兼容各版本 Chromium） |
| 类型 | **JSDoc + TypeScript 类型注解**（`// @ts-check` 可校验，零构建） |
| 格式化 / Lint | **Biome 2.6**（一个配置文件替代 Prettier + ESLint，见 `biome.json`） |
| 运行时依赖 | 无 |

`package.json` 仅用于声明 `type: module` 与开发脚本，扩展运行不依赖它。

```bash
npm run format   # Biome 格式化
npm run lint     # Biome 检查（format + lint + assist）
```

---

## 功能

### 1. 节点自动更新（每 24 小时）

- `chrome.alarms` 定时触发，默认 **24 小时**（可改，最小 1 小时）
- 4 个镜像源依次降级：jsdelivr → fastly.jsdelivr → gh-proxy 代理的 raw → raw 直连
- 解析 `components/nodes.ts`，与内置节点合并去重；设置页可立即同步或自定义源地址

### 2. 节点测速

- **延迟**：对节点根路径发 HEAD 请求计时（6s 超时）
- **带宽**：经节点下载样本文件，不足 500ms 自动重复多轮以降低误差，换算 Mbps
- 节点 > 20 时先全量测延迟，再对延迟最优的 20 个做完整测速
- 结果持久化，自动模式始终使用「带宽最高 → 延迟最低」的节点

### 3. GitHub 打不开时自动代理

- `webNavigation.onErrorOccurred` 捕获主框架失败（超时 / 无法解析 / 连接被拒）
- 跳转到 `https://<最优节点>/https://github.com/原地址`，图标打「代理」角标，页面顶部注入安全提示条
- 同址最多重试 2 次，忽略主动中止与断网，不会死循环

### 4. 登录保护白名单（可编辑）

设置页「登录保护」是一个独立页面，规则完全可视化编辑：

- 规则以 chip 展示，可**逐条删除**、**自由添加**、**一键恢复默认**、**一键清空**
- 支持 `*` 通配单级路径段（如 `/settings/*`、`/orgs/*/settings`）
- 内置 **33 条**默认规则：登录、登出、2FA、账号设置、通知、计费、安全、组织与企业设置等
- 提供**规则自检**：输入任意 GitHub 地址即可验证是否会被拦截
- 私有仓库被访问时由内容脚本自动上报，加入运行时永不代理名单
- 弹窗的「一键代理 / 复制链接」对命中规则的地址直接拒绝

### 5. 页面增强

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

| 权限 | 用途 |
| --- | --- |
| `storage` | 设置、节点表与测速结果 |
| `alarms` | 每 24 小时同步节点 |
| `webNavigation` | 感知 github.com 加载失败 |
| `scripting` | 在代理页面注入安全提示条 |
| `https://*/*` `http://*/*` | 访问任意节点域名做测速与下载 |
| `web_accessible_resources` | content script 动态载入 `lib/*.js` |

---

## 目录结构

```
gh-accelerator/
├─ manifest.json          # MV3（background 为 ESM service worker）
├─ background.js          # 定时同步 / 失败自动代理 / 消息中转
├─ content.js             # 注入 github.com 的加速按钮（动态 import 共享模块）
├─ content.css
├─ lib/
│  ├─ nodes.js            # 内置 81 个节点（由 tools/gen_nodes.py 生成）
│  ├─ store.js            # 设置仓库、节点择优、白名单匹配
│  ├─ net.js              # 远端同步 + 测速
│  └─ ui.css              # 设计系统
├─ options/               # 设置页：节点管理 / 登录保护 / 通用设置 / 关于
├─ popup/                 # 弹窗
├─ icons/
└─ biome.json             # Biome 配置
```

---

## 验证

两层，均已通过：

```bash
node tools/smoke_test.mjs    # 逻辑层：节点合并/择优/白名单匹配/测速/同步（mock chrome + fetch）
NODE_PATH=<workspace>/node_modules node tools/e2e_extension.js   # 真实浏览器
```

端到端测试用 `puppeteer-core` 驱动本机 Edge 真实加载扩展，覆盖 22 项：扩展加载与 service worker 激活、设置页 81 个节点渲染、白名单增删改与自检、background(ESM) 消息响应、弹窗渲染、**content script 在模拟 GitHub 页面真实注入加速按钮**。

---

## 安全提醒

第三方公益节点会中转你的请求。**请勿用于私有仓库、带 Token 或 Cookie 的地址，也不要在代理页面登录 GitHub 账号。** 登录请直连 `github.com/login`。

## 来源与许可

- 上游：[Master-five-elements/Fast-GitHub](https://github.com/Master-five-elements/Fast-GitHub)（Apache-2.0）
- 节点：[hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next)（GPL-3.0），节点为社区公益服务，随时可能变更或下线
- 本目录代码沿用仓库的 Apache-2.0；节点数据来源协议见仓库顶层 README
