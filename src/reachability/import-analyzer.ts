import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportEvidence, ImportReachabilityResult } from "../types.js";

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "node_modules",
  "vendor",
]);

export class ImportReachabilityAnalyzer {
  async analyze(
    projectPath: string,
    dependencyName: string,
  ): Promise<ImportReachabilityResult> {
    const repoRoot = path.resolve(projectPath);
    const files = await this.collectSourceFiles(repoRoot);
    const matches: ImportEvidence[] = [];
    const dynamicUses: ImportEvidence[] = [];

    for (const filePath of files) {
      const source = await readFile(filePath, "utf8");
      const imports = extractImportReferences(source, filePath);

      for (const importMatch of imports) {
        if (matchesDependency(importMatch.packageName, dependencyName)) {
          matches.push(importMatch.evidence);
        }
        if (importMatch.dynamicallyResolved) {
          dynamicUses.push(importMatch.evidence);
        }
      }
    }

    if (matches.length > 0) {
      return {
        dependencyName,
        verdict: "REACHABLE",
        reason: `The application imports ${dependencyName} directly via a literal import or require statement.`,
        evidence: matches,
      };
    }

    if (dynamicUses.length > 0) {
      return {
        dependencyName,
        verdict: "UNKNOWN",
        reason: `The code resolves ${dependencyName} dynamically, so reachability cannot be conclusively proven.`,
        evidence: dynamicUses,
      };
    }

    return {
      dependencyName,
      verdict: "NOT_REACHABLE",
      reason: `No literal import or require of ${dependencyName} was found in the project source tree.`,
      evidence: [],
    };
  }

  private async collectSourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        files.push(...(await this.collectSourceFiles(fullPath)));
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }

    return files;
  }
}

interface ExtractedImportReference {
  packageName: string;
  evidence: ImportEvidence;
  dynamicallyResolved: boolean;
}

function extractImportReferences(
  source: string,
  filePath: string,
): ExtractedImportReference[] {
  const references: ExtractedImportReference[] = [];
  const seen = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:import|export)\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /(?:import|export)\s+\*\s+from\s+["']([^"']+)["']/g,
    /(?:import|export)\s*\{[^}]*\}\s*from\s+["']([^"']+)["']/g,
  ] as const;

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const packageName = match[1];
      if (!packageName) {
        continue;
      }
      const statement = match[0];
      const importType = classifyImportStatement(statement);
      const signature = `${filePath}:${importType}:${statement}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      references.push({
        packageName,
        evidence: {
          filePath,
          importType,
          statement,
        },
        dynamicallyResolved: importType === "dynamic-import",
      });
    }
  }

  const dynamicRequirePattern = /require\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const match of source.matchAll(dynamicRequirePattern)) {
    const variableName = match[1];
    if (!variableName) {
      continue;
    }
    const statement = match[0];
    const signature = `${filePath}:require-dynamic:${statement}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    references.push({
      packageName: variableName,
      evidence: {
        filePath,
        importType: "require",
        statement,
      },
      dynamicallyResolved: true,
    });
  }

  const computedImportPattern = /\bimport\(\s*([^"'`\s][^)]*)\)/g;
  for (const match of source.matchAll(computedImportPattern)) {
    references.push({
      packageName: "",
      evidence: {
        filePath,
        importType: "dynamic-import",
        statement: match[0],
      },
      dynamicallyResolved: true,
    });
  }

  const evalPattern = /\beval\s*\(/g;
  for (const match of source.matchAll(evalPattern)) {
    references.push({
      packageName: "",
      evidence: {
        filePath,
        importType: "require",
        statement: match[0],
      },
      dynamicallyResolved: true,
    });
  }

  return references;
}

function classifyImportStatement(
  statement: string,
): ImportEvidence["importType"] {
  if (statement.startsWith("export")) {
    return "export";
  }
  if (statement.includes("import(")) {
    return "dynamic-import";
  }
  if (statement.startsWith("require(")) {
    return "require";
  }
  return "import";
}

function matchesDependency(
  packageName: string,
  dependencyName: string,
): boolean {
  return (
    packageName === dependencyName ||
    packageName.startsWith(`${dependencyName}/`) ||
    packageName.startsWith(`@${dependencyName}/`)
  );
}
