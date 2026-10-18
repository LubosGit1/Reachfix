import { OsvAdvisoryClient } from "../advisories/osv-client.js";
import { parseLockfile } from "../inventory/lockfile-parser.js";
import type { LockfileParser } from "../inventory/lockfile-parser.js";
import { CallPathAnalyzer } from "../reachability/call-path-analyzer.js";
import { ImportReachabilityAnalyzer } from "../reachability/import-analyzer.js";
import type { AdvisoryFinding, ScanResult } from "../types.js";

export interface ScanServices {
  advisoryClient?: Pick<OsvAdvisoryClient, "findVulnerabilities">;
  lockfileParser?: LockfileParser;
  reachabilityAnalyzer?: Pick<CallPathAnalyzer, "analyze">;
  importAnalyzer?: Pick<ImportReachabilityAnalyzer, "analyze">;
}

export async function scanProject(
  projectPath: string,
  services: ScanServices = {},
): Promise<ScanResult[]> {
  const inventory = services.lockfileParser
    ? await services.lockfileParser.parse(projectPath)
    : await parseLockfile(projectPath);
  const findings: AdvisoryFinding[] = await (
    services.advisoryClient ?? new OsvAdvisoryClient()
  ).findVulnerabilities(inventory.dependencies);
  const analyzer = services.reachabilityAnalyzer ?? new CallPathAnalyzer();
  const importAnalyzer =
    services.importAnalyzer ?? new ImportReachabilityAnalyzer();
  const result: ScanResult[] = [];

  for (const finding of findings) {
    let reachability = await analyzer.analyze(
      inventory.projectPath,
      finding.dependency.name,
    );
    if (reachability.verdict === "NOT_REACHABLE") {
      const importReachability = await importAnalyzer.analyze(
        inventory.projectPath,
        finding.dependency.name,
      );
      if (importReachability.verdict === "UNKNOWN") {
        reachability = importReachability;
      } else if (
        importReachability.evidence.some(
          (evidence) => evidence.importType === "export",
        )
      ) {
        reachability = {
          ...importReachability,
          verdict: "UNKNOWN",
          reason:
            "The dependency is re-exported; its external consumers are not known to this scan.",
        };
      } else if (!finding.dependency.isDirect) {
        reachability = {
          ...reachability,
          verdict: "UNKNOWN",
          reason:
            "The vulnerable dependency is transitive; its callers inside node_modules have not yet been analyzed.",
        };
      }
    }
    for (const advisory of finding.advisories) {
      result.push({
        dependency: finding.dependency,
        advisory,
        reachability,
      });
    }
  }

  return result;
}
