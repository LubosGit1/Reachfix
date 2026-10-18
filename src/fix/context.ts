import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Advisory } from "../types.js";
import { FixError } from "./errors.js";

const DEFAULT_EXCLUDED_FILE = /(?:^|\/)\.env[^/]*$|\.(?:pem|key)$/i;

export interface FixCallSite {
  filePath: string;
  line?: number;
}

export interface FixContextInput {
  projectPath: string;
  advisory: Advisory;
  dependencyName: string;
  fromVersion: string;
  targetVersion: string;
  callSites: FixCallSite[];
  releaseNotes?: string;
  typeDefinitions?: string;
}

export interface FixContextFile {
  path: string;
  content: string;
  callSiteLines: number[];
}

export interface FixContext {
  advisory: Advisory;
  dependencyName: string;
  fromVersion: string;
  targetVersion: string;
  releaseNotes: string;
  typeDefinitions: string;
  files: FixContextFile[];
}

export class FixContextBuilder {
  async build(input: FixContextInput): Promise<FixContext> {
    const projectRoot = path.resolve(input.projectPath);
    const ignorePatterns = await readIgnorePatterns(projectRoot);
    const siteMap = new Map<string, number[]>();

    for (const callSite of input.callSites) {
      const relativePath = toProjectRelativePath(
        projectRoot,
        callSite.filePath,
      );
      if (isExcluded(relativePath, ignorePatterns)) {
        throw new FixError(
          "INVALID_CONTEXT",
          `A call-site file is excluded from model context: ${relativePath}.`,
        );
      }
      try {
        const [resolvedRoot, resolvedFile] = await Promise.all([
          realpath(projectRoot),
          realpath(path.join(projectRoot, relativePath)),
        ]);
        const resolvedRelative = path.relative(resolvedRoot, resolvedFile);
        if (
          resolvedRelative === ".." ||
          resolvedRelative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(resolvedRelative)
        ) {
          throw new FixError(
            "INVALID_CONTEXT",
            `A call-site path resolves outside the target project: ${relativePath}.`,
          );
        }
      } catch (error) {
        if (error instanceof FixError) {
          throw error;
        }
        throw new FixError(
          "INVALID_CONTEXT",
          `Could not safely resolve the requested call-site file: ${relativePath}.`,
          { cause: error },
        );
      }
      const lines = siteMap.get(relativePath) ?? [];
      if (
        callSite.line !== undefined &&
        Number.isInteger(callSite.line) &&
        callSite.line > 0
      ) {
        lines.push(callSite.line);
      }
      siteMap.set(relativePath, lines);
    }

    const files = await Promise.all(
      [...siteMap].map(async ([relativePath, callSiteLines]) => {
        let content: string;
        try {
          content = await readFile(
            path.join(projectRoot, relativePath),
            "utf8",
          );
        } catch (error) {
          throw new FixError(
            "INVALID_CONTEXT",
            `Could not read the requested call-site file: ${relativePath}.`,
            { cause: error },
          );
        }
        return {
          path: relativePath,
          content,
          callSiteLines: [...new Set(callSiteLines)].sort((a, b) => a - b),
        };
      }),
    );

    return {
      advisory: input.advisory,
      dependencyName: input.dependencyName,
      fromVersion: input.fromVersion,
      targetVersion: input.targetVersion,
      releaseNotes: input.releaseNotes ?? "",
      typeDefinitions: input.typeDefinitions ?? "",
      files,
    };
  }
}

async function readIgnorePatterns(projectRoot: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(path.join(projectRoot, ".reachfixignore"), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new FixError(
      "INVALID_CONTEXT",
      "Could not read the project's .reachfixignore file.",
      { cause: error },
    );
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function toProjectRelativePath(projectRoot: string, filePath: string): string {
  const absolutePath = path.resolve(projectRoot, filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new FixError(
      "INVALID_CONTEXT",
      "A call-site file must be located inside the target project.",
    );
  }
  const normalized = relativePath.split(path.sep).join("/");
  if (
    DEFAULT_EXCLUDED_FILE.test(normalized) ||
    normalized === ".reachfixignore"
  ) {
    throw new FixError(
      "INVALID_CONTEXT",
      `A sensitive or configuration file cannot be sent as model context: ${normalized}.`,
    );
  }
  return normalized;
}

function isExcluded(relativePath: string, patterns: string[]): boolean {
  if (
    DEFAULT_EXCLUDED_FILE.test(relativePath) ||
    relativePath === ".reachfixignore" ||
    relativePath
      .split("/")
      .some((part) => part === ".git" || part === "node_modules")
  ) {
    return true;
  }
  return patterns.some((pattern) =>
    matchesIgnorePattern(pattern, relativePath),
  );
}

function matchesIgnorePattern(pattern: string, relativePath: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^\//, "");
  if (normalizedPattern.endsWith("/")) {
    return relativePath.startsWith(normalizedPattern);
  }
  let expression = "";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === "*" && normalizedPattern[index + 1] === "*") {
      if (normalizedPattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegExp(character ?? "");
    }
  }
  return new RegExp(`^(?:${expression}|.*/${expression})$`).test(relativePath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
