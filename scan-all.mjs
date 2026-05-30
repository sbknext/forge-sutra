// One-off: scan the brain/echo/forge ecosystem repos, stash each graph, print a summary.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const REPOS = [
  ["dashboard",      "/Users/sam/Documents/saas/brain-dashboard"],
  ["claude-fuse",    "/Users/sam/Documents/saas/brain/claude-fuse"],
  ["brain-core",     "/Users/sam/Documents/saas/brain/brain-core"],
  ["brain-mcp",      "/Users/sam/Documents/saas/brain/brain-mcp"],
  ["brain-debug",    "/Users/sam/Documents/saas/brain/brain-debug"],
  ["brain-telegram", "/Users/sam/Documents/saas/brain/brain-telegram"],
  ["bots",           "/Users/sam/Documents/saas/brain/bots"],
  ["mcp-site",       "/Users/sam/Documents/saas/mcp-site"],
  ["corebrain",      "/Users/sam/Documents/saas/corebrain"],
  ["forge-social",   "/Users/sam/Documents/saas/forge-social"],
  ["forge-linkedin", "/Users/sam/Documents/saas/forge-linkedin"],
  ["forge-site",     "/Users/sam/Documents/saas/forge-site"],
];

fs.mkdirSync(".sutra/all", { recursive: true });
const rows = [];

for (const [name, path] of REPOS) {
  if (!fs.existsSync(path)) { rows.push([name, "—no dir—"]); continue; }
  try {
    execFileSync("node", ["dist/cli.js", "scan", path], { stdio: "ignore" });
    fs.copyFileSync(".sutra/graph.json", `.sutra/all/${name}.json`);
    const g = JSON.parse(fs.readFileSync(`.sutra/all/${name}.json`, "utf8"));
    const kinds = {};
    for (const i of g.issues) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
    rows.push([name, g.nodes.length, g.edges.length, g.issues.length, kinds]);
  } catch (e) {
    rows.push([name, "FAIL", String(e.message).split("\n")[0]]);
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("repo", 16)}${pad("nodes", 7)}${pad("edges", 7)}${pad("issues", 8)}kinds`);
for (const r of rows) {
  if (r.length === 2) { console.log(`${pad(r[0], 16)}${r[1]}`); continue; }
  if (r[1] === "FAIL") { console.log(`${pad(r[0], 16)}FAIL: ${r[2]}`); continue; }
  const [name, n, e, iss, kinds] = r;
  const ks = Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join(" ") || "clean";
  console.log(`${pad(name, 16)}${pad(n, 7)}${pad(e, 7)}${pad(iss, 8)}${ks}`);
}
