import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBenchmarkCases } from "../../src/bench/runner.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("benchmark case loader", () => {
  it("loads bundled case arrays and preserves singleton filename validation", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(
      path.join(directory, "curated.json"),
      JSON.stringify([makeCase("case-one"), makeCase("case-two")]),
    );
    await writeFile(
      path.join(directory, "case-three.json"),
      JSON.stringify(makeCase("case-three")),
    );

    const cases = await loadBenchmarkCases(directory);

    expect(cases.map(({ id }) => id)).toEqual([
      "case-three",
      "case-one",
      "case-two",
    ]);
  });

  it("rejects duplicate IDs across bundled and individual case files", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(
      path.join(directory, "curated.json"),
      JSON.stringify([makeCase("duplicate-case")]),
    );
    await writeFile(
      path.join(directory, "duplicate-case.json"),
      JSON.stringify(makeCase("duplicate-case")),
    );

    await expect(loadBenchmarkCases(directory)).rejects.toMatchObject({
      code: "INVALID_DATASET",
      message: "Benchmark case IDs must be unique.",
    });
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "reachfix-bench-test-"));
  const casesDirectory = path.join(directory, "cases");
  await mkdir(casesDirectory, { recursive: true });
  temporaryDirectories.push(directory);
  return casesDirectory;
}

function makeCase(id: string): Record<string, string> {
  return {
    id,
    repository: "https://github.com/owner/repository",
    commit: "a".repeat(40),
    advisoryId: "GHSA-example",
    expectedVerdict: "UNKNOWN",
    rationale: "Insufficient independent evidence to establish reachability.",
  };
}
