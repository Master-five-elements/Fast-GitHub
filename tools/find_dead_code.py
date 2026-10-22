"""查找扩展中未被引用的导出与函数，辅助精简。"""
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "gh-accelerator")
TEST = os.path.join(BASE, "tools")

FILES = []
for root, dirs, files in os.walk(SRC):
    dirs[:] = [d for d in dirs if d not in {"node_modules", "icons", "preview"}]
    for f in files:
        if f.endswith((".js", ".mjs")):
            FILES.append(os.path.join(root, f))

sources = {}
for p in FILES:
    sources[p] = open(p, encoding="utf-8").read()

# 收集导出名
exports = {}
for p, text in sources.items():
    for m in re.finditer(r"^export (?:async )?function (\w+)|^export const (\w+)", text, re.M):
        name = m.group(1) or m.group(2)
        exports.setdefault(name, p)

# 统计引用（排除定义行本身）
unused = []
for name, defp in sorted(exports.items()):
    hits = 0
    for p, text in sources.items():
        for m in re.finditer(r"\b" + re.escape(name) + r"\b", text):
            # 跳过定义所在行
            line_start = text.rfind("\n", 0, m.start()) + 1
            line = text[line_start : text.find("\n", m.end())]
            if re.match(r"\s*export (async )?(function|const) " + re.escape(name) + r"\b", line):
                continue
            # 跳过 FGStore/FGNet 对象字面量里的键名
            if re.match(r"\s*" + re.escape(name) + r",\s*$", line):
                continue
            hits += 1
    if hits == 0:
        unused.append((name, os.path.relpath(defp, BASE)))

print("=== 未被引用的导出（候选死代码） ===")
if unused:
    for name, p in unused:
        print(f"  {name:<24} {p}")
else:
    print("  无")

# 统计测试文件引用（避免误删测试用的导出）
print("\n=== 测试脚本引用 ===")
test_text = ""
for root, dirs, files in os.walk(TEST):
    for f in files:
        if f.endswith((".mjs", ".js")):
            test_text += open(os.path.join(root, f), encoding="utf-8").read()
for name, p in unused:
    if re.search(r"\b" + re.escape(name) + r"\b", test_text):
        print(f"  {name} 仍被测试引用")

sys.exit(0)
