#!/usr/bin/env python3
"""
把本地产物通过 GitHub REST API 上传到指定仓库。

为什么不直接用 git push：
  本机到 github.com 的 git 协议被网络拦截（CONNECT 502），
  但 api.github.com 可正常访问，因此改用 Contents API。

用法：
  python tools/upload_to_github.py --token <YOUR_TOKEN>
  # 或者：export GITHUB_TOKEN=xxx && python tools/upload_to_github.py

  --dry-run   只列出将要上传的文件，不实际请求
  --branch    目标分支，默认 main

Token 要求：fine-grained token，只对目标仓库授权 Contents: Read and write 即可。
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(BASE, "upload")
DEFAULT_OWNER = "Master-five-elements"
DEFAULT_REPO = "Fast-GitHub"
DEFAULT_BRANCH = "main"
COMMIT_MESSAGE = (
    "feat(gh-accelerator): 新增现代化 MV3 扩展 v2.1.0\n\n"
    "- 接入 hubporg/ghproxy-next 的 81 个社区公益加速节点\n"
    "- 每 24 小时自动同步节点，多镜像源依次降级\n"
    "- 新增节点测速（延迟 + 真实带宽）并按结果自动择优\n"
    "- github.com 加载失败时自动跳转到代理节点\n"
    "- 登录页/账号设置/私有仓库永不代理，代理页注入安全提示条\n"
    "- 全新设计系统 UI：侧边栏导航、节点卡片、深色模式\n"
    "- 零构建原生 MV3，可直接加载已解压扩展"
)

SKIP_DIRS = {"__pycache__", ".git"}


def collect_files(root):
    out = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, root).replace("\\", "/")
            out.append((rel, full))
    return sorted(out)


def api_request(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "gh-accelerator-uploader")
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


def existing_sha(owner, repo, path, branch, token):
    url = (
        "https://api.github.com/repos/%s/%s/contents/%s?ref=%s"
        % (owner, repo, path, branch)
    )
    status, data = api_request(url, token)
    if status == 200 and isinstance(data, dict):
        return data.get("sha")
    return None


def upload_file(owner, repo, branch, token, rel_path, abs_path, retries=2):
    with open(abs_path, "rb") as f:
        raw = f.read()
    content = base64.b64encode(raw).decode("ascii")

    payload = {
        "message": COMMIT_MESSAGE,
        "content": content,
        "branch": branch,
    }
    sha = existing_sha(owner, repo, rel_path, branch, token)
    if sha:
        payload["sha"] = sha

    url = "https://api.github.com/repos/%s/%s/contents/%s" % (owner, repo, rel_path)
    for attempt in range(retries + 1):
        status, data = api_request(url, token, "PUT", payload)
        if status in (200, 201):
            return True, "ok"
        if status in (0, 403, 429) and attempt < retries:
            wait = 5 * (attempt + 1)
            print("    重试（%s），%ss 后继续…" % (status, wait))
            time.sleep(wait)
            continue
        msg = data.get("message", "unknown") if isinstance(data, dict) else str(data)
        return False, "HTTP %s: %s" % (status, msg)
    return False, "重试耗尽"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.path.isdir(SOURCE_DIR):
        print("源目录不存在:", SOURCE_DIR)
        return 1

    files = collect_files(SOURCE_DIR)
    print("待上传 %d 个文件 -> %s/%s@%s\n" % (len(files), args.owner, args.repo, args.branch))

    if args.dry_run:
        for rel, full in files:
            print("  %8d  %s" % (os.path.getsize(full), rel))
        return 0

    if not args.token:
        print("缺少 token：用 --token 传入，或设置环境变量 GITHUB_TOKEN")
        return 1

    ok, failed = 0, []
    for i, (rel, full) in enumerate(files, 1):
        print("[%2d/%d] %s" % (i, len(files), rel))
        success, info = upload_file(
            args.owner, args.repo, args.branch, args.token, rel, full
        )
        if success:
            ok += 1
        else:
            failed.append((rel, info))
            print("    失败: %s" % info)

    print("\n完成：成功 %d / 共 %d" % (ok, len(files)))
    if failed:
        print("失败明细：")
        for rel, info in failed:
            print("  - %s : %s" % (rel, info))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
