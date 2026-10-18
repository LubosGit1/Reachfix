import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Advisory, ScanResult } from "../../src/types.js";
import {
  findFixedVersion,
  fixDependency,
  type FixCommand,
  type FixCommandExecutor,
  type FixCommandResult,
} from "../../src/fix/dependency-fixer.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const advisory: Advisory = {
  id: "GHSA-fixture-1234",
  aliases: ["CVE-2026-0001"],
  summary: "Fixture issue",
  details: "",
  affected: [
    {
      ecosystem: "npm",
      name: "vulnerable",
      versions: [],
      ranges: [
        {
          type: "SEMVER",
          events: [{ introduced: "1.0.0" }, { fixed: "2.2.0" }],
        },
      ],
    },
  ],
};

function scanResult(
  verdict: ScanResult["reachability"]["verdict"] = "REACHABLE",
): ScanResult {
  return {
    dependency: {
      name: "vulnerable",
      version: "2.0.0",
      lockfilePath: "node_modules/vulnerable",
      isDirect: true,
      dependencies: [],
    },
    advisory,
    reachability: {
      dependencyName: "vulnerable",
      verdict,
      reason: "test fixture",
      evidence: [],
    },
  };
}

async function createProject(): Promise<string> {
  const projectPath = await mkdtemp(path.join(tmpdir(), "reachfix-fix-test-"));
  temporaryPaths.push(projectPath);
  await writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ dependencies: { vulnerable: "^2.0.0" } }),
  );
  await writeFile(
    path.join(projectPath, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { "node_modules/vulnerable": { version: "2.0.0" } },
    }),
  );
  return projectPath;
}

describe("dependency fixer", () => {
  it("selects the fixed event for the interval containing the installed version", () => {
    const multipleIntervals: Advisory = {
      ...advisory,
      affected: [
        {
          ...advisory.affected[0]!,
          ranges: [
            {
              type: "SEMVER",
              events: [
                { introduced: "1.0.0" },
                { fixed: "2.0.5" },
                { introduced: "2.1.0" },
                { fixed: "2.2.3" },
              ],
            },
          ],
        },
      ],
    };

    expect(findFixedVersion(multipleIntervals, "vulnerable", "2.1.8")).toBe(
      "2.2.3",
    );
    expect(findFixedVersion(advisory, "vulnerable", "2.2.0")).toBeUndefined();
  });

  it("applies package and lockfile changes only after successful verification", async () => {
    const projectPath = await createProject();
    const scan = vi.fn().mockResolvedValue([scanResult()]);
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        status: "VERIFIED",
        dependencyName: "vulnerable",
        version: "2.2.0",
        expectedVersion: "2.2.0",
        message: "Checks passed.",
      }),
    };
    const execute: FixCommandExecutor = {
      async run(command: FixCommand): Promise<FixCommandResult> {
        const manifest = JSON.parse(
          await readFile(path.join(command.cwd, "package.json"), "utf8"),
        ) as { dependencies: Record<string, string> };
        await writeFile(
          path.join(command.cwd, "package-lock.json"),
          JSON.stringify({
            lockfileVersion: 3,
            packages: {
              "node_modules/vulnerable": { version: "2.2.0" },
            },
            rootDependency: manifest.dependencies.vulnerable,
          }),
        );
        return { exitCode: 0 };
      },
    };

    const result = await fixDependency(projectPath, undefined, {
      scan,
      verifier,
      execute,
    });

    expect(result).toMatchObject({
      status: "VERIFIED",
      dependencyName: "vulnerable",
      targetVersion: "2.2.0",
      changedFiles: [
        path.join(projectPath, "package.json"),
        path.join(projectPath, "package-lock.json"),
      ],
    });
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "vulnerable",
      "2.2.0",
    );
    expect(
      JSON.parse(
        await readFile(path.join(projectPath, "package-lock.json"), "utf8"),
      ).packages["node_modules/vulnerable"].version,
    ).toBe("2.2.0");
    expect(
      JSON.parse(await readFile(path.join(projectPath, "package.json"), "utf8"))
        .dependencies.vulnerable,
    ).toBe("^2.2.0");
  });

  it.each(["UNKNOWN", "NOT_REACHABLE"] as const)(
    "does not modify an advisory whose verdict is %s",
    async (verdict) => {
      const projectPath = await createProject();
      const packageBefore = await readFile(
        path.join(projectPath, "package.json"),
        "utf8",
      );
      const result = await fixDependency(projectPath, advisory.id, {
        scan: async () => [scanResult(verdict)],
      });

      expect(result.status).toBe("INCONCLUSIVE");
      expect(
        await readFile(path.join(projectPath, "package.json"), "utf8"),
      ).toBe(packageBefore);
    },
  );

  it("does not change the project when verification fails", async () => {
    const projectPath = await createProject();
    const packageBefore = await readFile(
      path.join(projectPath, "package.json"),
      "utf8",
    );
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        status: "FAILED",
        dependencyName: "vulnerable",
        version: "2.2.0",
        expectedVersion: "2.2.0",
        message: "Tests failed.",
      }),
    };
    const result = await fixDependency(projectPath, undefined, {
      scan: async () => [scanResult()],
      verifier,
      execute: { run: async () => ({ exitCode: 0 }) },
    });

    expect(result.status).toBe("FAILED");
    expect(await readFile(path.join(projectPath, "package.json"), "utf8")).toBe(
      packageBefore,
    );
  });
});
