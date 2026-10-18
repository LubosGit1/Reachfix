export type LockfileKind = "npm" | "pnpm";

export interface DependencyNode {
  name: string;
  version: string;
  lockfilePath: string;
  isDirect: boolean;
  dependencies: string[];
}

export interface DependencyInventory {
  projectPath: string;
  lockfile: {
    kind: LockfileKind;
    version: string;
  };
  dependencies: DependencyNode[];
}

export interface AdvisoryEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

export interface AdvisoryRange {
  type: string;
  events: AdvisoryEvent[];
}

export interface AdvisoryAffectedPackage {
  ecosystem: string;
  name: string;
  ranges: AdvisoryRange[];
  versions: string[];
}

export interface Advisory {
  id: string;
  aliases: string[];
  summary: string;
  details: string;
  published?: string;
  modified?: string;
  affected: AdvisoryAffectedPackage[];
}

export interface AdvisoryFinding {
  dependency: DependencyNode;
  advisories: Advisory[];
}

export type ReachabilityVerdict = "REACHABLE" | "NOT_REACHABLE" | "UNKNOWN";

export interface ImportEvidence {
  filePath: string;
  line?: number;
  importType: "import" | "require" | "dynamic-import" | "export";
  statement: string;
}

export interface ImportReachabilityResult {
  dependencyName: string;
  verdict: ReachabilityVerdict;
  reason: string;
  evidence: ImportEvidence[];
}

export interface ScanResult {
  dependency: DependencyNode;
  advisory: Advisory;
  reachability: ImportReachabilityResult;
}

export type ScanFailThreshold = "reachable" | "unknown" | "any" | "never";

export interface BenchmarkCase {
  id: string;
  repository: string;
  commit: string;
  advisoryId: string;
  expectedVerdict: ReachabilityVerdict;
  rationale: string;
}

export interface BenchmarkCaseResult {
  caseId: string;
  repository: string;
  commit: string;
  advisoryId: string;
  expectedVerdict: ReachabilityVerdict;
  actualVerdict: ReachabilityVerdict;
  npmAuditVulnerabilityCount: number;
  reachfixFindingCount: number;
  elapsedMs: number;
  apiCostUsd: number | null;
  fixAttempted: boolean;
  fixVerified: boolean;
  reason: string;
}

export interface BenchmarkMetrics {
  caseCount: number;
  reachableGroundTruthCount: number;
  reachablePredictionsPreserved: number;
  reachablePredictionsLost: number;
  falseReachableCount: number;
  reachabilityRecall: number | null;
  reachablePrecision: number | null;
  npmAuditVulnerabilityCount: number;
  reachfixReportedCount: number;
  alertReduction: number | null;
  fixAttemptCount: number;
  verifiedFixCount: number;
  fixSuccessRate: number | null;
  medianTimeMs: number;
  averageApiCostUsd: number | null;
}

export interface BenchmarkRun {
  schemaVersion: "1.0";
  startedAt: string;
  completedAt: string;
  datasetPath: string;
  results: BenchmarkCaseResult[];
  metrics: BenchmarkMetrics;
}

export type FixStrategy = "upgrade" | "override" | "manual-code-fix";

export interface UpgradePlan {
  strategy: FixStrategy;
  dependencyName: string;
  targetVersion: string;
  filePath: string;
  packageSection:
    | "dependencies"
    | "devDependencies"
    | "optionalDependencies"
    | "overrides"
    | "pnpm.overrides";
}

export type VerificationStatus = "VERIFIED" | "FAILED" | "INCONCLUSIVE";

export interface VerificationResult {
  status: VerificationStatus;
  dependencyName: string;
  version: string;
  expectedVersion: string;
  message: string;
}
