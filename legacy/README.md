# 过往版本存档

本目录保留 `gh-accelerator` 的历史版本源码，仅供追溯与对比，**请勿直接使用**。

| 目录 | 版本 | 说明 |
| --- | --- | --- |
| [`gh-accelerator-v2.2.0/`](./gh-accelerator-v2.2.0) | v2.2.0 | 上一版完整源码（22 个文件） |

## v2.2.0 与当前版（v2.3.1）的差异

v2.2.0 缺少当前版后续新增的能力：

- jsDelivr CDN 通道与按域名智能路由（`lib/routes.js`）
- 域名连通性探测（两轮重试 + 每 6 小时定期探测）
- 节点能力探测（Range / git smart HTTP）与健康度评分
- 设置页「自定义节点源」参与同步
- 代码精简：消息处理映射表、`fetchWithTimeout` / `headProbe` / `rankedNodes` 等共用助手
- 自定义源为空时清理历史 custom 节点的行为修复

当前版本请使用仓库根目录的 [`gh-accelerator/`](../gh-accelerator)。

## 加载方式（仅供测试旧行为）

与当前版相同：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选择本目录。
注意旧版的 `manifest.json` 未声明 `lib/routes.js` 等资源，属正常历史状态。
