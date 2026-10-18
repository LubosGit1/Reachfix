import { execFile as nodeExecFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DependencyFixResult,
  FixCommandExecutor,
} from "./dependency-fixer.js";

const execFile = promisify(nodeExecFile);

export async function assertCleanGitWorktree(
  projectPath: string,
  executor: FixCommandExecutor = defaultExecutor,
): Promise<void> {
  const status = await runCommand(
    executor,
    projectPath,
    ["git", "status", "--porcelain"],
    "Could not check Git worktree status.",
  );
  if (status.stdout?.trim()) {
    throw new Error(
      "The Git worktree has existing changes. Commit or stash them before asking reachfix to create a fix pull request.",
    );
  }
}

export async function createFixPullRequest(
  projectPath: string,
  result: DependencyFixResult,
  executor: FixCommandExecutor = defaultExecutor,
): Promise<string> {
  if (
    result.status !== "VERIFIED" ||
    !result.dependencyName ||
    !result.targetVersion ||
    !result.changedFiles?.length
  ) {
    throw new Error(
      "A pull request requires an applied, verified dependency fix.",
    );
  }

  const root = path.resolve(projectPath);
  const relativeFiles = result.changedFiles.map((filePath) => {
    const relativePath = path.relative(root, path.resolve(filePath));
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error(
        "A verified fix file is outside the Git project directory.",
      );
    }
    return relativePath;
  });
  const expected = new Set(relativeFiles);
  const status = await runCommand(
    executor,
    root,
    ["git", "status", "--porcelain"],
    "Could not check changed files before creating the pull request.",
  );
  const actual = (status.stdout ?? "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim());
  if (
    actual.length !== expected.size ||
    actual.some((filePath) => !expected.has(filePath))
  ) {
    throw new Error(
      "The worktree changed beyond the verified dependency files; refusing to commit unrelated changes.",
    );
  }

  const dependencySlug = result.dependencyName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const branch = `reachfix/${dependencySlug}-${Date.now()}`;
  const title = `fix: upgrade ${result.dependencyName} to ${result.targetVersion}`;
  const body = [
    "## Summary",
    "",
    `- Upgrade \`${result.dependencyName}\` to \`${result.targetVersion}\`.`,
    `- Advisory: ${result.advisoryId ?? "not specified"}.`,
    "",
    "## Verification",
    "",
    result.message,
    "",
    "The dependency install ran with lifecycle scripts disabled. Baseline and candidate checks ran in resource-limited Docker containers with network access disabled.",
  ].join("\n");

  await runCommand(
    executor,
    root,
    ["git", "switch", "-c", branch],
    "Could not create a branch for the verified fix.",
  );
  await runCommand(
    executor,
    root,
    ["git", "add", "--", ...relativeFiles],
    "Could not stage the verified dependency files.",
  );
  await runCommand(
    executor,
    root,
    ["git", "commit", "-m", title],
    "Could not commit the verified dependency fix.",
  );
  await runCommand(
    executor,
    root,
    ["git", "push", "--set-upstream", "origin", branch],
    "Could not push the verified fix branch.",
  );
  const created = await runCommand(
    executor,
    root,
    ["gh", "pr", "create", "--title", title, "--body", body],
    "Could not create the GitHub pull request.",
  );
  return created.stdout?.trim() ?? "";
}

async function runCommand(
  executor: FixCommandExecutor,
  cwd: string,
  args: string[],
  failureMessage: string,
): Promise<{ stdout?: string }> {
  const result = await executor.run({ cwd, args, timeoutMs: 120_000 });
  if (result.exitCode !== 0) {
    throw new Error(failureMessage);
  }
  return result;
}

const defaultExecutor: FixCommandExecutor = {
  async run({ cwd, args, timeoutMs }) {
    const command = args[0];
    if (!command) {
      throw new Error("A command is required.");
    }
    try {
      const result = await execFile(command, args.slice(1), {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      });
      return { exitCode: 0, stdout: result.stdout };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        typeof error.code === "number"
      ) {
        return { exitCode: error.code };
      }
      throw error;
    }
  },
};
