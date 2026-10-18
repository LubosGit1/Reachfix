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
      } else {
        reachability = {
          ...importReachability,
          verdict: "UNKNOWN",
          reason:
            "The dependency is imported, but no supported call to an imported symbol was found.",
        };
      }
    }
    for (const advisory of finding.advisories) {
      const advisoryReachability = matchAdvisorySymbols(reachability, advisory);
      result.push({
        dependency: finding.dependency,
        advisory,
        reachability: advisoryReachability,
      });
    }
  }

  return result;
}

function matchAdvisorySymbols(
  reachability: ScanResult["reachability"],
  advisory: AdvisoryFinding["advisories"][number],
): ScanResult["reachability"] {
  if (reachability.verdict !== "REACHABLE") {
    return reachability;
  }
  const affectedSymbols = extractAdvisorySymbols(
    `${advisory.summary}\n${advisory.details}`,
  );
  if (affectedSymbols.length === 0) {
    return reachability;
  }
  const callEvidence = reachability.evidence.filter(({ statement }) =>
    statement.includes("()"),
  );
  const matchedCalls = callEvidence.filter((evidence) =>
    evidenceSymbols(evidence.statement).some((symbol) =>
      affectedSymbols.includes(symbol),
    ),
  );
  if (matchedCalls.length > 0) {
    return {
      ...reachability,
      evidence: [
        ...reachability.evidence.filter(
          ({ statement }) => !statement.includes("()"),
        ),
        ...matchedCalls,
      ],
    };
  }
  return {
    ...reachability,
    verdict: "UNKNOWN",
    reason:
      "The advisory names affected functions, but none of those function calls were found in project source.",
  };
}

function extractAdvisorySymbols(text: string): string[] {
  const symbols = new Set<string>();
  const excludedSymbols = new Set([
    "constructor",
    "function",
    "imports",
    "object",
    "options",
    "prototype",
    "variable",
  ]);
  for (const match of text.matchAll(/`([^`]+)`/g)) {
    const snippet = match[1]?.trim();
    if (!snippet) {
      continue;
    }
    const symbolMatch = snippet.match(
      /(?:^|\.)([A-Za-z_$][\w$]*)(?:\s*\([^)]*\))?$/,
    );
    const symbol = symbolMatch?.[1]?.toLowerCase();
    if (!symbol || excludedSymbols.has(symbol)) {
      continue;
    }
    const before = text.slice(
      Math.max(0, (match.index ?? 0) - 100),
      match.index,
    );
    const after = text.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 100,
    );
    if (
      snippet.includes(".") ||
      snippet.includes("(") ||
      /\b(?:function|functions|method|methods|called|invoked)\b/i.test(
        `${before} ${after}`,
      )
    ) {
      symbols.add(symbol);
    }
  }
  return [...symbols];
}

function evidenceSymbols(statement: string): string[] {
  const importedName = statement.match(/\bimports\s+([A-Za-z_$][\w$]*)$/)?.[1];
  const memberName = statement.match(/\.([A-Za-z_$][\w$]*)\(\)$/)?.[1];
  const directName = statement.match(/^([A-Za-z_$][\w$]*)\(\)$/)?.[1];
  return [importedName, memberName, directName]
    .filter((symbol): symbol is string => symbol !== undefined)
    .map((symbol) => symbol.toLowerCase());
}
