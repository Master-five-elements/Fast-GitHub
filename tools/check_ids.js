/**
 * 静态校验：HTML 中是否存在 JS 引用的元素 id / 引用的静态资源是否存在
 */
const fs = require("fs");
const path = require("path");

const EXT = path.join(__dirname, "..", "gh-accelerator");
let failed = 0;

function fail(msg) {
  failed++;
  console.log("  FAIL  " + msg);
}
function pass(msg) {
  console.log("  PASS  " + msg);
}

function checkPage(page) {
  const dir = path.join(EXT, page);
  const html = fs.readFileSync(path.join(dir, page + ".html"), "utf8");
  const js = fs.readFileSync(path.join(dir, page + ".js"), "utf8");

  const htmlIds = new Set();
  const idRe = /\sid="([^"]+)"/g;
  let m;
  while ((m = idRe.exec(html)) !== null) htmlIds.add(m[1]);

  const usedIds = new Set();
  const useRe = /\$\("([^"]+)"\)/g;
  while ((m = useRe.exec(js)) !== null) usedIds.add(m[1]);

  console.log("\n[" + page + "] 元素 id");
  const missing = [...usedIds].filter((id) => !htmlIds.has(id));
  if (missing.length) fail("JS 引用了不存在的 id: " + missing.join(", "));
  else pass("所有 JS 引用的 id 均存在 (" + usedIds.size + " 个)");

  console.log("\n[" + page + "] 静态资源");
  const refRe = /(?:href|src)="([^"]+)"/g;
  const refs = new Set();
  while ((m = refRe.exec(html)) !== null) {
    const v = m[1];
    if (/^(https?:|#|data:)/.test(v)) continue;
    refs.add(v);
  }
  refs.forEach((r) => {
    const full = path.resolve(dir, r);
    if (fs.existsSync(full)) pass(r);
    else fail("资源不存在: " + r);
  });
}

["options", "popup"].forEach(checkPage);

console.log("\n[manifest] 引用文件");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
const files = [
  manifest.background.service_worker,
  manifest.options_page,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts[0].js,
  ...manifest.content_scripts[0].css,
];
files.forEach((f) => {
  if (fs.existsSync(path.join(EXT, f))) pass(f);
  else fail("manifest 引用不存在: " + f);
});

console.log("\n" + (failed ? "❌ 失败 " + failed + " 项" : "✅ 全部通过"));
process.exit(failed ? 1 : 0);
