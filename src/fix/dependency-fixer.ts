import { execFile as nodeExecFile } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import { scanProject } from "../cli/scan.js";
import { parseLockfile } from "../inventory/lockfile-parser.js";
import type {
  Advisory,
  AdvisoryEvent,
  AdvisoryRange,
  LockfileKind,
  VerificationResult,
} from "../types.js";
import {
  createSandboxSnapshot,
  removeSandboxSnapshot,
  SandboxVerificationService,
} from "../verify/sandbox.js";
import { UpgradePlanner } from "./upgrade-planner.js";

const execFile = promisify(nodeExecFile);
const LOCKFILE_NAMES: Record<LockfileKind, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
};

export type DependencyFixStatus =
  "NO_FINDING" | "NO_SAFE_UPGRADE" | "VERIFIED" | "FAILED" | "INCONCLUSIVE";

export interface DependencyFixResult {
  status: DependencyFixStatus;
  dependencyName?: string;
  advisoryId?: string;
  targetVersion?: string;
  message: string;
  changedFiles?: string[];
  verification?: VerificationResult;
}

export interface FixCommand {
  cwd: string;
  args: string[];
  timeoutMs: number;
}

export interface FixCommandResult {
  exitCode: number;
  stdout?: string;
}

export interface FixCommandExecutor {
  run(command: FixCommand): Promise<FixCommandResult>;
}

export interface DependencyFixerOptions {
  scan?: typeof scanProject;
  planner?: UpgradePlanner;
  verifier?: Pick<SandboxVerificationService, "verify">;
  execute?: FixCommandExecutor;
}

export async function fixDependency(
  projectPath: string,
  advisoryId?: string,
  options: DependencyFixerOptions = {},
): Promise<DependencyFixResult> {
  const root = path.resolve(projectPath);
  const scan = options.scan ?? scanProject;
  const findings = await scan(root);
  const candidates = findings
    .filter(
      ({ reachability, advisory }) =>
        reachability.verdict === "REACHABLE" &&
        (!advisoryId ||
          advisory.id === advisoryId ||
          advisory.aliases.includes(advisoryId)),
    )
    .sort(
      (left, right) =>
        left.dependency.name.localeCompare(right.dependency.name) ||
        left.advisory.id.localeCompare(right.advisory.id),
    );

  if (candidates.length === 0) {
    const matchingUncertain = advisoryId
      ? findings.find(
          ({ advisory }) =>
            advisory.id === advisoryId || advisory.aliases.includes(advisoryId),
        )
      : undefined;
    if (matchingUncertain) {
      return {
        status: "INCONCLUSIVE",
        dependencyName: matchingUncertain.dependency.name,
        advisoryId: matchingUncertain.advisory.id,
        message:
          "The requested advisory is not proven reachable; no dependency files were changed.",
      };
    }
    return {
      status: "NO_FINDING",
      message: advisoryId
        ? `No reachable finding matches advisory ${advisoryId}.`
        : "No reachable vulnerable dependencies were found.",
    };
  }

  const finding = candidates[0];
  if (!finding) {
    return {
      status: "NO_FINDING",
      message: "No eligible finding was selected.",
    };
  }
  const targetVersion = findFixedVersion(
    finding.advisory,
    finding.dependency.name,
    finding.dependency.version,
  );
  if (!targetVersion) {
    return {
      status: "NO_SAFE_UPGRADE",
      dependencyName: finding.dependency.name,
      advisoryId: finding.advisory.id,
      message:
        "OSV does not provide an unambiguous fixed semver version for this finding; no dependency files were changed.",
    };
  }

  let baseline: string | undefined;
  let candidate: string | undefined;
  try {
    baseline = await createSandboxSnapshot(root);
    candidate = await createSandboxSnapshot(root);
    let inventory;
    try {
      inventory = await parseLockfile(candidate);
    } catch {
      return {
        status: "INCONCLUSIVE",
        dependencyName: finding.dependency.name,
        advisoryId: finding.advisory.id,
        targetVersion,
        message: "The staged project has no supported lockfile.",
      };
    }
    const lockfileKind = inventory.lockfile.kind;

    const planner = options.planner ?? new UpgradePlanner();
    const plan = await planner.createPlan(
      candidate,
      finding.dependency.name,
      targetVersion,
      lockfileKind,
    );
    await planner.applyPlan(candidate, plan);

    const executor = options.execute ?? defaultExecutor;
    const updateCommand =
      lockfileKind === "npm"
        ? [
            "npm",
            "install",
            "--package-lock-only",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org",
          ]
        : [
            "pnpm",
            "install",
            "--lockfile-only",
            "--ignore-scripts",
            "--registry=https://registry.npmjs.org",
          ];
    let updateResult: FixCommandResult;
    try {
      updateResult = await executor.run({
        cwd: candidate,
        args: updateCommand,
        timeoutMs: 300_000,
      });
    } catch {
      return {
        status: "INCONCLUSIVE",
        dependencyName: finding.dependency.name,
        advisoryId: finding.advisory.id,
        targetVersion,
        message:
          "Could not update the staged lockfile without lifecycle scripts; no project files were changed.",
      };
    }
    if (updateResult.exitCode !== 0) {
      return {
        status: "FAILED",
        dependencyName: finding.dependency.name,
        advisoryId: finding.advisory.id,
        targetVersion,
        message:
          "The package manager could not update the staged lockfile; no project files were changed.",
      };
    }

    const verifier = options.verifier ?? new SandboxVerificationService();
    const verification = await verifier.verify(
      baseline,
      candidate,
      finding.dependency.name,
      targetVersion,
    );
    if (verification.status !== "VERIFIED") {
      return {
        status: verification.status,
        dependencyName: finding.dependency.name,
        advisoryId: finding.advisory.id,
        targetVersion,
        message: `Staged upgrade was not applied: ${verification.message}`,
        verification,
      };
    }

    const changedFiles = await applyVerifiedFiles(
      root,
      candidate,
      LOCKFILE_NAMES[lockfileKind],
    );
    return {
      status: "VERIFIED",
      dependencyName: finding.dependency.name,
      advisoryId: finding.advisory.id,
      targetVersion,
      message: verification.message,
      verification,
      changedFiles,
    };
  } finally {
    await Promise.all(
      [baseline, candidate]
        .filter((snapshot): snapshot is string => snapshot !== undefined)
        .map(removeSandboxSnapshot),
    );
  }
}

export function findFixedVersion(
  advisory: Advisory,
  dependencyName: string,
  installedVersion: string,
): string | undefined {
  if (!semver.valid(installedVersion)) {
    return undefined;
  }
  const fixedVersions = advisory.affected
    .filter(
      (affected) =>
        affected.ecosystem === "npm" && affected.name === dependencyName,
    )
    .flatMap(({ ranges }) =>
      ranges
        .filter(({ type }) => type === "SEMVER")
        .flatMap((range) => fixedEventsAfter(range, installedVersion)),
    )
    .filter(
      (version) =>
        semver.valid(version) !== null && semver.gt(version, installedVersion),
    )
    .sort(semver.compare);
  return fixedVersions.at(-1);
}

function fixedEventsAfter(
  range: AdvisoryRange,
  installedVersion: string,
): string[] {
  const fixes: string[] = [];
  let introduced: string | undefined;
  for (const event of range.events) {
    if (event.introduced !== undefined) {
      introduced = event.introduced;
      continue;
    }
    if (
      event.fixed !== undefined &&
      isInAffectedInterval(event, introduced, installedVersion)
    ) {
      fixes.push(event.fixed);
    }
    introduced = undefined;
  }
  return fixes;
}

function isInAffectedInterval(
  event: AdvisoryEvent,
  introduced: string | undefined,
  version: string,
): boolean {
  const fixed = event.fixed;
  if (!fixed || !semver.valid(fixed) || !semver.valid(version)) {
    return false;
  }
  const startsAtZero = introduced === "*" || introduced === "0";
  const startsAtVersion = introduced ? semver.valid(introduced) : undefined;
  if (introduced !== undefined && !startsAtZero && !startsAtVersion) {
    return false;
  }
  return (
    (startsAtZero ||
      !startsAtVersion ||
      semver.gte(version, startsAtVersion)) &&
    semver.lt(version, fixed)
  );
}

async function applyVerifiedFiles(
  projectPath: string,
  candidatePath: string,
  lockfileName: string,
): Promise<string[]> {
  const files = ["package.json", lockfileName];
  const originalContents = new Map<string, Buffer>();
  const stagingDirectory = await mkdtemp(
    path.join(projectPath, ".reachfix-apply-"),
  );
  const replacements = files.map((fileName) => ({
    fileName,
    staged: path.join(stagingDirectory, fileName),
    destination: path.join(projectPath, fileName),
  }));
  const applied: typeof replacements = [];
  try {
    for (const { fileName, staged, destination } of replacements) {
      originalContents.set(destination, await readFile(destination));
      await copyFile(path.join(candidatePath, fileName), staged);
    }
    for (const replacement of replacements) {
      await rename(replacement.staged, replacement.destination);
      applied.push(replacement);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const { destination } of applied.reverse()) {
      try {
        const content = originalContents.get(destination);
        if (content) {
          await writeFile(destination, content);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Could not apply verified dependency files or fully restore the originals.",
      );
    }
    throw new Error("Could not apply verified dependency files.", {
      cause: error,
    });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  return files.map((fileName) => path.join(projectPath, fileName));
}

const defaultExecutor: FixCommandExecutor = {
  async run({ cwd, args, timeoutMs }) {
    const command = args[0];
    if (!command) {
      throw new Error("A lockfile update command is required.");
    }
    try {
      const result = await execFile(command, args.slice(1), {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      });
      return { exitCode: 0, stdout: result.stdout };
    } catch (error) {
      if (isCommandExit(error)) {
        return { exitCode: error.code };
      }
      throw error;
    }
  },
};

function isCommandExit(
  error: unknown,
): error is Error & { code: number; stdout: string; stderr: string } {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "number" &&
    "stdout" in error &&
    typeof error.stdout === "string" &&
    "stderr" in error &&
    typeof error.stderr === "string"
  );
}
