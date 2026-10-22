#!/usr/bin/env python3
"""删除仓库中不再需要的文件（需各自提供 sha 才能删除）"""

import json
import os
import sys
import urllib.error
import urllib.request

OWNER = "Master-five-elements"
REPO = "Fast-GitHub"
BRANCH = "main"

TARGETS = [
    "zip/v1.5.2.zip",
    "zip/v1.5.3.zip",
    "zip/v1.5.4.zip",
    "zip/v1.5.5.zip",
    "zip/v1.5.6.zip",
    "zip/v1.5.7.zip",
    "zip/v1.5.8.zip",
    "zip/v1.5.9.zip",
    "zip/v1.5.10.zip",
]


def api(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "gh-accelerator-cleanup")
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
            return e.code, {"message": body[:200]}
    except Exception as e:
        return 0, {"message": str(e)}


def main():
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        print("缺少 GITHUB_TOKEN")
        return 1

    base = f"https://api.github.com/repos/{OWNER}/{REPO}"
    for target in TARGETS:
        status, data = api(f"{base}/contents/{target}?ref={BRANCH}", token)
        if status == 404:
            print(f"  跳过（不存在）: {target}")
            continue
        if status != 200:
            print(f"  查询失败 {status}: {target} {data.get('message', '')}")
            continue
        status2, res = api(
            f"{base}/contents/{target}",
            token,
            "DELETE",
            {"message": f"chore: 移除已被 ESM 重构淘汰的文件 {target}", "sha": data["sha"], "branch": BRANCH},
        )
        print(f"  {'已删除' if status2 in (200, 204) else f'删除失败 {status2}'}: {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
