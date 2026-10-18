import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UpgradePlanner } from "../../src/fix/upgrade-planner.js";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map(async (directory) => {
      await import("node:fs/promises").then((fs) =>
        fs.rm(directory, { recursive: true, force: true }),
      );
    }),
  );
});

describe("upgrade planner", () => {
  it("upgrades direct dependencies when the dependency is already declared", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "reachfix-fix-"));
    paths.push(projectPath);
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ dependencies: { vulnerable: "^2.0.0" } }, null, 2),
    );

    const planner = new UpgradePlanner();
    const plan = await planner.createPlan(projectPath, "vulnerable", "2.2.0");

    expect(plan.strategy).toBe("upgrade");
    expect(plan.packageSection).toBe("dependencies");

    await planner.applyPlan(projectPath, plan);
    const manifest = JSON.parse(
      await readFile(path.join(projectPath, "package.json"), "utf8"),
    );
    expect(manifest.dependencies.vulnerable).toBe("^2.2.0");
  });

  it("uses overrides when the dependency is not a direct dependency", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "reachfix-fix-"));
    paths.push(projectPath);
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ dependencies: { app: "^1.0.0" } }, null, 2),
    );

    const planner = new UpgradePlanner();
    const plan = await planner.createPlan(projectPath, "vulnerable", "2.2.0");

    expect(plan.strategy).toBe("override");
    expect(plan.packageSection).toBe("overrides");

    await planner.applyPlan(projectPath, plan);
    const manifest = JSON.parse(
      await readFile(path.join(projectPath, "package.json"), "utf8"),
    );
    expect(manifest.overrides.vulnerable).toBe(">=2.2.0");
  });

  it("uses pnpm overrides for transitive pnpm dependencies", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "reachfix-fix-"));
    paths.push(projectPath);
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ dependencies: { app: "^1.0.0" } }, null, 2),
    );

    const planner = new UpgradePlanner();
    const plan = await planner.createPlan(
      projectPath,
      "vulnerable",
      "2.2.0",
      "pnpm",
    );

    expect(plan.packageSection).toBe("pnpm.overrides");
    await planner.applyPlan(projectPath, plan);
    const manifest = JSON.parse(
      await readFile(path.join(projectPath, "package.json"), "utf8"),
    ) as {
      pnpm?: { overrides?: Record<string, string> };
      overrides?: unknown;
    };
    expect(manifest.pnpm?.overrides?.vulnerable).toBe(">=2.2.0");
    expect(manifest.overrides).toBeUndefined();
  });
});
