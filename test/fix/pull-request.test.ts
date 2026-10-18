import { describe, expect, it, vi } from "vitest";
import {
  assertCleanGitWorktree,
  createFixPullRequest,
} from "../../src/fix/pull-request.js";
import type {
  DependencyFixResult,
  FixCommand,
  FixCommandExecutor,
  FixCommandResult,
} from "../../src/fix/dependency-fixer.js";

function executor(
  run: (command: FixCommand) => Promise<FixCommandResult>,
): FixCommandExecutor {
  return { run };
}

const verifiedFix: DependencyFixResult = {
  status: "VERIFIED",
  dependencyName: "vulnerable",
  advisoryId: "GHSA-test-1234",
  targetVersion: "2.2.0",
  message: "Baseline and candidate checks passed.",
  changedFiles: ["/project/package.json", "/project/package-lock.json"],
};

describe("verified fix pull requests", () => {
  it("requires an initially clean worktree", async () => {
    const run = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: " M README.md\n",
    });
    await expect(
      assertCleanGitWorktree("/project", executor(run)),
    ).rejects.toThrow("existing changes");
  });

  it("commits only verified dependency files and opens a PR", async () => {
    const commands: FixCommand[] = [];
    const run = vi.fn(async (command: FixCommand) => {
      commands.push(command);
      if (command.args[1] === "status") {
        return {
          exitCode: 0,
          stdout: " M package.json\n M package-lock.json\n",
        };
      }
      if (command.args[0] === "gh") {
        return {
          exitCode: 0,
          stdout: "https://github.com/owner/repo/pull/1\n",
        };
      }
      return { exitCode: 0 };
    });
    const url = await createFixPullRequest(
      "/project",
      verifiedFix,
      executor(run),
    );

    expect(url).toBe("https://github.com/owner/repo/pull/1");
    expect(commands.map(({ args }) => args[0])).toEqual([
      "git",
      "git",
      "git",
      "git",
      "git",
      "gh",
    ]);
    expect(commands[2]?.args).toEqual(
      expect.arrayContaining(["package.json", "package-lock.json"]),
    );
    expect(commands[5]?.args).toContain("--body");
    expect(commands[5]?.args.join(" ")).toContain(
      "Baseline and candidate checks passed.",
    );
  });

  it("refuses a pull request for an unverified fix", async () => {
    await expect(
      createFixPullRequest(
        "/project",
        { ...verifiedFix, status: "INCONCLUSIVE" },
        executor(async () => ({ exitCode: 0 })),
      ),
    ).rejects.toThrow("requires an applied, verified");
  });

  it("refuses to commit unrelated worktree changes", async () => {
    const run = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: " M package.json\n M README.md\n",
    });
    await expect(
      createFixPullRequest("/project", verifiedFix, executor(run)),
    ).rejects.toThrow("refusing to commit unrelated");
  });
});
