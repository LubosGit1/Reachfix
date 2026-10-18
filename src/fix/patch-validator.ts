import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { FixError } from "./errors.js";
import { GeneratedFixSchema } from "./patch-schema.js";

const PACKAGE_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
] as const;

export interface PatchValidationOptions {
  projectPath: string;
  allowedCallSitePaths: string[];
  dependencyName: string;
  targetVersion: string;
}

export interface ValidatedPatch {
  files: Map<string, string>;
  originalFiles: Map<string, string>;
  rationale: string;
  changedFiles: string[];
}

interface ParsedFilePatch {
  filePath: string;
  hunks: ParsedHunk[];
}

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newCount: number;
  lines: ParsedHunkLine[];
}

interface ParsedHunkLine {
  kind: "context" | "remove" | "add";
  content: string;
}

export async function validateGeneratedFix(
  candidate: unknown,
  options: PatchValidationOptions,
): Promise<ValidatedPatch> {
  if (!semver.valid(options.targetVersion)) {
    throw new FixError(
      "INVALID_CONTEXT",
      "The target dependency version must be a valid semantic version.",
    );
  }
  const parsed = GeneratedFixSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new FixError(
      "INVALID_MODEL_OUTPUT",
      "The model response did not match the required fix schema.",
      { cause: parsed.error },
    );
  }

  const allowedPaths = new Set(
    options.allowedCallSitePaths.map((filePath) =>
      normalizeRelativePath(filePath),
    ),
  );
  allowedPaths.add("package.json");

  const patches = parseUnifiedDiff(parsed.data.unifiedDiff);
  const patchPaths = patches.map((patch) => patch.filePath);
  const changedFiles = parsed.data.changedFiles.map(normalizeRelativePath);
  if (
    new Set(patchPaths).size !== patchPaths.length ||
    new Set(changedFiles).size !== changedFiles.length ||
    !sameSet(patchPaths, changedFiles)
  ) {
    throw new FixError(
      "PATCH_REJECTED",
      "The diff file paths must exactly match the unique changedFiles list.",
    );
  }

  for (const filePath of patchPaths) {
    if (!allowedPaths.has(filePath) || isSensitivePath(filePath)) {
      throw new FixError(
        "PATCH_REJECTED",
        `The diff attempts to modify a file outside the permitted call sites: ${filePath}.`,
      );
    }
  }

  const projectRoot = path.resolve(options.projectPath);
  const outputFiles = new Map<string, string>();
  const originalFiles = new Map<string, string>();
  for (const patch of patches) {
    const absolutePath = path.resolve(projectRoot, patch.filePath);
    if (!isWithinRoot(projectRoot, absolutePath)) {
      throw new FixError(
        "PATCH_REJECTED",
        `The diff path escapes the project root: ${patch.filePath}.`,
      );
    }
    let original: string;
    let canonicalPath: string;
    try {
      const [resolvedRoot, resolvedFile] = await Promise.all([
        realpath(projectRoot),
        realpath(absolutePath),
      ]);
      if (!isWithinRoot(resolvedRoot, resolvedFile)) {
        throw new FixError(
          "PATCH_REJECTED",
          `The diff path resolves outside the project root: ${patch.filePath}.`,
        );
      }
      canonicalPath = resolvedFile;
      original = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (error instanceof FixError) {
        throw error;
      }
      throw new FixError(
        "PATCH_REJECTED",
        `The diff targets a file that does not exist: ${patch.filePath}.`,
        { cause: error },
      );
    }
    const updated = applyHunks(original, patch.hunks, patch.filePath);
    if (patch.filePath === "package.json") {
      validateManifestChange(original, updated, options);
    } else {
      validateAddedDependencies(
        original,
        updated,
        options.dependencyName,
        patch.filePath,
      );
    }
    outputFiles.set(canonicalPath, updated);
    originalFiles.set(canonicalPath, original);
  }

  return {
    files: outputFiles,
    originalFiles,
    rationale: parsed.data.rationale,
    changedFiles: patchPaths,
  };
}

export async function applyValidatedPatch(
  patch: ValidatedPatch,
): Promise<void> {
  try {
    for (const [filePath, expected] of patch.originalFiles) {
      if ((await readFile(filePath, "utf8")) !== expected) {
        throw new FixError(
          "PATCH_APPLY_FAILED",
          "A call-site file changed after the generated diff was validated.",
        );
      }
    }
    for (const [filePath, content] of patch.files) {
      await writeFile(filePath, content, "utf8");
    }
  } catch (error) {
    if (error instanceof FixError) {
      throw error;
    }
    throw new FixError(
      "PATCH_APPLY_FAILED",
      "Could not apply the validated model patch.",
      { cause: error },
    );
  }
}

function parseUnifiedDiff(diff: string): ParsedFilePatch[] {
  const lines = diff.replaceAll("\r\n", "\n").split("\n");
  const patches: ParsedFilePatch[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index]) {
      index += 1;
      continue;
    }
    const header = lines[index]?.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!header) {
      throw new FixError(
        "PATCH_REJECTED",
        "The model output is not a supported unified diff.",
      );
    }
    const oldPath = normalizeRelativePath(header[1] ?? "");
    const newPath = normalizeRelativePath(header[2] ?? "");
    if (oldPath !== newPath || isSensitivePath(oldPath)) {
      throw new FixError(
        "PATCH_REJECTED",
        "File additions, deletions, renames, and sensitive paths are not permitted.",
      );
    }
    index += 1;

    if (lines[index]?.startsWith("index ")) {
      index += 1;
    }
    if (
      lines[index] !== `--- a/${oldPath}` ||
      lines[index + 1] !== `+++ b/${newPath}`
    ) {
      throw new FixError(
        "PATCH_REJECTED",
        "Each changed file must have matching original and updated file headers.",
      );
    }
    index += 2;

    const hunks: ParsedHunk[] = [];
    while (index < lines.length && lines[index]?.startsWith("@@ ")) {
      const hunkHeader = lines[index]?.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/,
      );
      if (!hunkHeader) {
        throw new FixError(
          "PATCH_REJECTED",
          "The diff contains an invalid hunk header.",
        );
      }
      const hunk: ParsedHunk = {
        oldStart: Number(hunkHeader[1]),
        oldCount: Number(hunkHeader[2] ?? "1"),
        newCount: Number(hunkHeader[4] ?? "1"),
        lines: [],
      };
      index += 1;
      while (
        index < lines.length &&
        !lines[index]?.startsWith("@@ ") &&
        !lines[index]?.startsWith("diff --git ")
      ) {
        const line = lines[index] ?? "";
        if (line.startsWith("\\ No newline at end of file")) {
          index += 1;
          continue;
        }
        const prefix = line[0];
        if (prefix !== " " && prefix !== "-" && prefix !== "+") {
          break;
        }
        hunk.lines.push({
          kind: prefix === " " ? "context" : prefix === "-" ? "remove" : "add",
          content: line.slice(1),
        });
        index += 1;
      }
      const actualOldCount = hunk.lines.filter(
        (line) => line.kind !== "add",
      ).length;
      const actualNewCount = hunk.lines.filter(
        (line) => line.kind !== "remove",
      ).length;
      if (
        actualOldCount !== hunk.oldCount ||
        actualNewCount !== hunk.newCount
      ) {
        throw new FixError(
          "PATCH_REJECTED",
          "The diff hunk line counts do not match its header.",
        );
      }
      hunks.push(hunk);
    }
    if (hunks.length === 0) {
      throw new FixError(
        "PATCH_REJECTED",
        "A changed file must contain at least one hunk.",
      );
    }
    patches.push({ filePath: oldPath, hunks });
  }

  if (patches.length === 0) {
    throw new FixError("PATCH_REJECTED", "The diff contains no file changes.");
  }
  return patches;
}

function applyHunks(
  original: string,
  hunks: ParsedHunk[],
  filePath: string,
): string {
  const hasFinalNewline = original.endsWith("\n");
  const sourceLines = original.replace(/\n$/, "").split("\n");
  const outputLines: string[] = [];
  let sourceIndex = 0;

  for (const hunk of hunks) {
    const targetIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (targetIndex < sourceIndex || targetIndex > sourceLines.length) {
      throw new FixError(
        "PATCH_REJECTED",
        `The diff has an overlapping or out-of-range hunk in ${filePath}.`,
      );
    }
    outputLines.push(...sourceLines.slice(sourceIndex, targetIndex));
    sourceIndex = targetIndex;

    for (const line of hunk.lines) {
      if (line.kind === "add") {
        outputLines.push(line.content);
        continue;
      }
      if (sourceLines[sourceIndex] !== line.content) {
        throw new FixError(
          "PATCH_REJECTED",
          `The diff context does not match the current contents of ${filePath}.`,
        );
      }
      if (line.kind === "context") {
        outputLines.push(line.content);
      }
      sourceIndex += 1;
    }
  }

  outputLines.push(...sourceLines.slice(sourceIndex));
  return `${outputLines.join("\n")}${hasFinalNewline ? "\n" : ""}`;
}

function validateManifestChange(
  beforeText: string,
  afterText: string,
  options: PatchValidationOptions,
): void {
  let before: unknown;
  let after: unknown;
  try {
    before = JSON.parse(beforeText) as unknown;
    after = JSON.parse(afterText) as unknown;
  } catch (error) {
    throw new FixError(
      "PATCH_REJECTED",
      "A model change to package.json must leave valid JSON.",
      { cause: error },
    );
  }
  if (!isRecord(before) || !isRecord(after)) {
    throw new FixError(
      "PATCH_REJECTED",
      "A model change to package.json must preserve an object.",
    );
  }

  const strippedBefore = structuredClone(before);
  const strippedAfter = structuredClone(after);
  const changedEntries: { section: string; value: unknown }[] = [];
  for (const section of PACKAGE_SECTIONS) {
    const beforeSection = asMutableRecord(strippedBefore[section]);
    const afterSection = asMutableRecord(strippedAfter[section]);
    const beforeValue = beforeSection?.[options.dependencyName];
    const afterValue = afterSection?.[options.dependencyName];
    if (beforeValue !== afterValue) {
      changedEntries.push({ section, value: afterValue });
    }
    delete beforeSection?.[options.dependencyName];
    delete afterSection?.[options.dependencyName];
  }
  if (JSON.stringify(strippedBefore) !== JSON.stringify(strippedAfter)) {
    throw new FixError(
      "PATCH_REJECTED",
      "The package.json diff may only change the dependency being fixed.",
    );
  }
  if (changedEntries.length === 0) {
    return;
  }
  if (
    changedEntries.length !== 1 ||
    typeof changedEntries[0]?.value !== "string"
  ) {
    throw new FixError(
      "PATCH_REJECTED",
      "The package.json diff may change the target dependency in only one section.",
    );
  }
  const requestedRange = semver.validRange(changedEntries[0].value);
  const minimumVersion = requestedRange
    ? semver.minVersion(requestedRange)
    : null;
  if (!minimumVersion || semver.lt(minimumVersion, options.targetVersion)) {
    throw new FixError(
      "PATCH_REJECTED",
      `The package.json change does not select ${options.dependencyName} ${options.targetVersion} or later.`,
    );
  }
}

function validateAddedDependencies(
  before: string,
  after: string,
  allowedDependency: string,
  filePath: string,
): void {
  const existing = new Set(extractPackageSpecifiers(before));
  const added = extractPackageSpecifiers(after).filter(
    (specifier) => !existing.has(specifier),
  );
  const forbidden = added.filter(
    (specifier) => packageNameFromSpecifier(specifier) !== allowedDependency,
  );
  if (
    forbidden.length > 0 ||
    countComputedModuleLoads(after) > countComputedModuleLoads(before)
  ) {
    throw new FixError(
      "PATCH_REJECTED",
      `The diff in ${filePath} introduces an unapproved dependency import.`,
    );
  }
}

function countComputedModuleLoads(source: string): number {
  const pattern = /\b(?:require|import)\s*\(\s*[^"'`\s]/g;
  return [...source.matchAll(pattern)].length;
}

function extractPackageSpecifiers(source: string): string[] {
  const references = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return references.flatMap((pattern) =>
    [...source.matchAll(pattern)]
      .map((match) => match[1])
      .filter(
        (specifier): specifier is string =>
          typeof specifier === "string" &&
          !specifier.startsWith(".") &&
          !specifier.startsWith("/") &&
          !specifier.startsWith("node:"),
      ),
  );
}

function packageNameFromSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new FixError(
      "PATCH_REJECTED",
      `Invalid relative file path: ${filePath}.`,
    );
  }
  return normalized;
}

function isSensitivePath(filePath: string): boolean {
  return (
    filePath === ".reachfixignore" ||
    filePath.split("/").some((part) => /^\.env[^/]*$/i.test(part)) ||
    filePath
      .split("/")
      .some((part) => part === ".git" || part === "node_modules") ||
    /\.(?:pem|key)$/i.test(filePath)
  );
}

function isWithinRoot(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function sameSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function asMutableRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
