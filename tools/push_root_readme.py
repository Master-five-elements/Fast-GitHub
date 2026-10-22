#!/usr/bin/env python3
"""
用 new_root_readme.md 覆盖仓库顶层 README.md（会先 GET 最新 sha，避免覆盖他人改动）。

用法：
  GITHUB_TOKEN=xxx python tools/push_root_readme.py            # 实际提交
  GITHUB_TOKEN=xxx python tools/push_root_readme.py --dry-run  # 只预览
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(BASE, "new_root_readme.md")
OWNER = "Master-five-elements"
REPO = "Fast-GitHub"
BRANCH = "main"
PATH = "README.md"
MESSAGE = "docs: 重写仓库介绍，补充免责声明与引用项目链接"


def api(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "gh-accelerator-readme")
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.token:
        print("缺少 token：--token 或环境变量 GITHUB_TOKEN")
        return 1
    if not os.path.isfile(LOCAL):
        print("本地文件不存在:", LOCAL)
        return 1

    new_text = open(LOCAL, encoding="utf-8").read()
    print("新 README: %d 字符, %d 行\n" % (len(new_text), len(new_text.splitlines())))
    print("预览（前 26 行）：")
    print("-" * 60)
    print("\n".join(new_text.splitlines()[:26]))
    print("-" * 60)

    if args.dry_run:
        print("\n[dry-run] 未提交")
        return 0

    base = "https://api.github.com/repos/%s/%s" % (OWNER, REPO)
    status, data = api(base + "/contents/%s?ref=%s" % (PATH, BRANCH), args.token)
    if status != 200:
        print("读取远端 README 失败: HTTP %s %s" % (status, data.get("message", "")))
        return 1

    old_sha = data["sha"]
    old_len = len(base64.b64decode(data["content"]).decode("utf-8"))
    print("\n远端 README: %d 字符 (sha %s)" % (old_len, old_sha[:8]))

    payload = {
        "message": MESSAGE,
        "content": base64.b64encode(new_text.encode("utf-8")).decode("ascii"),
        "branch": BRANCH,
        "sha": old_sha,
    }
    st, res = api(base + "/contents/" + PATH, args.token, "PUT", payload)
    if st in (200, 201):
        print("✅ README 已更新 -> %s" % res.get("content", {}).get("html_url", ""))
        return 0
    print("更新失败: HTTP %s %s" % (st, res.get("message", "")))
    return 1


if __name__ == "__main__":
    sys.exit(main())
