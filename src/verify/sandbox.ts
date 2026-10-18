import { execFile as nodeExecFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import semver from "semver";
import { z } from "zod";
import { parseLockfile } from "../inventory/lockfile-parser.js";
import type { VerificationResult } from "../types.js";

const execFile = promisify(nodeExecFile);
const ContainerManifestSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
});

type VerificationPhase = "install" | "test" | "build";

export interface SandboxCommand {
  projectPath: string;
  args: string[];
  network: "bridge" | "none";
  timeoutMs: number;
}

export interface SandboxCommandResult {
  exitCode: number;
}

export interface SandboxCommandRunner {
  run(command: SandboxCommand): Promise<SandboxCommandResult>;
}

export interface SandboxVerificationOptions {
  runner?: SandboxCommandRunner;
  image?: string;
  installTimeoutMs?: number;
  checkTimeoutMs?: number;
}

export class DockerSandboxRunner implements SandboxCommandRunner {
  constructor(private readonly image = "node:22-bookworm-slim") {}

  async run(command: SandboxCommand): Promise<SandboxCommandResult> {
    try {
      await execFile("docker", createDockerRunArguments(command, this.image), {
        timeout: command.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      });
      return { exitCode: 0 };
    } catch (error) {
      if (isProcessFailure(error) && typeof error.code === "number") {
        if ([125, 126, 127].includes(error.code)) {
          throw new SandboxUnavailableError(
            "Docker could not start the verification container.",
            { cause: error },
          );
        }
        return { exitCode: error.code };
      }
      throw new SandboxUnavailableError(
        "Could not run the Docker verification sandbox.",
        { cause: error },
      );
    }
  }
}

export function createDockerRunArguments(
  command: SandboxCommand,
  image = "node:22-bookworm-slim",
): string[] {
  const projectPath = path.resolve(command.projectPath);
  const mount = `type=bind,src=${projectPath},dst=/workspace`;
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
  return [
    "run",
    "--rm",
    "--init",
    `--network=${command.network}`,
    "--cpus=2",
    "--memory=2g",
    "--pids-limit=256",
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=512m",
    `--user=${uid}:${gid}`,
    "--mount",
    mount,
    "--workdir=/workspace",
    "--env=HOME=/tmp",
    "--env=CI=true",
    "--env=NPM_CONFIG_IGNORE_SCRIPTS=true",
    image,
    ...command.args,
  ];
}

export class SandboxUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SandboxUnavailableError";
  }
}

export async function createSandboxSnapshot(
  projectPath: string,
): Promise<string> {
  const snapshotDirectory = await mkdtemp(
    path.join(tmpdir(), "reachfix-baseline-"),
  );
  try {
    await copyProject(projectPath, snapshotDirectory);
    return snapshotDirectory;
  } catch (error) {
    await rm(snapshotDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function removeSandboxSnapshot(
  snapshotPath: string,
): Promise<void> {
  await rm(snapshotPath, { recursive: true, force: true });
}

export class SandboxVerificationService {
  private readonly runner: SandboxCommandRunner;
  private readonly installTimeoutMs: number;
  private readonly checkTimeoutMs: number;

  constructor(options: SandboxVerificationOptions = {}) {
    const image = options.image ?? "node:22-bookworm-slim";
    this.runner = options.runner ?? new DockerSandboxRunner(image);
    this.installTimeoutMs = options.installTimeoutMs ?? 300_000;
    this.checkTimeoutMs = options.checkTimeoutMs ?? 600_000;
  }

  async verifyRepair(
    candidateProjectPath: string,
    dependencyName: string,
    expectedVersion: string,
    _attempt: number,
    baselineProjectPath: string,
  ): Promise<VerificationResult> {
    return this.verify(
      baselineProjectPath,
      candidateProjectPath,
      dependencyName,
      expectedVersion,
    );
  }

  async verify(
    baselineProjectPath: string,
    candidateProjectPath: string,
    dependencyName: string,
    expectedVersion: string,
  ): Promise<VerificationResult> {
    const inconclusive = (message: string): VerificationResult => ({
      status: "INCONCLUSIVE",
      dependencyName,
      version: "unknown",
      expectedVersion,
      message,
    });
    if (!semver.valid(expectedVersion)) {
      return inconclusive(
        `The target version ${expectedVersion} is not valid semver.`,
      );
    }

    let inventory;
    try {
      inventory = await parseLockfile(candidateProjectPath);
    } catch {
      return inconclusive(
        "The candidate lockfile could not be parsed for dependency verification.",
      );
    }
    const resolvedVersions = inventory.dependencies
      .filter(({ name }) => name === dependencyName)
      .map(({ version }) => version)
      .filter((version) => semver.valid(version) !== null);
    const vulnerableVersion = resolvedVersions.find(
      (version) => !semver.gte(version, expectedVersion),
    );
    const resolved = [...resolvedVersions].sort(semver.compare).at(-1);
    if (!resolved || vulnerableVersion) {
      return {
        status: "FAILED",
        dependencyName,
        version: vulnerableVersion ?? resolved ?? "not-found",
        expectedVersion,
        message: vulnerableVersion
          ? `${dependencyName} still resolves to vulnerable version ${vulnerableVersion} in the candidate lockfile.`
          : `${dependencyName} is not resolved in the candidate lockfile.`,
      };
    }

    let manifest: z.infer<typeof ContainerManifestSchema>;
    try {
      manifest = ContainerManifestSchema.parse(
        JSON.parse(
          await readFile(
            path.join(candidateProjectPath, "package.json"),
            "utf8",
          ),
        ) as unknown,
      );
    } catch {
      return inconclusive("The candidate package.json could not be validated.");
    }
    if (!manifest.scripts?.test) {
      return inconclusive(
        "The candidate has no test script; sandbox verification requires baseline and candidate tests.",
      );
    }

    const workspace = await mkdtemp(path.join(tmpdir(), "reachfix-verify-"));
    const baseline = path.join(workspace, "baseline");
    const candidate = path.join(workspace, "candidate");
    try {
      await Promise.all([
        copyProject(baselineProjectPath, baseline),
        copyProject(candidateProjectPath, candidate),
      ]);
      const baselineManifest = ContainerManifestSchema.parse(
        JSON.parse(
          await readFile(path.join(baseline, "package.json"), "utf8"),
        ) as unknown,
      );
      if (!baselineManifest.scripts?.test) {
        return inconclusive(
          "The baseline has no test script; sandbox verification requires baseline and candidate tests.",
        );
      }
      if (
        baselineManifest.scripts.test !== manifest.scripts.test ||
        (baselineManifest.scripts.build &&
          baselineManifest.scripts.build !== manifest.scripts.build)
      ) {
        return {
          status: "FAILED",
          dependencyName,
          version: resolved,
          expectedVersion,
          message:
            "Candidate changed the test or build command, so its verification would not be comparable to the baseline.",
        };
      }
      const baselineResult = await this.runChecks(
        baseline,
        inventory.lockfile.kind,
        baselineManifest,
      );
      if (baselineResult) {
        return inconclusive(`Baseline ${baselineResult}`);
      }
      const candidateResult = await this.runChecks(
        candidate,
        inventory.lockfile.kind,
        manifest,
      );
      if (candidateResult) {
        return {
          status: "FAILED",
          dependencyName,
          version: resolved,
          expectedVersion,
          message: `Candidate ${candidateResult}`,
        };
      }
      return {
        status: "VERIFIED",
        dependencyName,
        version: resolved,
        expectedVersion,
        message:
          "The candidate resolves the target dependency and passes the same isolated install, test, and build checks as its baseline.",
      };
    } catch (error) {
      return inconclusive(
        error instanceof SandboxUnavailableError
          ? error.message
          : "Could not stage or execute the Docker verification sandbox.",
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  private async runChecks(
    projectPath: string,
    lockfileKind: "npm" | "pnpm",
    manifest: z.infer<typeof ContainerManifestSchema>,
  ): Promise<string | undefined> {
    const installArgs =
      lockfileKind === "npm"
        ? [
            "npm",
            "ci",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--registry=https://registry.npmjs.org",
          ]
        : [
            "corepack",
            "pnpm",
            "install",
            "--frozen-lockfile",
            "--ignore-scripts",
            "--registry=https://registry.npmjs.org",
          ];
    const install = await this.execute(
      projectPath,
      installArgs,
      "bridge",
      this.installTimeoutMs,
    );
    if (install.exitCode !== 0) {
      return "dependency installation failed with lifecycle scripts disabled.";
    }

    const commands: Array<{ phase: VerificationPhase; args: string[] }> = [
      {
        phase: "test",
        args:
          lockfileKind === "npm"
            ? ["npm", "run", "test", "--if-present"]
            : ["corepack", "pnpm", "run", "test", "--if-present"],
      },
    ];
    if (manifest.scripts?.build) {
      commands.push({
        phase: "build",
        args:
          lockfileKind === "npm"
            ? ["npm", "run", "build", "--if-present"]
            : ["corepack", "pnpm", "run", "build", "--if-present"],
      });
    }
    for (const { phase, args } of commands) {
      const result = await this.execute(
        projectPath,
        args,
        "none",
        this.checkTimeoutMs,
      );
      if (result.exitCode !== 0) {
        return `${phase} command failed in the network-isolated container.`;
      }
    }
    return undefined;
  }

  private async execute(
    projectPath: string,
    args: string[],
    network: SandboxCommand["network"],
    timeoutMs: number,
  ): Promise<SandboxCommandResult> {
    return this.runner.run({ projectPath, args, network, timeoutMs });
  }
}

async function copyProject(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const source = path.resolve(sourcePath);
  await cp(source, destinationPath, {
    recursive: true,
    preserveTimestamps: false,
    filter: (entryPath) => {
      const relativePath = path.relative(source, entryPath);
      if (!relativePath) {
        return true;
      }
      const segments = relativePath.split(path.sep);
      const name = segments.at(-1) ?? "";
      return (
        !segments.some(
          (segment) => segment === ".git" || segment === "node_modules",
        ) &&
        !name.startsWith(".env") &&
        !/\.(?:pem|key|p12|pfx)$/i.test(name) &&
        name !== ".npmrc" &&
        name !== ".pnpmfile.cjs"
      );
    },
  });
}

function isProcessFailure(
  error: unknown,
): error is Error & { code: number | string } {
  return (
    error instanceof Error &&
    "code" in error &&
    (typeof error.code === "number" || typeof error.code === "string")
  );
}
