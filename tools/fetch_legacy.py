"""把远端 gh-accelerator（v2.2.0）下载到本地 legacy/ 目录，作为过往版本保留。"""
import base64
import json
import os
import sys
import time
import urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
OWNER = "Master-five-elements"
REPO = "Fast-GitHub"
BRANCH = "main"
PREFIX = "gh-accelerator/"
DEST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "legacy")
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

API = f"https://api.github.com/repos/{OWNER}/{REPO}"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "User-Agent": "workbuddy-upload",
}


def api(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if i == retries - 1:
                raise
            print(f"  重试 {url} ({e})")
            time.sleep(2)


def download(meta, dest):
    """按文件元数据下载，文本用 contents API，二进制用 raw。"""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if meta.get("encoding") == "base64" and meta.get("content"):
        data = base64.b64decode(meta["content"])
        with open(dest, "wb") as f:
            f.write(data)
        return
    # 二进制（或过大）走 raw 地址
    req = urllib.request.Request(meta["download_url"], headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        with open(dest, "wb") as f:
            f.write(r.read())


def main():
    tree = api(f"{API}/git/trees/{BRANCH}?recursive=1")
    files = [
        t
        for t in tree.get("tree", [])
        if t["type"] == "blob" and t["path"].startswith(PREFIX)
    ]
    print(f"待下载 {len(files)} 个文件（线上 v2.2.0）")

    dest_root = os.path.join(DEST, "gh-accelerator-v2.2.0")
    for t in files:
        rel = t["path"][len(PREFIX):]
        dest = os.path.join(dest_root, rel)
        meta = api(f"{API}/contents/{t['path']}?ref={BRANCH}")
        download(meta, dest)
        print(f"  ✓ {rel}")

    print(f"\n已保存到 {dest_root}")


if __name__ == "__main__":
    main()
