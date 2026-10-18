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
  "dist",
  "build",
  "coverage",
  "node_modules",
  "vendor",
]);

export class CallPathAnalyzer {
  async analyze(
    projectPath: string,
    dependencyName: string,
  ): Promise<ImportReachabilityResult> {
    const root = path.resolve(projectPath);
    const files = await this.collectSourceFiles(root);
    const importedSymbols = new Map<string, string[]>();
    const directEvidence: ImportEvidence[] = [];

    for (const filePath of files) {
      const source = await readFile(filePath, "utf8");
      const imports = extractImportedSymbols(source, filePath, dependencyName);
      if (imports.length === 0) {
        continue;
      }
      for (const entry of imports) {
        directEvidence.push(entry.evidence);
        importedSymbols.set(entry.name, [
          ...(importedSymbols.get(entry.name) ?? []),
          entry.evidence.statement,
        ]);
      }
    }

    if (directEvidence.length === 0) {
      return {
        dependencyName,
        verdict: "NOT_REACHABLE",
        reason: `No imports to ${dependencyName} were found in the project source tree.`,
        evidence: [],
      };
    }

    const symbolUses: ImportEvidence[] = [];
    for (const filePath of files) {
      const source = await readFile(filePath, "utf8");
      for (const symbol of [...importedSymbols.keys()]) {
        const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`, "g");
        if (pattern.test(source)) {
          symbolUses.push({
            filePath,
            importType: "import",
            statement: `call:${symbol}`,
          });
        }
        const namespacePattern = new RegExp(
          `\\b${escapeRegExp(symbol)}\\s*\\.[A-Za-z_$][\\w$]*\\s*\\(`,
          "g",
        );
        if (namespacePattern.test(source)) {
          symbolUses.push({
            filePath,
            importType: "import",
            statement: `namespace-call:${symbol}`,
          });
        }
      }
    }

    if (symbolUses.length > 0) {
      return {
        dependencyName,
        verdict: "REACHABLE",
        reason: `The imported ${dependencyName} symbol is invoked from project code.`,
        evidence: directEvidence.concat(symbolUses),
      };
    }

    return {
      dependencyName,
      verdict: "NOT_REACHABLE",
      reason: `The dependency is imported, but none of its symbols are not called during execution.`,
      evidence: directEvidence,
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

interface ImportedSymbolEntry {
  name: string;
  evidence: ImportEvidence;
}

function extractImportedSymbols(
  source: string,
  filePath: string,
  dependencyName: string,
): ImportedSymbolEntry[] {
  const references: ImportedSymbolEntry[] = [];
  const patterns = [
    /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
    /import\s+([^\s]+)\s+from\s+["']([^"']+)["']/g,
    /import\s+\*\s+as\s+([^\s]+)\s+from\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /export\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
  ] as const;

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const importedTarget = match[match.length - 1];
      if (!importedTarget || importedTarget !== dependencyName) {
        continue;
      }
      if (pattern.toString().includes("{")) {
        const names = match[1]
          ?.split(",")
          .map((name) =>
            name
              .trim()
              .split(/\s+as\s+/)
              .at(-1)
              ?.trim(),
          )
          .filter(Boolean) as string[];
        for (const name of names) {
          references.push({
            name,
            evidence: {
              filePath,
              importType: "import",
              statement: match[0],
            },
          });
        }
        continue;
      }
      const importedName = match[1]?.trim();
      if (!importedName) {
        continue;
      }
      references.push({
        name: importedName,
        evidence: {
          filePath,
          importType: "require",
          statement: match[0],
        },
      });
    }
  }

  return references;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
