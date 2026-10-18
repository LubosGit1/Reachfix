import { describe, expect, it } from "vitest";
import type { BenchmarkCaseResult } from "../../src/types.js";
import {
  calculateBenchmarkMetrics,
  conservativeVerdict,
} from "../../src/bench/metrics.js";

describe("benchmark metrics", () => {
  it("preserves UNKNOWN predictions when calculating reachability recall", () => {
    const metrics = calculateBenchmarkMetrics([
      makeResult("REACHABLE", "UNKNOWN", 1, 100),
      makeResult("REACHABLE", "REACHABLE", 1, 200),
      makeResult("UNKNOWN", "REACHABLE", 0, 300),
    ]);

    expect(metrics.reachabilityRecall).toBe(1);
    expect(metrics.reachablePrecision).toBe(0.5);
    expect(metrics.alertReduction).toBe(-0.5);
    expect(metrics.medianTimeMs).toBe(200);
  });

  it("returns UNKNOWN when an advisory has no findings", () => {
    expect(conservativeVerdict([])).toBe("UNKNOWN");
    expect(conservativeVerdict(undefined)).toBe("UNKNOWN");
    expect(conservativeVerdict([{ verdict: "NOT_REACHABLE" }])).toBe(
      "NOT_REACHABLE",
    );
  });

  it("counts each repository commit once when cases repeat its totals", () => {
    const first = {
      ...makeResult("REACHABLE", "REACHABLE", 4, 100),
      reachfixFindingCount: 2,
    };
    const repeated = {
      ...first,
      caseId: "same-project-second-advisory",
      elapsedMs: 200,
    };
    const metrics = calculateBenchmarkMetrics([first, repeated]);

    expect(metrics.npmAuditVulnerabilityCount).toBe(4);
    expect(metrics.reachfixReportedCount).toBe(2);
    expect(metrics.alertReduction).toBe(0.5);
    expect(metrics.averageApiCostUsd).toBeNull();
  });

  it("leaves undefined ratios null when their denominator is zero", () => {
    const metrics = calculateBenchmarkMetrics([]);
    expect(metrics.reachabilityRecall).toBeNull();
    expect(metrics.reachablePrecision).toBeNull();
    expect(metrics.alertReduction).toBeNull();
    expect(metrics.fixSuccessRate).toBeNull();
    expect(metrics.averageApiCostUsd).toBeNull();
    expect(metrics.medianTimeMs).toBe(0);
  });
});

function makeResult(
  expectedVerdict: BenchmarkCaseResult["expectedVerdict"],
  actualVerdict: BenchmarkCaseResult["actualVerdict"],
  npmAuditVulnerabilityCount: number,
  elapsedMs: number,
): BenchmarkCaseResult {
  return {
    caseId: `${expectedVerdict}-${actualVerdict}-${elapsedMs}`,
    repository: "https://github.com/owner/repository",
    commit: elapsedMs.toString().padStart(40, "0"),
    advisoryId: "GHSA-example",
    expectedVerdict,
    actualVerdict,
    npmAuditVulnerabilityCount,
    reachfixFindingCount: 1,
    elapsedMs,
    apiCostUsd: null,
    fixAttempted: false,
    fixVerified: false,
    reason: "test fixture",
  };
}
