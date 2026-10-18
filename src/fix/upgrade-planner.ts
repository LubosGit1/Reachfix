import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import type { UpgradePlan } from "../types.js";

export interface UpgradePlannerOptions {
  minimumVersion?: string;
}

export class UpgradePlanner {
  constructor(private readonly options: UpgradePlannerOptions = {}) {}

  async createPlan(
    projectPath: string,
    dependencyName: string,
    targetVersion: string,
    lockfileKind: "npm" | "pnpm" = "npm",
  ): Promise<UpgradePlan> {
    const packageJsonPath = path.join(projectPath, "package.json");
    const raw = await readFile(packageJsonPath, "utf8");
    const manifest = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      overrides?: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };

    if (manifest.dependencies?.[dependencyName]) {
      const currentVersionRange = manifest.dependencies[dependencyName];
      const minimumVersion = semver.minVersion(currentVersionRange)?.version;
      if (minimumVersion && semver.gte(targetVersion, minimumVersion)) {
        return {
          strategy: "upgrade",
          dependencyName,
          targetVersion,
          filePath: packageJsonPath,
          packageSection: "dependencies",
        };
      }
    }

    if (manifest.devDependencies?.[dependencyName]) {
      return {
        strategy: "upgrade",
        dependencyName,
        targetVersion,
        filePath: packageJsonPath,
        packageSection: "devDependencies",
      };
    }

    if (manifest.optionalDependencies?.[dependencyName]) {
      return {
        strategy: "upgrade",
        dependencyName,
        targetVersion,
        filePath: packageJsonPath,
        packageSection: "optionalDependencies",
      };
    }

    return {
      strategy: "override",
      dependencyName,
      targetVersion,
      filePath: packageJsonPath,
      packageSection: lockfileKind === "pnpm" ? "pnpm.overrides" : "overrides",
    };
  }

  async applyPlan(projectPath: string, plan: UpgradePlan): Promise<void> {
    const packageJsonPath = path.join(projectPath, "package.json");
    const raw = await readFile(packageJsonPath, "utf8");
    const manifest = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      overrides?: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };

    if (plan.packageSection === "overrides") {
      manifest.overrides = {
        ...(manifest.overrides ?? {}),
        [plan.dependencyName]: `>=${plan.targetVersion}`,
      };
    } else if (plan.packageSection === "pnpm.overrides") {
      manifest.pnpm = {
        ...(manifest.pnpm ?? {}),
        overrides: {
          ...(manifest.pnpm?.overrides ?? {}),
          [plan.dependencyName]: `>=${plan.targetVersion}`,
        },
      };
    } else {
      const section = manifest[plan.packageSection] ?? {};
      section[plan.dependencyName] = `^${plan.targetVersion}`;
      manifest[plan.packageSection] = section;
    }

    await writeFile(
      packageJsonPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
}
