#!/usr/bin/env python3
"""
收尾：
  1) 在仓库顶层 README.md 顶部插入新版说明（不覆盖原有内容）
  2) 为 main 最新提交打 v2.1.0 tag 并创建 Release

用法：
  GITHUB_TOKEN=xxx python tools/finish_release.py            # 实际执行
  GITHUB_TOKEN=xxx python tools/finish_release.py --dry-run  # 只预览
  python tools/finish_release.py --skip-readme               # 只做 Release
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

OWNER = "Master-five-elements"
REPO = "Fast-GitHub"
BRANCH = "main"
TAG = "v2.1.0"
README_PATH = "README.md"
MARKER = "gh-accelerator v2.1.0"

README_BLOCK = """
> ### 🚀 新版：`gh-accelerator` v2.1.0
>
> 本项目推出了现代化的 MV3 版本，位于 [`gh-accelerator/`](./gh-accelerator) 目录：
>
> - 内置 **81 个**社区公益加速节点（来自 [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next)）
> - **每 24 小时**自动同步节点，多镜像源依次降级
> - **节点测速**：延迟 + 真实带宽测算，自动选择最优节点
> - github.com 打不开时**自动代理**；登录页 / 账号设置 / 私有仓库**永不代理**
> - 全新设计系统 UI（侧边栏导航、节点卡片、深色模式），零构建可直接加载
>
> 完整说明见 [gh-accelerator/README.md](./gh-accelerator/README.md)；旧版源码保留在 `fast_github/`。
"""

RELEASE_BODY = """## GitHub 加速 · 智能节点版 v2.1.0

在 v1.5.10 基础上重做的现代化 MV3 版本，位于 `gh-accelerator/` 目录。

### 新增

- 接入 [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next) 的 **81 个**社区公益加速节点，内置随装随用
- **每 24 小时自动同步**节点，支持 4 个镜像源依次降级（jsdelivr / fastly / gh-proxy / raw）
- **节点测速**：延迟探测（HEAD 计时）+ 真实带宽测算（多样本轮次降误差），按结果自动择优
- github.com 加载失败时**自动跳转代理节点**，扩展图标显示「代理」角标
- **登录保护**：登录页、账号设置、私有仓库永不代理；代理页面注入安全提示条
- 全新设计系统 UI：侧边栏导航、节点卡片、延迟/带宽徽章、深色模式、Toast 提示
- 弹窗支持查看/切换当前节点、即时测速、一键代理与复制链接

### 变更

- 架构改为零依赖原生 MV3，**无需构建**，改完刷新即生效
- 设置存储改用 `chrome.storage.local`，并自动迁移 v1.5 及更早的配置
- 页面按钮重做：加速通道下拉、单文件下载、Release 加速下载、Web IDE、Issue 翻译

### 安装

1. 打开 `chrome://extensions/`，开启右上角「开发者模式」
2. 点击「加载已解压的扩展程序」，选择仓库中的 `gh-accelerator` 目录
3. 首次安装会自动打开设置页，点一次「保存设置」即可

### 注意

- 测速与下载需要 `host_permissions: https://*/*`
- 第三方公益节点会中转请求，**请勿用于私有仓库或带 Token / Cookie 的地址**
- 节点为社区公益服务，随时可能变更或下线，请自行测速后择优使用
"""


def api(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "gh-accelerator-release")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"message": body[:300]}
    except Exception as e:
        return 0, {"message": str(e)}


def insert_block(text):
    """在一级标题之后插入说明块；已是新版 README 则原样返回"""
    if MARKER in text:
        return text, False
    lines = text.split("\n")
    idx = None
    for i, line in enumerate(lines):
        if line.startswith("# "):
            idx = i
            break
    block = README_BLOCK.strip("\n").split("\n")
    if idx is None:
        new = block + [""] + lines
    else:
        new = lines[: idx + 1] + [""] + block + lines[idx + 1 :]
    return "\n".join(new), True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-readme", action="store_true")
    args = parser.parse_args()

    if not args.token:
        print("缺少 token：--token 或环境变量 GITHUB_TOKEN")
        return 1

    base = "https://api.github.com/repos/%s/%s" % (OWNER, REPO)

    # ---------- 1. README ----------
    if not args.skip_readme:
        status, data = api(
            base + "/contents/%s?ref=%s" % (README_PATH, BRANCH), args.token
        )
        if status != 200:
            print("读取 README 失败: HTTP %s %s" % (status, data.get("message", "")))
            return 1
        original = base64.b64decode(data["content"]).decode("utf-8")
        new_text, changed = insert_block(original)

        if not changed:
            print("README 已包含新版说明，跳过更新")
        else:
            print("README 预览（前 32 行）：")
            print("-" * 60)
            print("\n".join(new_text.split("\n")[:32]))
            print("-" * 60)
            if args.dry_run:
                print("\n[dry-run] 未写入")
            else:
                payload = {
                    "message": "docs: README 增加 gh-accelerator v2.1.0 新版说明",
                    "content": base64.b64encode(new_text.encode("utf-8")).decode(
                        "ascii"
                    ),
                    "branch": BRANCH,
                    "sha": data["sha"],
                }
                st, res = api(base + "/contents/" + README_PATH, args.token, "PUT", payload)
                if st in (200, 201):
                    print("\nREADME 已更新")
                else:
                    print("README 更新失败: HTTP %s %s" % (st, res.get("message", "")))
                    return 1

    if args.dry_run:
        print("\n[dry-run] 未创建 Release")
        return 0

    # ---------- 2. Tag + Release ----------
    status, data = api(base + "/commits/%s" % BRANCH, args.token)
    if status != 200:
        print("获取最新提交失败: HTTP %s %s" % (status, data.get("message", "")))
        return 1
    commit_sha = data["sha"]
    print("\n最新提交: %s" % commit_sha[:8])

    st, res = api(
        base + "/git/refs",
        args.token,
        "POST",
        {"ref": "refs/tags/" + TAG, "sha": commit_sha},
    )
    if st in (200, 201):
        print("Tag 已创建: %s" % TAG)
    elif st == 422:
        print("Tag 已存在，复用: %s" % TAG)
    else:
        print("Tag 创建失败: HTTP %s %s" % (st, res.get("message", "")))
        return 1

    st, res = api(
        base + "/releases",
        args.token,
        "POST",
        {
            "tag_name": TAG,
            "name": "GitHub 加速 · 智能节点版 " + TAG,
            "body": RELEASE_BODY,
            "draft": False,
            "prerelease": False,
        },
    )
    if st in (200, 201):
        print("\n✅ Release 已发布: %s" % res.get("html_url", ""))
        return 0
    print("Release 创建失败: HTTP %s %s" % (st, res.get("message", "")))
    return 1


if __name__ == "__main__":
    sys.exit(main())
