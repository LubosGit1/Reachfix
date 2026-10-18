import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VerificationService } from "../../src/verify/verification.js";

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

describe("verification service", () => {
  it("marks the dependency as verified when the target version is reached", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "reachfix-verify-"));
    paths.push(projectPath);
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ dependencies: { vulnerable: "^2.3.0" } }, null, 2),
    );

    const service = new VerificationService();
    const result = await service.verify(projectPath, "vulnerable", "2.2.0");

    expect(result.status).toBe("VERIFIED");
    expect(result.version).toBe("2.3.0");
  });

  it("fails when the dependency remains below the target version", async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), "reachfix-verify-"));
    paths.push(projectPath);
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ dependencies: { vulnerable: "^2.0.0" } }, null, 2),
    );

    const service = new VerificationService();
    const result = await service.verify(projectPath, "vulnerable", "2.2.0");

    expect(result.status).toBe("FAILED");
    expect(result.version).toBe("2.0.0");
  });
});
