import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Advisory } from "../../src/types.js";
import { FixContextBuilder } from "../../src/fix/context.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createProject(): Promise<string> {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), "reachfix-context-test-"),
  );
  temporaryPaths.push(projectPath);
  await writeFile(
    path.join(projectPath, "entry.ts"),
    "export const value = 1;\n",
  );
  return projectPath;
}

const advisory: Advisory = {
  id: "GHSA-test-1234",
  aliases: [],
  summary: "Fixture advisory",
  details: "Fixture details",
  affected: [],
};

describe("fix context builder", () => {
  it("includes only requested call sites and supplied API context", async () => {
    const projectPath = await createProject();
    await writeFile(path.join(projectPath, "other.ts"), "not sent\n");

    const context = await new FixContextBuilder().build({
      projectPath,
      advisory,
      dependencyName: "vulnerable",
      fromVersion: "2.0.0",
      targetVersion: "2.2.0",
      callSites: [{ filePath: "entry.ts", line: 1 }],
      releaseNotes: "release notes",
      typeDefinitions: "export declare function run(): void",
    });

    expect(context.files).toEqual([
      {
        path: "entry.ts",
        content: "export const value = 1;\n",
        callSiteLines: [1],
      },
    ]);
    expect(context.releaseNotes).toBe("release notes");
    expect(JSON.stringify(context)).not.toContain("not sent");
  });

  it.each([".env", ".env.production", ".envrc", "private.pem", "private.key"])(
    "never includes sensitive file %s",
    async (filePath) => {
      const projectPath = await createProject();
      await writeFile(path.join(projectPath, filePath), "secret material");

      await expect(
        new FixContextBuilder().build({
          projectPath,
          advisory,
          dependencyName: "vulnerable",
          fromVersion: "2.0.0",
          targetVersion: "2.2.0",
          callSites: [{ filePath }],
        }),
      ).rejects.toMatchObject({ code: "INVALID_CONTEXT" });
      await expect(
        readFile(path.join(projectPath, filePath), "utf8"),
      ).resolves.toBe("secret material");
    },
  );

  it("honors .reachfixignore rules", async () => {
    const projectPath = await createProject();
    await writeFile(path.join(projectPath, ".reachfixignore"), "private/**\n");
    await mkdir(path.join(projectPath, "private"), { recursive: true });
    await writeFile(
      path.join(projectPath, "private", "entry.ts"),
      "do not send\n",
    );

    await expect(
      new FixContextBuilder().build({
        projectPath,
        advisory,
        dependencyName: "vulnerable",
        fromVersion: "2.0.0",
        targetVersion: "2.2.0",
        callSites: [{ filePath: "private/entry.ts" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONTEXT" });
  });

  it("supports root and nested glob patterns in .reachfixignore", async () => {
    const projectPath = await createProject();
    await writeFile(
      path.join(projectPath, ".reachfixignore"),
      "**/*.secret.ts\n",
    );
    await writeFile(path.join(projectPath, "entry.secret.ts"), "do not send\n");

    await expect(
      new FixContextBuilder().build({
        projectPath,
        advisory,
        dependencyName: "vulnerable",
        fromVersion: "2.0.0",
        targetVersion: "2.2.0",
        callSites: [{ filePath: "entry.secret.ts" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONTEXT" });
  });
});
