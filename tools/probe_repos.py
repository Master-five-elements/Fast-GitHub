"""
探测候选节点仓库：活跃度、清单文件、可解析出的域名数量
"""

import base64
import json
import os
import re
import urllib.request

TOKEN = os.environ.get("GITHUB_TOKEN", "")

CANDIDATES = [
    ("clion007/adss", "ghnodes/ghnodes.ini"),
    ("lopinnn56/github-fast", "src/lib/nodes-core.js"),
    ("Re0XIAOPA/AutoScrapeFreeNodes", "md-nodes.js"),
    ("mihsian77/MirrorHub", "active-nodes.json"),
]

TLDS = (
    "com|cn|net|org|xyz|top|cc|io|dev|site|online|icu|shop|tech|me|info|win|us|eu|"
    "pl|fr|tw|de|ru|co|app|cloud|fun|live|store|work|pro|link|one|zone|biz|pw|tk|"
    "ml|ga|edu|gov|jp|kr|uk|au|ca|nl|it|es|br|in|hk|id|vn|th|name|asia|moe|cyou|"
    " Click|best|host|space|website|press|digital|studio|group|today|center|vip|"
    "club|wiki|art|design|lol|pet|lol|be|se|ch|at|no|fi|dk|cz|hu|gr|pt|ro|sk|tr"
)
DOMAIN_RE = re.compile(
    r"\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*)\.(" + TLDS + r")\b(?![\w.-])",
    re.I,
)

COMMON_TLDS = {
    "com","cn","net","org","xyz","top","cc","io","dev","site","online","icu","shop",
    "tech","me","info","win","us","eu","pl","fr","tw","de","ru","co","app","cloud",
    "fun","live","store","work","pro","link","one","zone","biz","pw","tk","ml","ga",
    "edu","gov","jp","kr","uk","au","ca","nl","it","es","br","in","hk","id","vn","th",
}


def api(url):
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "probe")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"_error": str(e)}


def extract_domains(text):
    found = set()
    for m in DOMAIN_RE.finditer(text or ""):
        host = m.group(1).lower()
        if host.startswith("github.") or "githubusercontent" in host:
            continue
        if "example" in host or "localhost" in host:
            continue
        parts = host.split(".")
        if len(parts) < 2:
            continue
        if parts[0] in {"raw", "www", "cdn", "api", "docs", "img", "static"}:
            continue
        found.add(host)
    return found


for repo, path in CANDIDATES:
    info = api(f"https://api.github.com/repos/{repo}")
    if "_error" in info:
        print(f"[ERR ] {repo}: {info['_error'][:80]}")
        continue
    file = api(f"https://api.github.com/repos/{repo}/contents/{path}")
    size = 0
    domains = set()
    if "content" in file:
        try:
            text = base64.b64decode(file["content"]).decode("utf-8", "replace")
            size = len(text)
            domains = extract_domains(text)
        except Exception as e:
            print(f"  解析失败 {repo}: {e}")
    else:
        size = -1
    print(
        f"[OK  ] {repo:<40} stars={info.get('stargazers_count', 0):<5} "
        f"pushed={str(info.get('pushed_at'))[:10]} 文件={size}B 域名≈{len(domains)}"
    )
    if domains:
        print(f"        样例: {', '.join(sorted(domains)[:6])}")
    if os.environ.get("SHOW_TEXT"):
        print("        ---- 文件开头 ----")
        print("\n".join(text[:400].splitlines()[:12]))
