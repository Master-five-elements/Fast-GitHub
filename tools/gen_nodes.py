import re
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(BASE, "gh-accelerator", "lib", "default-nodes.js")

# 节点清单来源：优先本地克隆的 ghproxy-next，缺失时回落到仓库内置 fixture
_CANDIDATES = [
    os.path.join(BASE, "src", "ghproxy-next-main", "components", "nodes.ts"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "nodes.ts"),
]
SRC = next((p for p in _CANDIDATES if os.path.exists(p)), _CANDIDATES[-1])

src = open(SRC, encoding="utf-8").read()

pat = re.compile(
    r"\{\s*label:\s*[\"']([^\"']+)[\"']\s*,\s*value:\s*[\"']([^\"']+)[\"']\s*\}"
)

seen = set()
out = []
for label, value in pat.findall(src):
    v = value.strip()
    if not v or v in seen:
        continue
    seen.add(v)
    out.append((v, label.strip()))

print("parsed nodes:", len(out))

lines = []
lines.append("/* ------------------------------------------------------------------")
lines.append(" * 内置加速节点库")
lines.append(" * 来源: hubporg/ghproxy-next  components/nodes.ts (社区公益节点)")
lines.append(" * 本文件自动生成，运行时可被「24 小时自动更新」覆盖")
lines.append(" * ------------------------------------------------------------------ */")
lines.append('var FG_NODES_SOURCE = "hubporg/ghproxy-next@main";')
lines.append("var FG_DEFAULT_NODES = [")
for v, l in out:
    lines.append('\t{ value: "%s", label: "%s", builtin: true },' % (v, l))
lines.append("];")

os.makedirs(os.path.dirname(DST), exist_ok=True)
open(DST, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("written:", DST, os.path.getsize(DST), "bytes")
