[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")

# FAST-GitHub · GitHub Accelerator

Slow GitHub access, stalled Release downloads, stuck clones? This browser extension
rewrites download links to accelerated channels.

![Version](https://img.shields.io/badge/version-v2.3.1-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-orange)
![License](https://img.shields.io/badge/license-Apache--2.0-green)
![Tests](https://img.shields.io/badge/tests-74%20logic%20%2B%2032%20e2e-brightgreen)

> 中文说明见 [`README.md`](./README.md)。This is the English summary.

---

## ⚠️ Authorship Notice (read first)

**All content in this repository was written automatically by free models
([Hy-4-preview](https://www.workbuddy.cn) and Step-5-Preview) inside the
[WorkBuddy](https://www.workbuddy.cn) app. The repository owner did not participate
in any writing, review, or testing.**

- Code, docs and test scripts are model-generated and have not been reviewed line by line
- The models self-tested (see "Verification" below), but defects are not ruled out
- Read the code and assess the risk before installing
- Please open an issue if you find a security problem

---

## 📂 Layout

| Path | Contents | Status |
| --- | --- | --- |
| [`gh-accelerator/`](./gh-accelerator) | **Current version v2.3.1**, modern MV3 extension | ✅ Recommended |
| [`legacy/`](./legacy) | Archived previous version (gh-accelerator v2.2.0) | 📦 Archive only |
| [`fast_github/`](./fast_github) | Legacy v1.5.10 source (Vite + React + Tailwind) | 📦 Archive only, unmaintained |
| [`tools/`](./tools) | Node-list generation and verification scripts | ✅ Maintained with v2.3.1 |

The legacy `zip/` folder (9 packages, v1.5.2 – v1.5.10) has been removed. For the old
build use the [Edge Addons listing](https://microsoftedge.microsoft.com/addons/detail/github%E5%8A%A0%E9%80%9F/alhnbdjjbokpmilgemopoomnldpejihb)
or git history.

---

## 🚀 Current version: gh-accelerator v2.3.1

A complete MV3 rewrite of the old v1.5.10. Upstream project:
[fhefh2015/Fast-GitHub](https://github.com/fhefh2015/Fast-GitHub) (Apache-2.0); the new
version keeps the same license.

### Features

- **81 built-in community nodes**, synced every **24 hours** from **3 curated active
  node repositories**, each with 4 fallback mirrors
- **Custom node sources** in the settings page, merged with the repositories
- **Deduplication**: case, protocol, `www.`, port and path normalized before merging
- **Speed test**: HEAD latency + real bandwidth measurement; capability probes
  (Range requests, git smart HTTP); health scoring from real usage
- **Smart routing**: `raw` files via **jsDelivr CDN**; `api`/`codeload` direct when
  reachable; GitHub pages via nodes with auto-proxy fallback; connectivity re-probed
  every 6 hours
- **Security**: auto-proxy on navigation failure with a safety banner; **editable
  login-protection whitelist** (33 default rules, wildcard support, live self-check);
  private repos reported at runtime and never proxied
- **UI**: 2026 design language — glassmorphism, bento cards, micro-interactions,
  light/dark themes
- **Zero-build** native MV3 (ESM + JSDoc), formatted and linted with **Biome**

### Install

1. Download `gh-accelerator-v2.3.1.zip` from
   [Releases](https://github.com/Master-five-elements/Fast-GitHub/releases/latest)
2. Unzip to get the `gh-accelerator-v2.3.1/` folder
3. Open `chrome://extensions` (Edge: `edge://extensions`)
4. Enable **Developer mode**
5. Click **Load unpacked** and select the folder

Or load [`gh-accelerator/`](./gh-accelerator) straight from a clone — no build step.

### Verification

```bash
node tools/smoke_test.mjs                                          # 74 logic tests (mock chrome + fetch)
NODE_PATH=<workspace>/node_modules node tools/e2e_extension.js    # 32 end-to-end tests (puppeteer-core driving local Edge)
```

All passing, plus `biome check` clean across 19 files.

---

## 🔗 Credits

| Project | Used for | License |
| --- | --- | --- |
| [fhefh2015/Fast-GitHub](https://github.com/fhefh2015/Fast-GitHub) | **Upstream project**, legacy v1.5.10 source and icons | Apache-2.0 |
| [hubporg/ghproxy-next](https://github.com/hubporg/ghproxy-next) | Main node list (`components/nodes.ts`, 81 nodes) and speed-test reference | GPL-3.0 |
| [clion007/adss](https://github.com/clion007/adss) | Node repository (`ghnodes/ghnodes.ini`) | see repo |
| [lopinnn56/github-fast](https://github.com/lopinnn56/github-fast) | Node repository (`src/lib/nodes-core.js`) | see repo |
| [conwnet/github1s](https://github.com/conwnet/github1s) | Web IDE entry reference | MIT |
| [jsDelivr](https://www.jsdelivr.net) | Public CDN for raw file acceleration | service |
| [DartNode](https://dartnode.com) | Free VPS for the upstream open-source project | — |

**License note**: repository code follows the upstream Apache-2.0; the bundled node
data originates from the GPL-3.0 project ghproxy-next. The two licenses are not
compatible — for compliance needs follow each original project's declaration.

---

## 📄 Disclaimer

1. **No affiliation** with GitHub, Inc. This project is not authorized or endorsed by
   GitHub. "GitHub" is a trademark of GitHub, Inc.
2. **Requests transit third-party servers**: acceleration nodes are community
   services; operators can observe request targets and source IPs.
3. **Never use for sensitive operations**: do not access private repositories, log in
   to GitHub, or send any Token / Cookie through acceleration nodes. Always log in at
   the official `github.com/login`.
4. **No availability guarantee**: nodes may change or go offline at any time.
5. **Lawful use only**: public, legal resources only; obey local laws and the GitHub
   Terms of Service.
6. **Limitation of liability**: provided "AS IS", without warranty of any kind.
7. **AI-generated code**: written by AI models without human review (see Authorship
   Notice above); use at your own risk.

**In one line: only use it for public downloads. Do not log in. Do not send credentials.**

---

## 📜 License

Code under the upstream [Apache-2.0](./LICENSE). Node data licensing see Credits.
