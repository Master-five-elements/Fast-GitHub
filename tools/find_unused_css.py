"""统计 CSS 类在 HTML/JS 中的使用情况，找出未使用的类。"""
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(BASE, "gh-accelerator")

css_files = []
for root, dirs, files in os.walk(EXT):
    dirs[:] = [d for d in dirs if d not in {"node_modules", "icons", "preview"}]
    for f in files:
        if f.endswith(".css"):
            css_files.append(os.path.join(root, f))

# 收集所有 CSS 类名
classes = {}
for p in css_files:
    text = open(p, encoding="utf-8").read()
    for m in re.finditer(r"\.([a-zA-Z][a-zA-Z0-9_-]*)", text):
        name = m.group(1)
        classes.setdefault(name, set()).add(os.path.basename(p))

# 收集 HTML/JS 中的类名引用
usage = {}
for root, dirs, files in os.walk(EXT):
    dirs[:] = [d for d in dirs if d not in {"node_modules", "icons", "preview"}]
    for f in files:
        if not f.endswith((".html", ".js")):
            continue
        p = os.path.join(root, f)
        text = open(p, encoding="utf-8").read()
        for m in re.finditer(r"class[\"'\s=]*\[?[\"']([^\"']+)[\"']", text):
            for cls in m.group(1).split():
                usage.setdefault(cls, set()).add(f)
        # className = "..." / classList.add("x") / template 里的 class="x y"
        for m in re.finditer(r"classList\.(?:add|remove|toggle)\(\s*[\"']([^\"']+)[\"']", text):
            usage.setdefault(m.group(1), set()).add(f)
        # 模板字符串中的 class="..."
        for m in re.finditer(r"class=[\"'`]([a-zA-Z0-9_${} .-]+)", text):
            for cls in re.split(r"[ ${}()?:`]+", m.group(1)):
                if cls and re.match(r"^[a-zA-Z][a-zA-Z0-9_-]*$", cls):
                    usage.setdefault(cls, set()).add(f)

unused = []
for name, files in sorted(classes.items()):
    if name not in usage:
        unused.append((name, sorted(files)))

print(f"=== CSS 类总数 {len(classes)}，未使用 {len(unused)} ===")
for name, files in unused:
    print(f"  .{name:<28} {','.join(files)}")

sys.exit(0)
