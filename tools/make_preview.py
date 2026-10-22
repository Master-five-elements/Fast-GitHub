"""生成带 mock 的离线预览页（与真实页面 DOM 完全一致，仅注入 chrome mock）"""
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(BASE, "gh-accelerator")
PREVIEW = os.path.join(EXT, "preview")

os.makedirs(PREVIEW, exist_ok=True)

MOCK_TAG = '<script src="chrome-mock.js"></script>\n'

for name in ("options", "popup"):
    src = os.path.join(EXT, name, name + ".html")
    html = open(src, encoding="utf-8").read()
    # 在第一个业务脚本之前注入 mock
    idx = html.find('<script src="../lib/')
    if idx == -1:
        raise SystemExit("未找到脚本注入点: " + src)
    html = html[:idx] + MOCK_TAG + html[idx:]
    # 同目录的 css/js 复用上级目录的真实文件，避免重复副本
    html = html.replace('"' + name + '.css"', '"../' + name + "/" + name + '.css"')
    html = html.replace('"' + name + '.js"', '"../' + name + "/" + name + '.js"')
    # 预览页标注
    html = html.replace("<title>", "<!-- PREVIEW -->\n    <title>")
    dst = os.path.join(PREVIEW, name + ".html")
    open(dst, "w", encoding="utf-8").write(html)
    print("generated:", dst)
