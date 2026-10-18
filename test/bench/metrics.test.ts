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

  it("leaves undefined ratios null when their denominator is zero", () => {
    const metrics = calculateBenchmarkMetrics([]);
    expect(metrics.reachabilityRecall).toBeNull();
    expect(metrics.reachablePrecision).toBeNull();
    expect(metrics.alertReduction).toBeNull();
    expect(metrics.fixSuccessRate).toBeNull();
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
    commit: "0".repeat(40),
    advisoryId: "GHSA-example",
    expectedVerdict,
    actualVerdict,
    npmAuditVulnerabilityCount,
    reachfixFindingCount: 1,
    elapsedMs,
    apiCostUsd: 0,
    fixAttempted: false,
    fixVerified: false,
    reason: "test fixture",
  };
}
