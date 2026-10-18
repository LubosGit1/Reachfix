import type {
  BenchmarkCaseResult,
  BenchmarkMetrics,
  ReachabilityVerdict,
} from "../types.js";

export function calculateBenchmarkMetrics(
  results: BenchmarkCaseResult[],
): BenchmarkMetrics {
  const reachableTruth = results.filter(
    ({ expectedVerdict }) => expectedVerdict === "REACHABLE",
  );
  const preservedReachable = reachableTruth.filter(
    ({ actualVerdict }) => actualVerdict !== "NOT_REACHABLE",
  ).length;
  const reachablePredictions = results.filter(
    ({ actualVerdict }) => actualVerdict === "REACHABLE",
  );
  const correctReachablePredictions = reachablePredictions.filter(
    ({ expectedVerdict }) => expectedVerdict === "REACHABLE",
  ).length;
  const auditCount = sum(
    results.map((result) => result.npmAuditVulnerabilityCount),
  );
  const reachfixCount = sum(
    results.map((result) => result.reachfixFindingCount),
  );
  const fixAttempts = results.filter(({ fixAttempted }) => fixAttempted);
  const verifiedFixes = fixAttempts.filter(
    ({ fixVerified }) => fixVerified,
  ).length;
  const totalApiCost = sum(results.map(({ apiCostUsd }) => apiCostUsd));

  return {
    caseCount: results.length,
    reachableGroundTruthCount: reachableTruth.length,
    reachablePredictionsPreserved: preservedReachable,
    reachablePredictionsLost: reachableTruth.length - preservedReachable,
    falseReachableCount:
      reachablePredictions.length - correctReachablePredictions,
    reachabilityRecall: ratio(preservedReachable, reachableTruth.length),
    reachablePrecision: ratio(
      correctReachablePredictions,
      reachablePredictions.length,
    ),
    npmAuditVulnerabilityCount: auditCount,
    reachfixReportedCount: reachfixCount,
    alertReduction: auditCount > 0 ? 1 - reachfixCount / auditCount : null,
    fixAttemptCount: fixAttempts.length,
    verifiedFixCount: verifiedFixes,
    fixSuccessRate: ratio(verifiedFixes, fixAttempts.length),
    medianTimeMs: median(results.map(({ elapsedMs }) => elapsedMs)),
    averageApiCostUsd: results.length > 0 ? totalApiCost / results.length : 0,
  };
}

export function conservativeVerdict(
  findings: Array<{ verdict: ReachabilityVerdict }> | undefined,
): ReachabilityVerdict {
  if (!findings || findings.length === 0) {
    return "UNKNOWN";
  }
  if (findings.some(({ verdict }) => verdict === "REACHABLE")) {
    return "REACHABLE";
  }
  if (findings.some(({ verdict }) => verdict === "UNKNOWN")) {
    return "UNKNOWN";
  }
  return "NOT_REACHABLE";
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (sorted.length % 2 === 1) {
    return upper ?? 0;
  }
  return ((lower ?? 0) + (upper ?? 0)) / 2;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
