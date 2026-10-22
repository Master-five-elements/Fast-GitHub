#!/usr/bin/env python3
"""创建 GitHub Release 并上传 ZIP 资产。

用法：
  GITHUB_TOKEN=xxx python tools/create_release.py
  GITHUB_TOKEN=xxx python tools/create_release.py --dry-run
"""

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request

OWNER = "Master-five-elements"
REPO = "Fast-GitHub"
BRANCH = "main"
TAG = "v2.3.1"
NAME = "GitHub 加速 · 智能节点版 v2.3.1"
ZIP = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "gh-accelerator-v2.3.1.zip",
)

BODY = """## 🎉 gh-accelerator v2.3.1

在 v2.2.0 基础上新增**智能路由与 jsDelivr CDN 通道**，并完成一轮代码精简。

### ✨ 新增

- **jsDelivr CDN 通道**：`raw` 文件改走 `cdn.jsdelivr.net`（有 SLA 的商业 CDN，不涉及凭证中转，也不占用公益节点带宽）
- **按域名智能路由**：`api.github.com` / `codeload.github.com` 直连可用则直连；github.com 页面走节点保证渲染完整，失败时自动代理兜底
- **域名连通性探测**：每 6 小时自动探测，两轮重试抗网络抖动；路由页可手动触发与自检
- **节点能力探测**：是否支持 Range 断点续传、是否支持 git smart HTTP
- **健康度评分**：真实下载的成功率计入评分，失败率高的节点自动降权
- **自定义节点源**：设置页可追加任意清单地址，与 3 个节点仓库合并同步；清空即移除
- **代码精简**：消息处理改映射表、抽出 `fetchWithTimeout` / `headProbe` / `rankedNodes` 等共用助手

### 📦 安装

1. 下载下方的 `gh-accelerator-v2.3.1.zip`
2. 解压得到 `gh-accelerator-v2.3.1/` 文件夹
3. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
4. 开启「**开发者模式**」
5. 点「**加载已解压的扩展**」，选择解压出的文件夹

无需任何构建步骤，零依赖原生 MV3。

### 🧪 验证

- 74 项逻辑测试全部通过（节点归一化查重、择优排序、白名单匹配、测速、多仓库与自定义源同步、路由决策）
- 32 项真实浏览器端到端测试全部通过（puppeteer-core 驱动本机 Edge：真实加载扩展、service worker 激活、81 节点渲染、白名单增删改与自检、域名真实探测与路由判定、14 个消息处理器逐一调用、content script 真实注入）
- `biome check` 19 个文件零告警

### ⚠️ 注意

- 本版本内容由 WorkBuddy 应用中的免费模型（Hy-4-preview 与 Step-5-Preview）自动编写，未经人工审查，使用前请自行评估风险
- 第三方公益节点会中转请求，**请勿用于登录、私有仓库或任何带凭证的操作**
- 登录请直连 `github.com/login`

完整说明见仓库 [README.md](https://github.com/Master-five-elements/Fast-GitHub#readme)。
"""


def api(url, token, method="GET", payload=None, raw_body=None, content_type=None):
    data = raw_body if raw_body is not None else (
        json.dumps(payload).encode("utf-8") if payload is not None else None
    )
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "gh-accelerator-release")
    if content_type:
        req.add_header("Content-Type", content_type)
    elif data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
            return resp.status, (json.loads(body.decode("utf-8")) if body else {})
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(text)
        except Exception:
            return e.code, {"message": text[:300]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.path.isfile(ZIP):
        print("找不到 ZIP:", ZIP)
        return 1

    size = os.path.getsize(ZIP)
    print("Release: %s (%s)" % (TAG, NAME))
    print("资产: %s (%d bytes)\n" % (os.path.basename(ZIP), size))

    if args.dry_run:
        print("dry-run，不实际创建")
        return 0
    if not args.token:
        print("缺少 token")
        return 1

    base = "https://api.github.com/repos/%s/%s" % (OWNER, REPO)

    # 已存在则直接复用
    status, existing = api("%s/releases/tags/%s" % (base, TAG), args.token)
    if status == 200:
        release_id = existing["id"]
        print("Release 已存在，复用 id=%s" % release_id)
    else:
        status, rel = api(
            "%s/releases" % base,
            args.token,
            "POST",
            {
                "tag_name": TAG,
                "target_commitish": BRANCH,
                "name": NAME,
                "body": BODY,
                "draft": False,
                "prerelease": False,
            },
        )
        if status not in (200, 201):
            print("创建 Release 失败: HTTP %s %s" % (status, rel.get("message", "")))
            return 1
        release_id = rel["id"]
        print("Release 已创建 id=%s" % release_id)

    # 上传资产（先删同名，避免 422）
    asset_name = os.path.basename(ZIP)
    status, assets = api("%s/releases/%s/assets" % (base, release_id), args.token)
    if status == 200:
        for a in assets:
            if a["name"] == asset_name:
                api("%s/releases/assets/%s" % (base, a["id"]), args.token, "DELETE")
                print("已移除旧资产 %s" % asset_name)

    ctype = mimetypes.guess_type(ZIP)[0] or "application/zip"
    with open(ZIP, "rb") as f:
        raw = f.read()
    status, res = api(
        "https://uploads.github.com/repos/%s/%s/releases/%s/assets?name=%s"
        % (OWNER, REPO, release_id, asset_name),
        args.token,
        "POST",
        raw_body=raw,
        content_type=ctype,
    )
    if status not in (200, 201):
        print("上传资产失败: HTTP %s %s" % (status, res.get("message", "")))
        return 1

    print("资产已上传: %s (%d bytes)" % (res.get("name"), res.get("size", 0)))
    print("地址: %s" % res.get("browser_download_url", ""))
    print("\nRelease 页面: https://github.com/%s/%s/releases/tag/%s" % (OWNER, REPO, TAG))
    return 0


if __name__ == "__main__":
    sys.exit(main())
