import path from "node:path";
import semver from "semver";
import { parseLockfile } from "../inventory/lockfile-parser.js";
import type { VerificationResult } from "../types.js";

export class VerificationService {
  async verify(
    projectPath: string,
    dependencyName: string,
    expectedVersion: string,
  ): Promise<VerificationResult> {
    const inconclusive = (
      version: string,
      message: string,
    ): VerificationResult => ({
      status: "INCONCLUSIVE",
      dependencyName,
      version,
      expectedVersion,
      message,
    });
    if (!semver.valid(expectedVersion)) {
      return inconclusive(
        "unknown",
        `The target version ${expectedVersion} is not valid semver.`,
      );
    }

    let inventory;
    try {
      inventory = await parseLockfile(path.resolve(projectPath));
    } catch {
      return inconclusive(
        "unknown",
        "The project lockfile could not be read to verify the resolved dependency version.",
      );
    }

    const versions = inventory.dependencies
      .filter(({ name }) => name === dependencyName)
      .map(({ version }) => version)
      .filter((version) => semver.valid(version) !== null);
    const belowTarget = versions.find(
      (version) => !semver.gte(version, expectedVersion),
    );
    if (belowTarget) {
      return {
        status: "FAILED",
        dependencyName,
        version: belowTarget,
        expectedVersion,
        message: `${dependencyName} still resolves below ${expectedVersion}.`,
      };
    }
    if (versions.length === 0) {
      return {
        status: "FAILED",
        dependencyName,
        version: "not-found",
        expectedVersion,
        message: `No resolved lockfile entry was found for ${dependencyName}.`,
      };
    }

    const version = [...versions].sort(semver.compare).at(-1) ?? "unknown";
    return inconclusive(
      version,
      `${dependencyName} resolves to ${version}, but isolated install and test verification has not been run.`,
    );
  }
}
