#!/usr/bin/env python3
"""
校验上传到 GitHub 的文件与本地是否字节级一致。

做法：GitHub Contents API 返回每个文件的 git blob SHA-1，
本地按同样规则（sha1("blob <len>\\0" + 内容)）计算后逐一比对，
文本与二进制（PNG 图标）都能覆盖。

用法：
  GITHUB_TOKEN=xxx python tools/verify_upload.py
  python tools/verify_upload.py --token xxx
"""

import argparse
import hashlib
import os
import sys
import json
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(BASE, "upload")
OWNER = "Master-five-elements"
REPO = "Fast-GitHub"
BRANCH = "main"
SKIP_DIRS = {"__pycache__", ".git"}


def git_blob_sha(data: bytes) -> str:
    h = hashlib.sha1()
    h.update(b"blob %d\0" % len(data))
    h.update(data)
    return h.hexdigest()


def api_get(url, token):
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "gh-accelerator-verifier")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, {"message": e.read().decode("utf-8", "replace")[:300]}
    except Exception as e:
        return 0, {"message": str(e)}


def remote_index(token):
    """递归拉取远端全部文件 -> {path: sha}（git trees API，一次调用）"""
    url = "https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1" % (
        OWNER,
        REPO,
        BRANCH,
    )
    status, data = api_get(url, token)
    if status != 200:
        print("  读取仓库树失败: HTTP %s %s" % (status, data.get("message", "")))
        return {}
    if data.get("truncated"):
        print("  警告：仓库树被截断，结果可能不完整")
    index = {}
    for item in data.get("tree", []):
        if item["type"] == "blob":
            index[item["path"]] = item.get("sha")
    return index


def local_files():
    out = []
    for base, dirs, files in os.walk(SOURCE_DIR):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, SOURCE_DIR).replace("\\", "/")
            out.append((rel, full))
    return sorted(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    args = parser.parse_args()

    if not args.token:
        print("缺少 token：--token 或环境变量 GITHUB_TOKEN")
        return 1

    files = local_files()
    print("本地文件 %d 个，开始比对远端 %s/%s@%s\n" % (len(files), OWNER, REPO, BRANCH))
    remote = remote_index(args.token)

    ok, mismatch, missing = [], [], []
    for rel, full in files:
        with open(full, "rb") as f:
            raw = f.read()
        want = git_blob_sha(raw)
        got = remote.get(rel)
        if got is None:
            missing.append(rel)
            print("  缺失  %s" % rel)
        elif got == want:
            ok.append(rel)
        else:
            mismatch.append(rel)
            print("  不一致 %s (本地 %s / 远端 %s)" % (rel, want[:8], (got or "")[:8]))

    print("\n一致 %d / 不一致 %d / 缺失 %d" % (len(ok), len(mismatch), len(missing)))
    if not mismatch and not missing:
        print("✅ 全部文件与本地字节级一致")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
