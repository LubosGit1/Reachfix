import type { ScanResult } from "../types.js";

export function renderTerminalReport(results: ScanResult[]): string {
  if (results.length === 0) {
    return "No vulnerable dependencies found.\n";
  }

  const rows = results.map(({ dependency, advisory, reachability }) => ({
    package: `${dependency.name}@${dependency.version}`,
    advisory: advisory.id,
    verdict: reachability.verdict,
    path: reachability.evidence[0]?.filePath ?? "-",
  }));
  const widths = {
    package: Math.max(
      "PACKAGE".length,
      ...rows.map((row) => row.package.length),
    ),
    advisory: Math.max(
      "ADVISORY".length,
      ...rows.map((row) => row.advisory.length),
    ),
    verdict: Math.max(
      "REACHABILITY".length,
      ...rows.map((row) => row.verdict.length),
    ),
    path: Math.max("EVIDENCE".length, ...rows.map((row) => row.path.length)),
  };
  const lines = [
    `${"PACKAGE".padEnd(widths.package)}  ${"ADVISORY".padEnd(widths.advisory)}  ${"REACHABILITY".padEnd(widths.verdict)}  EVIDENCE`,
    `${"-".repeat(widths.package)}  ${"-".repeat(widths.advisory)}  ${"-".repeat(widths.verdict)}  ${"-".repeat(widths.path)}`,
    ...rows.map(
      (row) =>
        `${row.package.padEnd(widths.package)}  ${row.advisory.padEnd(widths.advisory)}  ${row.verdict.padEnd(widths.verdict)}  ${row.path}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
