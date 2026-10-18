import { readFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import type { VerificationResult } from "../types.js";

export class VerificationService {
  async verify(
    projectPath: string,
    dependencyName: string,
    expectedVersion: string,
  ): Promise<VerificationResult> {
    const packageJsonPath = path.join(projectPath, "package.json");
    let manifest: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };

    try {
      const raw = await readFile(packageJsonPath, "utf8");
      manifest = JSON.parse(raw) as typeof manifest;
    } catch {
      return {
        status: "INCONCLUSIVE",
        dependencyName,
        version: "unknown",
        expectedVersion,
        message: `The package manifest in ${packageJsonPath} could not be read.`,
      };
    }

    const candidateVersions = [
      manifest.dependencies?.[dependencyName],
      manifest.devDependencies?.[dependencyName],
      manifest.optionalDependencies?.[dependencyName],
      manifest.overrides?.[dependencyName],
    ].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    const resolvedVersion = candidateVersions
      .map((versionRange) => semver.validRange(versionRange))
      .find((range) => range !== null)
      ? candidateVersions[0]
      : undefined;

    if (!resolvedVersion) {
      return {
        status: "FAILED",
        dependencyName,
        version: "not-found",
        expectedVersion,
        message: `No dependency or override entry was found for ${dependencyName}.`,
      };
    }

    const coercedVersion =
      semver.coerce(resolvedVersion)?.version ?? resolvedVersion;
    if (semver.gte(coercedVersion, expectedVersion)) {
      return {
        status: "VERIFIED",
        dependencyName,
        version: coercedVersion,
        expectedVersion,
        message: `${dependencyName} is pinned to or beyond ${expectedVersion}.`,
      };
    }

    return {
      status: "FAILED",
      dependencyName,
      version: coercedVersion,
      expectedVersion,
      message: `${dependencyName} is still below the target version ${expectedVersion}.`,
    };
  }
}
