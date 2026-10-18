import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDockerRunArguments,
  createSandboxSnapshot,
  removeSandboxSnapshot,
  SandboxVerificationService,
  type SandboxCommand,
  type SandboxCommandResult,
  type SandboxCommandRunner,
} from "../../src/verify/sandbox.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class ReplayRunner implements SandboxCommandRunner {
  readonly commands: SandboxCommand[] = [];
  private index = 0;

  constructor(private readonly exitCodes: number[] = []) {}

  async run(command: SandboxCommand): Promise<SandboxCommandResult> {
    this.commands.push(command);
    const exitCode = this.exitCodes[this.index] ?? 0;
    this.index += 1;
    return { exitCode };
  }
}

describe("Docker sandbox verification service", () => {
  it("applies resource, filesystem, privilege, and network restrictions", () => {
    const args = createDockerRunArguments(
      {
        projectPath: "/tmp/safe-project",
        args: ["npm", "test"],
        network: "none",
        timeoutMs: 1000,
      },
      "node:22-test",
    );

    expect(args).toEqual(
      expect.arrayContaining([
        "--network=none",
        "--cpus=2",
        "--memory=2g",
        "--pids-limit=256",
        "--security-opt=no-new-privileges",
        "--cap-drop=ALL",
        "--read-only",
        "--mount",
        "type=bind,src=/tmp/safe-project,dst=/workspace",
        "node:22-test",
        "npm",
        "test",
      ]),
    );
    expect(args).not.toContain("/var/run/docker.sock");
    expect(args).not.toContain("--privileged");
  });

  it("compares passing baseline and candidate checks in restricted network modes", async () => {
    const baseline = await createProject("2.0.0");
    const candidate = await createProject("2.2.0");
    const runner = new ReplayRunner();
    const service = new SandboxVerificationService({ runner });

    const result = await service.verify(
      baseline,
      candidate,
      "vulnerable",
      "2.2.0",
    );

    expect(result).toMatchObject({ status: "VERIFIED", version: "2.2.0" });
    expect(runner.commands).toHaveLength(6);
    expect(runner.commands.map(({ network }) => network)).toEqual([
      "bridge",
      "none",
      "none",
      "bridge",
      "none",
      "none",
    ]);
    expect(runner.commands[0]?.args).toContain("--ignore-scripts");
    expect(runner.commands[1]?.args).toEqual([
      "npm",
      "run",
      "test",
      "--if-present",
    ]);
    expect(runner.commands[2]?.args).toEqual([
      "npm",
      "run",
      "build",
      "--if-present",
    ]);
  });

  it("does not report verified when baseline fails or candidate checks fail", async () => {
    const baseline = await createProject("2.0.0");
    const candidate = await createProject("2.2.0");
    const baselineFailure = await new SandboxVerificationService({
      runner: new ReplayRunner([0, 1]),
    }).verify(baseline, candidate, "vulnerable", "2.2.0");
    expect(baselineFailure.status).toBe("INCONCLUSIVE");

    const candidateFailure = await new SandboxVerificationService({
      runner: new ReplayRunner([0, 0, 0, 0, 1]),
    }).verify(baseline, candidate, "vulnerable", "2.2.0");
    expect(candidateFailure).toMatchObject({
      status: "FAILED",
      version: "2.2.0",
    });
  });

  it("fails before running commands when the lockfile does not resolve the target", async () => {
    const baseline = await createProject("2.0.0");
    const candidate = await createProject("2.1.9");
    const runner = new ReplayRunner();
    const result = await new SandboxVerificationService({ runner }).verify(
      baseline,
      candidate,
      "vulnerable",
      "2.2.0",
    );

    expect(result.status).toBe("FAILED");
    expect(runner.commands).toHaveLength(0);
  });

  it("fails if any locked copy of the dependency remains below the target", async () => {
    const baseline = await createProject("2.0.0");
    const candidate = await createProject("2.2.0");
    const lockfilePath = path.join(candidate, "package-lock.json");
    const lockfile = JSON.parse(await readFile(lockfilePath, "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    lockfile.packages["node_modules/nested/node_modules/vulnerable"] = {
      version: "2.1.9",
    };
    await writeFile(lockfilePath, JSON.stringify(lockfile));
    const runner = new ReplayRunner();

    const result = await new SandboxVerificationService({ runner }).verify(
      baseline,
      candidate,
      "vulnerable",
      "2.2.0",
    );

    expect(result).toMatchObject({ status: "FAILED", version: "2.1.9" });
    expect(runner.commands).toHaveLength(0);
  });

  it("does not accept a candidate that changes the test command", async () => {
    const baseline = await createProject("2.0.0");
    const candidate = await createProject("2.2.0");
    const packageJsonPath = path.join(candidate, "package.json");
    const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.test = "node -e 'process.exit(0)'";
    await writeFile(packageJsonPath, JSON.stringify(manifest));
    const runner = new ReplayRunner();

    const result = await new SandboxVerificationService({ runner }).verify(
      baseline,
      candidate,
      "vulnerable",
      "2.2.0",
    );

    expect(result).toMatchObject({ status: "FAILED" });
    expect(result.message).toContain("changed the test or build command");
    expect(runner.commands).toHaveLength(0);
  });

  it("captures a baseline without copying dependency folders or secrets", async () => {
    const project = await createProject("2.0.0");
    await writeFile(path.join(project, ".env"), "NOT_FOR_SANDBOX=true");
    await writeFile(path.join(project, ".npmrc"), "//registry:token=secret");
    await writeFile(path.join(project, "private.key"), "not-for-copy");
    await symlink("private.key", path.join(project, "secret-link"));
    await mkdir(path.join(project, "node_modules"), { recursive: true });
    await writeFile(
      path.join(project, "node_modules/vulnerable"),
      "not copied",
    );
    const snapshot = await createSandboxSnapshot(project);
    temporaryPaths.push(snapshot);

    await expect(readFile(path.join(snapshot, ".env"))).rejects.toThrow();
    await expect(readFile(path.join(snapshot, ".npmrc"))).rejects.toThrow();
    await expect(
      readFile(path.join(snapshot, "secret-link")),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(snapshot, "private.key")),
    ).rejects.toThrow();
    expect(
      await readFile(path.join(snapshot, "package.json"), "utf8"),
    ).toContain("vulnerable");
    await expect(
      readFile(path.join(snapshot, "node_modules/vulnerable")),
    ).rejects.toThrow();
    await removeSandboxSnapshot(snapshot);
    temporaryPaths.splice(temporaryPaths.indexOf(snapshot), 1);
  });
});

async function createProject(version: string): Promise<string> {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), "reachfix-sandbox-test-"),
  );
  temporaryPaths.push(projectPath);
  await writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({
      name: "sandbox-fixture",
      version: "1.0.0",
      scripts: { test: "node test.js", build: "node build.js" },
      dependencies: { vulnerable: `^${version}` },
    }),
  );
  await writeFile(
    path.join(projectPath, "package-lock.json"),
    JSON.stringify({
      name: "sandbox-fixture",
      version: "1.0.0",
      lockfileVersion: 3,
      packages: {
        "": {
          name: "sandbox-fixture",
          version: "1.0.0",
          dependencies: { vulnerable: `^${version}` },
        },
        "node_modules/vulnerable": { version },
      },
    }),
  );
  await writeFile(path.join(projectPath, "test.js"), "process.exit(0);\n");
  await writeFile(path.join(projectPath, "build.js"), "process.exit(0);\n");
  return projectPath;
}
