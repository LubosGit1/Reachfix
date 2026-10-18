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
    const importedSymbols: ImportedSymbolEntry[] = [];
    const directEvidence: ImportEvidence[] = [];

    for (const filePath of files) {
      const source = await readFile(filePath, "utf8");
      const imports = extractImportedSymbols(source, filePath, dependencyName);
      if (imports.length === 0) {
        continue;
      }
      for (const entry of imports) {
        directEvidence.push(entry.evidence);
        importedSymbols.push(entry);
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
      for (const symbol of importedSymbols) {
        if (symbol.namespace) {
          const memberPattern = new RegExp(
            `\\b${escapeRegExp(symbol.localName)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`,
            "g",
          );
          for (const match of source.matchAll(memberPattern)) {
            const member = match[1];
            if (member) {
              symbolUses.push({
                filePath,
                line: lineAt(source, match.index ?? 0),
                importType: "import",
                statement: `${symbol.localName}.${member}()`,
              });
            }
          }
        }
        const pattern = new RegExp(
          `\\b${escapeRegExp(symbol.localName)}\\s*\\(`,
          "g",
        );
        for (const match of source.matchAll(pattern)) {
          symbolUses.push({
            filePath,
            line: lineAt(source, match.index ?? 0),
            importType: "import",
            statement:
              symbol.importedName === symbol.localName
                ? `${symbol.localName}()`
                : `${symbol.localName}() imports ${symbol.importedName}`,
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
      reason:
        "The dependency is imported, but no supported calls to its imported symbols were found.",
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
  localName: string;
  importedName: string;
  namespace: boolean;
  evidence: ImportEvidence;
}

function extractImportedSymbols(
  source: string,
  filePath: string,
  dependencyName: string,
): ImportedSymbolEntry[] {
  const references: ImportedSymbolEntry[] = [];
  const namedImports = /\bimport\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(namedImports)) {
    if (match[2] !== dependencyName) {
      continue;
    }
    for (const item of match[1]?.split(",") ?? []) {
      const parts = item.trim().split(/\s+as\s+/);
      const importedName = parts[0]?.trim();
      const localName = parts.at(-1)?.trim();
      if (!importedName || !localName || importedName === "type") {
        continue;
      }
      references.push({
        localName,
        importedName,
        namespace: false,
        evidence: importEvidence(source, filePath, match),
      });
    }
  }

  const namespaceImports = [
    /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g,
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g,
  ];
  for (const pattern of namespaceImports) {
    for (const match of source.matchAll(pattern)) {
      if (match[2] !== dependencyName || !match[1]) {
        continue;
      }
      references.push({
        localName: match[1],
        importedName: "default",
        namespace: true,
        evidence: importEvidence(source, filePath, match),
      });
    }
  }

  const destructuredRequires =
    /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(destructuredRequires)) {
    if (match[2] !== dependencyName) {
      continue;
    }
    for (const item of match[1]?.split(",") ?? []) {
      const parts = item.trim().split(/\s*:\s*/);
      const importedName = parts[0]?.trim();
      const localName = parts.at(-1)?.trim();
      if (!importedName || !localName) {
        continue;
      }
      references.push({
        localName,
        importedName,
        namespace: false,
        evidence: importEvidence(source, filePath, match),
      });
    }
  }

  const assignedRequires =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(assignedRequires)) {
    if (match[2] !== dependencyName || !match[1]) {
      continue;
    }
    references.push({
      localName: match[1],
      importedName: "default",
      namespace: true,
      evidence: importEvidence(source, filePath, match),
    });
  }

  return references;
}

function importEvidence(
  source: string,
  filePath: string,
  match: RegExpMatchArray,
): ImportEvidence {
  return {
    filePath,
    line: lineAt(source, match.index ?? 0),
    importType: match[0].startsWith("import") ? "import" : "require",
    statement: match[0],
  };
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
