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
