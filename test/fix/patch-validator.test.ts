import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixError } from "../../src/fix/errors.js";
import {
  applyValidatedPatch,
  validateGeneratedFix,
} from "../../src/fix/patch-validator.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createProject(): Promise<string> {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), "reachfix-patch-test-"),
  );
  temporaryPaths.push(projectPath);
  await writeFile(
    path.join(projectPath, "src.ts"),
    "export const value = 1;\n",
  );
  await writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ dependencies: { vulnerable: "^2.0.0" } }, null, 2) + "\n",
  );
  return projectPath;
}

const validSourceDiff = [
  "diff --git a/src.ts b/src.ts",
  "--- a/src.ts",
  "+++ b/src.ts",
  "@@ -1 +1 @@",
  "-export const value = 1;",
  "+export const value = 2;",
].join("\n");

function modelFix(unifiedDiff: string, changedFiles: string[] = ["src.ts"]) {
  return {
    unifiedDiff,
    changedFiles,
    rationale: "Update the vulnerable call site.",
  };
}

describe("generated fix validation", () => {
  it("validates then applies an exact call-site diff", async () => {
    const projectPath = await createProject();
    const patch = await validateGeneratedFix(modelFix(validSourceDiff), {
      projectPath,
      allowedCallSitePaths: ["src.ts"],
      dependencyName: "vulnerable",
      targetVersion: "2.2.0",
    });

    await applyValidatedPatch(patch);

    await expect(
      readFile(path.join(projectPath, "src.ts"), "utf8"),
    ).resolves.toBe("export const value = 2;\n");
  });

  it("does not overwrite a file changed after validation", async () => {
    const projectPath = await createProject();
    const patch = await validateGeneratedFix(modelFix(validSourceDiff), {
      projectPath,
      allowedCallSitePaths: ["src.ts"],
      dependencyName: "vulnerable",
      targetVersion: "2.2.0",
    });
    await writeFile(
      path.join(projectPath, "src.ts"),
      "export const value = 9;\n",
    );

    await expect(applyValidatedPatch(patch)).rejects.toMatchObject({
      code: "PATCH_APPLY_FAILED",
    });
    await expect(
      readFile(path.join(projectPath, "src.ts"), "utf8"),
    ).resolves.toBe("export const value = 9;\n");
  });

  it("rejects paths not listed as call sites", async () => {
    const projectPath = await createProject();
    const diff = validSourceDiff.replaceAll("src.ts", "README.md");

    await expect(
      validateGeneratedFix(modelFix(diff, ["README.md"]), {
        projectPath,
        allowedCallSitePaths: ["src.ts"],
        dependencyName: "vulnerable",
        targetVersion: "2.2.0",
      }),
    ).rejects.toMatchObject({
      code: "PATCH_REJECTED",
    } satisfies Partial<FixError>);
  });

  it("rejects path traversal even when the model lists that path", async () => {
    const projectPath = await createProject();
    const diff = validSourceDiff.replaceAll("src.ts", "../outside.ts");

    await expect(
      validateGeneratedFix(modelFix(diff, ["../outside.ts"]), {
        projectPath,
        allowedCallSitePaths: ["../outside.ts"],
        dependencyName: "vulnerable",
        targetVersion: "2.2.0",
      }),
    ).rejects.toMatchObject({ code: "PATCH_REJECTED" });
  });

  it("rejects diffs whose context no longer matches the target file", async () => {
    const projectPath = await createProject();
    const staleDiff = validSourceDiff.replace("value = 1", "value = 9");

    await expect(
      validateGeneratedFix(modelFix(staleDiff), {
        projectPath,
        allowedCallSitePaths: ["src.ts"],
        dependencyName: "vulnerable",
        targetVersion: "2.2.0",
      }),
    ).rejects.toMatchObject({ code: "PATCH_REJECTED" });
  });

  it("rejects package.json changes to unrelated dependencies", async () => {
    const projectPath = await createProject();
    const oldLine = '"vulnerable": "^2.0.0"';
    const diff = [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -1,5 +1,6 @@",
      " {",
      '   "dependencies": {',
      `-    ${oldLine}`,
      `+    ${oldLine},`,
      '+    "attacker-controlled": "^1.0.0"',
      "   }",
      " }",
    ].join("\n");

    await expect(
      validateGeneratedFix(modelFix(diff, ["package.json"]), {
        projectPath,
        allowedCallSitePaths: ["src.ts"],
        dependencyName: "vulnerable",
        targetVersion: "2.2.0",
      }),
    ).rejects.toMatchObject({ code: "PATCH_REJECTED" });
  });

  it("rejects new package imports outside the dependency being fixed", async () => {
    const projectPath = await createProject();
    const diff = [
      "diff --git a/src.ts b/src.ts",
      "--- a/src.ts",
      "+++ b/src.ts",
      "@@ -1 +1,2 @@",
      '+import external from "attacker-controlled";',
      " export const value = 1;",
    ].join("\n");

    await expect(
      validateGeneratedFix(modelFix(diff), {
        projectPath,
        allowedCallSitePaths: ["src.ts"],
        dependencyName: "vulnerable",
        targetVersion: "2.2.0",
      }),
    ).rejects.toMatchObject({ code: "PATCH_REJECTED" });
  });
});
