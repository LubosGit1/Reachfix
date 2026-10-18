import { describe, expect, it, vi } from "vitest";
import type {
  Advisory,
  AdvisoryFinding,
  DependencyInventory,
  DependencyNode,
} from "../../src/types.js";
import { scanProject } from "../../src/cli/scan.js";

const advisory: Advisory = {
  id: "GHSA-fixture-1234",
  aliases: [],
  summary: "Fixture advisory",
  details: "",
  affected: [],
};

function dependency(isDirect: boolean): DependencyNode {
  return {
    name: "vulnerable",
    version: "1.0.0",
    lockfilePath: "node_modules/vulnerable",
    isDirect,
    dependencies: [],
  };
}

const inventory: DependencyInventory = {
  projectPath: "/fixture",
  lockfile: { kind: "npm", version: "3" },
  dependencies: [dependency(false)],
};

function finding(node: DependencyNode): AdvisoryFinding {
  return { dependency: node, advisories: [advisory] };
}

describe("scan pipeline", () => {
  it("combines vulnerability findings with call-path reachability", async () => {
    const reachabilityAnalyzer = {
      analyze: vi.fn().mockResolvedValue({
        dependencyName: "vulnerable",
        verdict: "REACHABLE",
        reason: "The exported symbol is called.",
        evidence: [
          {
            filePath: "/fixture/src/index.ts",
            importType: "import",
            statement: 'import { run } from "vulnerable";',
          },
        ],
      }),
    };

    const results = await scanProject("/fixture", {
      lockfileParser: { parse: vi.fn().mockResolvedValue(inventory) },
      advisoryClient: {
        findVulnerabilities: vi
          .fn()
          .mockResolvedValue([finding(dependency(true))]),
      },
      reachabilityAnalyzer,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      advisory: { id: "GHSA-fixture-1234" },
      reachability: { verdict: "REACHABLE" },
    });
    expect(reachabilityAnalyzer.analyze).toHaveBeenCalledWith(
      "/fixture",
      "vulnerable",
    );
  });

  it("promotes unanalyzed transitive call paths to UNKNOWN, never NOT_REACHABLE", async () => {
    const results = await scanProject("/fixture", {
      lockfileParser: { parse: vi.fn().mockResolvedValue(inventory) },
      advisoryClient: {
        findVulnerabilities: vi
          .fn()
          .mockResolvedValue([finding(dependency(false))]),
      },
      reachabilityAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "NOT_REACHABLE",
          reason: "No app source imports it.",
          evidence: [],
        }),
      },
      importAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "NOT_REACHABLE",
          reason: "No literal import was found.",
          evidence: [],
        }),
      },
    });

    expect(results[0]?.reachability.verdict).toBe("UNKNOWN");
    expect(results[0]?.reachability.reason).toContain("transitive");
  });

  it("preserves UNKNOWN when dynamic imports make reachability uncertain", async () => {
    const results = await scanProject("/fixture", {
      lockfileParser: { parse: vi.fn().mockResolvedValue(inventory) },
      advisoryClient: {
        findVulnerabilities: vi
          .fn()
          .mockResolvedValue([finding(dependency(true))]),
      },
      reachabilityAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "NOT_REACHABLE",
          reason: "No calls found.",
          evidence: [],
        }),
      },
      importAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "UNKNOWN",
          reason: "Computed require in source.",
          evidence: [
            {
              filePath: "/fixture/src/plugin.js",
              importType: "require",
              statement: "require(name)",
            },
          ],
        }),
      },
    });

    expect(results[0]?.reachability.verdict).toBe("UNKNOWN");
  });

  it("uses positive import evidence when call-path analysis misses an alias", async () => {
    const results = await scanProject("/fixture", {
      lockfileParser: { parse: vi.fn().mockResolvedValue(inventory) },
      advisoryClient: {
        findVulnerabilities: vi
          .fn()
          .mockResolvedValue([finding(dependency(true))]),
      },
      reachabilityAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "NOT_REACHABLE",
          reason: "The imported symbol alias was not recognized.",
          evidence: [],
        }),
      },
      importAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "REACHABLE",
          reason: "A literal import was found.",
          evidence: [
            {
              filePath: "/fixture/src/index.js",
              importType: "require",
              statement: "const alias = require('vulnerable');",
            },
          ],
        }),
      },
    });

    expect(results[0]?.reachability).toMatchObject({
      verdict: "REACHABLE",
      reason: "A literal import was found.",
    });
  });

  it("reports re-exported packages as UNKNOWN because consumers are external", async () => {
    const results = await scanProject("/fixture", {
      lockfileParser: { parse: vi.fn().mockResolvedValue(inventory) },
      advisoryClient: {
        findVulnerabilities: vi
          .fn()
          .mockResolvedValue([finding(dependency(true))]),
      },
      reachabilityAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "NOT_REACHABLE",
          reason: "No local calls found.",
          evidence: [],
        }),
      },
      importAnalyzer: {
        analyze: vi.fn().mockResolvedValue({
          dependencyName: "vulnerable",
          verdict: "REACHABLE",
          reason: "The dependency is re-exported.",
          evidence: [
            {
              filePath: "/fixture/src/index.ts",
              importType: "export",
              statement: 'export { run } from "vulnerable";',
            },
          ],
        }),
      },
    });

    expect(results[0]?.reachability.verdict).toBe("UNKNOWN");
    expect(results[0]?.reachability.reason).toContain("external consumers");
  });
});
