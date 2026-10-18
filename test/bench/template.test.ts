import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBenchmarkCaseTemplate } from "../../src/bench/template.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("benchmark case templates", () => {
  it("creates a placeholder case and refuses to overwrite an existing file", async () => {
    const directory = await makeTemporaryDirectory();
    const casePath = await createBenchmarkCaseTemplate(
      "manual-case",
      directory,
    );
    const contents = await readFile(casePath, "utf8");
    expect(contents).toContain('"expectedVerdict": "UNKNOWN"');
    await expect(
      createBenchmarkCaseTemplate("manual-case", directory),
    ).rejects.toThrow();
  });

  it("rejects unsafe case IDs", async () => {
    const directory = await makeTemporaryDirectory();
    await expect(
      createBenchmarkCaseTemplate("../outside", directory),
    ).rejects.toThrow("Case IDs must contain lowercase letters");
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "reachfix-template-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}
