import path from "node:path";
import type { ScanResult } from "../types.js";

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number };
  };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations?: SarifLocation[];
  properties: {
    packageName: string;
    installedVersion: string;
    reachability: string;
    advisoryUrl: string;
  };
}

export interface SarifReport {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json";
  version: "2.1.0";
  runs: [
    {
      tool: {
        driver: {
          name: "reachfix";
          informationUri: "https://github.com/LubosGit1/Reachfix";
          rules: Array<{
            id: string;
            name: string;
            shortDescription: { text: string };
            fullDescription: { text: string };
            helpUri: string;
            properties: { tags: string[] };
          }>;
        };
      };
      results: SarifResult[];
    },
  ];
}

export function createSarifReport(
  results: ScanResult[],
  projectPath: string,
): SarifReport {
  const rules = new Map<
    string,
    SarifReport["runs"][0]["tool"]["driver"]["rules"][number]
  >();
  for (const { advisory } of results) {
    if (rules.has(advisory.id)) {
      continue;
    }
    rules.set(advisory.id, {
      id: advisory.id,
      name: advisory.id,
      shortDescription: {
        text: advisory.summary || `Vulnerable dependency: ${advisory.id}`,
      },
      fullDescription: {
        text: advisory.details || advisory.summary || advisory.id,
      },
      helpUri: `https://osv.dev/vulnerability/${encodeURIComponent(advisory.id)}`,
      properties: { tags: ["security", "vulnerability"] },
    });
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "reachfix",
            informationUri: "https://github.com/LubosGit1/Reachfix",
            rules: [...rules.values()],
          },
        },
        results: results.map((result) => toSarifResult(result, projectPath)),
      },
    ],
  };
}

export function renderSarifReport(report: SarifReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function toSarifResult(result: ScanResult, projectPath: string): SarifResult {
  const { dependency, advisory, reachability } = result;
  const level =
    reachability.verdict === "REACHABLE"
      ? "error"
      : reachability.verdict === "UNKNOWN"
        ? "warning"
        : "note";
  const evidence = reachability.evidence[0];
  const filePath = evidence
    ? relativeArtifactPath(path.resolve(projectPath), evidence.filePath)
    : undefined;

  return {
    ruleId: advisory.id,
    level,
    message: {
      text: `${dependency.name}@${dependency.version}: ${advisory.summary || advisory.id}. Reachability: ${reachability.verdict}. ${reachability.reason}`,
    },
    ...(filePath
      ? {
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: filePath },
                ...(evidence?.line
                  ? { region: { startLine: evidence.line } }
                  : {}),
              },
            },
          ],
        }
      : {}),
    properties: {
      packageName: dependency.name,
      installedVersion: dependency.version,
      reachability: reachability.verdict,
      advisoryUrl: `https://osv.dev/vulnerability/${encodeURIComponent(advisory.id)}`,
    },
  };
}

function relativeArtifactPath(projectPath: string, filePath: string): string {
  const relative = path
    .relative(projectPath, filePath)
    .split(path.sep)
    .join("/");
  if (
    relative.startsWith("../") ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    return path.basename(filePath);
  }
  return relative;
}
