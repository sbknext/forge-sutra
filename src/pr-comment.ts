/**
 * PR comment Markdown formatter for scan --check gate results.
 */

import type { GateResult } from "./gate.js";

/** Format gate delta as Markdown for CI PR comments (no network I/O). */
export function formatPrComment(result: GateResult): string {
  const lines: string[] = ["## Sutra structural gate (candidate)", ""];

  if (result.newErrors.length === 0 && result.newWarns.length === 0 && result.newInfos.length === 0) {
    lines.push("No new structural issues vs baseline.");
  }

  if (result.newErrors.length > 0) {
    lines.push("### New error-severity issues");
    for (const iss of result.newErrors) {
      lines.push(`- **${iss.kind}** → \`${iss.node}\` (${iss.feature})`);
    }
    lines.push("");
  }

  if (result.newWarns.length > 0) {
    lines.push("<details>");
    lines.push("<summary>New warn-severity issues</summary>");
    lines.push("");
    for (const iss of result.newWarns) {
      lines.push(`- ${iss.kind} → \`${iss.node}\``);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (result.newInfos.length > 0) {
    lines.push("<details>");
    lines.push("<summary>New info-severity issues</summary>");
    lines.push("");
    for (const iss of result.newInfos) {
      lines.push(`- ${iss.kind} → \`${iss.node}\``);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push(
    `Resolved in snapshot: ${result.resolvedCount} · Gate: ${result.exitCode === 0 ? "PASS" : "FAIL"}`,
  );

  return lines.join("\n");
}
