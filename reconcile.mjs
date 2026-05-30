// Cross-repo reconciliation (Phase-1 preview): do echo-ai's /api+/auth calls have a brain-api backend?
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const echo = JSON.parse(fs.readFileSync(".sutra/all/echo-ai.json", "utf8"));
const api = JSON.parse(fs.readFileSync(".sutra/all/brain-api.json", "utf8"));
const BRAIN_API = "/Users/sam/Documents/saas/brain/brain-api";

const parse = (s) => {
  const m = String(s).match(/^(\w+)\s+(\/\S*)/);
  if (!m) return null;
  let [, method, path] = m;
  path = path.split("?")[0].replace(/\/+$/, "") || "/";
  return { method: method.toUpperCase(), path, segs: path.split("/").filter(Boolean) };
};

const calls = [...new Set(
  echo.issues.filter(i => i.kind === "orphaned_endpoint").map(i => i.node)
    .filter(n => /\s\/(api|auth)\//.test(n))
)].map(parse).filter(Boolean);

const eps = api.nodes.filter(n => n.type === "endpoint")
  .map(n => parse(n.name || n.data_shape)).filter(Boolean)
  // drop overly-broad mount points (e.g. "ANY /api", "ANY /auth") — they match everything and tell us nothing
  .filter(ep => ep.segs.length >= 2);

const dyn = (s) => /^[:\[]/.test(s); // :id or [id]
// ep covers call if method compatible AND ep segments are a prefix of call segments
const segMatch = (a, b) => a === b || dyn(a) || dyn(b);
function covered(call) {
  return eps.some(ep => {
    if (ep.method !== "ANY" && ep.method !== call.method) return false;
    if (ep.segs.length > call.segs.length) return false;
    return ep.segs.every((s, i) => segMatch(s, call.segs[i]));
  });
}
// source-grep fallback: distinctive tail (last non-dynamic segment) present in brain-api routes?
function grepBackend(call) {
  const tail = [...call.segs].reverse().find(s => !dyn(s));
  if (!tail) return false;
  try {
    const out = execFileSync("grep", ["-rl", "--include=*.js", tail, `${BRAIN_API}/routes`, `${BRAIN_API}/index.js`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().length > 0;
  } catch { return false; }
}

const matched = [], gaps = [];
for (const c of calls) {
  const key = `${c.method} ${c.path}`;
  if (covered(c)) matched.push(key);
  else if (grepBackend(c)) matched.push(key + "  (via source grep)");
  else gaps.push(key);
}

console.log(`echo calls checked: ${calls.length}`);
console.log(`covered by brain-api: ${matched.length}`);
console.log(`GENUINE GAPS (no backend found): ${gaps.length}`);
console.log("\n--- gaps ---");
gaps.forEach(g => console.log("  " + g));
console.log("\n--- matched via source-grep only (weak match, verify) ---");
matched.filter(m => m.includes("source grep")).forEach(m => console.log("  " + m));
