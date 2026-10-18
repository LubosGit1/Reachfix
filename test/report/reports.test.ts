import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScanResult } from "../../src/types.js";
import { createJsonReport, renderJsonReport } from "../../src/report/json.js";
import { renderMarkdownReport } from "../../src/report/markdown.js";
import {
  createSarifReport,
  renderSarifReport,
} from "../../src/report/sarif.js";
import { renderTerminalReport } from "../../src/report/terminal.js";

const reachableResult: ScanResult = {
  dependency: {
    name: "vulnerable",
    version: "2.0.0",
    lockfilePath: "node_modules/vulnerable",
    isDirect: true,
    dependencies: [],
  },
  advisory: {
    id: "GHSA-test-1234",
    aliases: ["OSV-TEST-1234"],
    summary: "Unsafe | parser",
    details: "An advisory detail.",
    affected: [],
  },
  reachability: {
    dependencyName: "vulnerable",
    verdict: "REACHABLE",
    reason: "A source file imports the dependency.",
    evidence: [
      {
        filePath: "/project/src/index.ts",
        importType: "import",
        statement: 'import { parse } from "vulnerable";',
      },
    ],
  },
};

describe("report renderers", () => {
  it("renders a stable JSON report envelope", () => {
    const report = createJsonReport(
      [reachableResult],
      new Date("2026-01-02T03:04:05Z"),
    );

    expect(report).toMatchObject({
      schemaVersion: "1.0",
      tool: "reachfix",
      scannedAt: "2026-01-02T03:04:05.000Z",
      results: [reachableResult],
    });
    expect(JSON.parse(renderJsonReport(report))).toEqual(report);
  });

  it("renders terminal output and an empty result message", () => {
    expect(renderTerminalReport([reachableResult])).toContain("REACHABLE");
    expect(renderTerminalReport([reachableResult])).toContain("GHSA-test-1234");
    expect(renderTerminalReport([])).toBe(
      "No vulnerable dependencies found.\n",
    );
  });

  it("escapes Markdown table content and describes findings", () => {
    const markdown = renderMarkdownReport([reachableResult]);

    expect(markdown).toContain("`vulnerable@2.0.0`");
    expect(markdown).toContain("Unsafe \\| parser");
    expect(markdown).toContain("**REACHABLE**");
  });

  it("creates SARIF 2.1.0 with rules, severity, and relative source locations", () => {
    const sarif = createSarifReport([reachableResult], "/project");

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0]?.results[0]).toMatchObject({
      ruleId: "GHSA-test-1234",
      level: "error",
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/index.ts" },
          },
        },
      ],
      properties: {
        packageName: "vulnerable",
        installedVersion: "2.0.0",
        reachability: "REACHABLE",
      },
    });
    expect(JSON.parse(renderSarifReport(sarif))).toEqual(sarif);
  });

  it("uses warning severity for unknown reachability and omits unsafe locations", () => {
    const result: ScanResult = {
      ...reachableResult,
      reachability: {
        ...reachableResult.reachability,
        verdict: "UNKNOWN",
        evidence: [],
      },
    };
    const sarif = createSarifReport([result], path.resolve("/project"));

    expect(sarif.runs[0]?.results[0]).toMatchObject({
      level: "warning",
      properties: { reachability: "UNKNOWN" },
    });
    expect(sarif.runs[0]?.results[0]?.locations).toBeUndefined();
  });
});
