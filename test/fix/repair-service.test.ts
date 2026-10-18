import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerificationResult } from "../../src/types.js";
import type {
  FixModel,
  FixModelContext,
  FixModelResponse,
} from "../../src/fix/anthropic-client.js";
import { FixRepairService } from "../../src/fix/repair-service.js";

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
    path.join(tmpdir(), "reachfix-repair-test-"),
  );
  temporaryPaths.push(projectPath);
  await writeFile(
    path.join(projectPath, "entry.ts"),
    "export const value = 1;\n",
  );
  return projectPath;
}

function sourcePatch(from: number, to: number) {
  return {
    unifiedDiff: [
      "diff --git a/entry.ts b/entry.ts",
      "--- a/entry.ts",
      "+++ b/entry.ts",
      "@@ -1 +1 @@",
      `-export const value = ${from};`,
      `+export const value = ${to};`,
    ].join("\n"),
    changedFiles: ["entry.ts"],
    rationale: "Update the caller.",
  };
}

class ReplayModel implements FixModel {
  readonly model = "replay-fixture";
  readonly contexts: FixModelContext[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async generateFix(context: FixModelContext): Promise<FixModelResponse> {
    this.contexts.push(structuredClone(context));
    const input = this.outputs.shift();
    if (input === undefined) {
      throw new Error("Replay fixture has no remaining model response.");
    }
    return { input, usage: { inputTokens: 100, outputTokens: 50 } };
  }

  estimateCostUsd(): number {
    return 0.01;
  }

  estimateRequestCostUsd(): number {
    return 0.02;
  }
}

const advisory = {
  id: "GHSA-test-1234",
  aliases: [],
  summary: "Test advisory",
  details: "Test details",
  affected: [],
};

function verifiedResult(
  status: VerificationResult["status"],
  message: string,
): VerificationResult {
  return {
    status,
    dependencyName: "vulnerable",
    version: "2.2.0",
    expectedVersion: "2.2.0",
    message,
  };
}

describe("fix repair service", () => {
  it("replays verification feedback and verifies the second patch", async () => {
    const projectPath = await createProject();
    const model = new ReplayModel([sourcePatch(1, 2), sourcePatch(2, 3)]);
    const baselineContents: string[] = [];
    const verify = vi.fn(
      async (
        _projectPath: string,
        _dependencyName: string,
        _targetVersion: string,
        _attempt: number,
        baselineProjectPath: string,
      ) => {
        baselineContents.push(
          await readFile(path.join(baselineProjectPath, "entry.ts"), "utf8"),
        );
        return baselineContents.length === 1
          ? verifiedResult("FAILED", "Typecheck failed on line 1.")
          : verifiedResult("VERIFIED", "All checks passed.");
      },
    );
    const usage = vi.fn();
    const service = new FixRepairService({ model, verify, onUsage: usage });

    const result = await service.repair({
      projectPath,
      advisory,
      dependencyName: "vulnerable",
      fromVersion: "2.0.0",
      targetVersion: "2.2.0",
      callSites: [{ filePath: "entry.ts", line: 1 }],
      maxCostUsd: 0.1,
    });

    expect(result).toMatchObject({
      status: "VERIFIED",
      attempts: 2,
      estimatedCostUsd: 0.02,
    });
    expect(model.contexts[1]?.verificationFeedback).toContain(
      "Typecheck failed",
    );
    expect(model.contexts[1]?.files[0]?.content).toBe(
      "export const value = 2;\n",
    );
    expect(await readFile(path.join(projectPath, "entry.ts"), "utf8")).toBe(
      "export const value = 3;\n",
    );
    expect(baselineContents).toEqual([
      "export const value = 1;\n",
      "export const value = 1;\n",
    ]);
    expect(usage).toHaveBeenCalledTimes(2);
  });

  it("retries malformed model output instead of applying it", async () => {
    const projectPath = await createProject();
    const model = new ReplayModel([
      { unifiedDiff: "not a patch" },
      sourcePatch(1, 2),
    ]);
    const verify = vi
      .fn()
      .mockResolvedValue(verifiedResult("VERIFIED", "All checks passed."));
    const service = new FixRepairService({ model, verify });

    const result = await service.repair({
      projectPath,
      advisory,
      dependencyName: "vulnerable",
      fromVersion: "2.0.0",
      targetVersion: "2.2.0",
      callSites: [{ filePath: "entry.ts", line: 1 }],
      maxCostUsd: 0.1,
    });

    expect(result).toMatchObject({ status: "VERIFIED", attempts: 2 });
    expect(model.contexts[1]?.verificationFeedback).toContain(
      "required fix schema",
    );
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("stops before a request that would exceed maxCostUsd", async () => {
    const projectPath = await createProject();
    const model = new ReplayModel([sourcePatch(1, 2)]);
    const verify = vi
      .fn()
      .mockResolvedValue(
        verifiedResult("FAILED", "The baseline check failed."),
      );
    const service = new FixRepairService({ model, verify });

    await expect(
      service.repair({
        projectPath,
        advisory,
        dependencyName: "vulnerable",
        fromVersion: "2.0.0",
        targetVersion: "2.2.0",
        callSites: [{ filePath: "entry.ts" }],
        maxCostUsd: 0.025,
      }),
    ).rejects.toMatchObject({ code: "COST_LIMIT_EXCEEDED" });
    expect(model.contexts).toHaveLength(1);
  });

  it("does not retry or report success when verification is inconclusive", async () => {
    const projectPath = await createProject();
    const model = new ReplayModel([sourcePatch(1, 2), sourcePatch(2, 3)]);
    const verify = vi
      .fn()
      .mockResolvedValue(
        verifiedResult("INCONCLUSIVE", "Docker is unavailable."),
      );
    const service = new FixRepairService({ model, verify });

    const result = await service.repair({
      projectPath,
      advisory,
      dependencyName: "vulnerable",
      fromVersion: "2.0.0",
      targetVersion: "2.2.0",
      callSites: [{ filePath: "entry.ts" }],
      maxCostUsd: 0.1,
    });

    expect(result).toMatchObject({
      status: "INCONCLUSIVE",
      attempts: 1,
      error: "Docker is unavailable.",
    });
    expect(model.contexts).toHaveLength(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
