import re
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "src", "ghproxy-next-main", "components", "nodes.ts")
DST = os.path.join(BASE, "gh-accelerator", "lib", "nodes.js")

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
lines.append("/**")
lines.append(" * 内置加速节点库（自动生成，勿手动编辑）")
lines.append(" * 来源: hubporg/ghproxy-next  components/nodes.ts（社区公益节点, GPL-3.0）")
lines.append(" * 运行时可被「24 小时自动更新」覆盖")
lines.append(" *")
lines.append(" * @type {{ value: string; label: string }[]}")
lines.append(" */")
lines.append('export const NODES_SOURCE = "hubporg/ghproxy-next@main";')
lines.append("")
lines.append("/** 内置节点列表 */")
lines.append("export const DEFAULT_NODES = [")
for v, l in out:
    lines.append('\t{ value: "%s", label: "%s", builtin: true },' % (v, l))
lines.append("];")
lines.append("")

os.makedirs(os.path.dirname(DST), exist_ok=True)
open(DST, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("written:", DST, os.path.getsize(DST), "bytes")
