import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  renderBenchmarkReport,
  updateReadmeBenchmarkSection,
} from "../../src/bench/report.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("benchmark report", () => {
  it("withholds metrics for datasets below the publication threshold", async () => {
    const directory = await makeTemporaryDirectory();
    expect(
      await renderBenchmarkReport(path.join(directory, "missing")),
    ).toContain("at least 50 cases and 30% ground-truth REACHABLE cases");

    await writeFile(
      path.join(directory, "2025-01-02.json"),
      JSON.stringify({
        completedAt: "2025-01-02T00:00:00.000Z",
        metrics: {
          caseCount: 49,
          reachableGroundTruthCount: 15,
          npmAuditVulnerabilityCount: 12,
          reachfixReportedCount: 7,
          reachabilityRecall: 1,
          reachablePrecision: 0.5,
          alertReduction: null,
          fixSuccessRate: null,
          medianTimeMs: 12.4,
          averageApiCostUsd: null,
        },
      }),
    );
    const report = await renderBenchmarkReport(directory);
    expect(report).not.toContain("| 2025-01-02 |");
    expect(report).toContain("at least 50 cases");
  });

  it("renders dated metrics when case count and reachable share meet thresholds", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(
      path.join(directory, "2025-01-02.json"),
      JSON.stringify({
        completedAt: "2025-01-02T00:00:00.000Z",
        metrics: {
          caseCount: 50,
          reachableGroundTruthCount: 15,
          npmAuditVulnerabilityCount: 21,
          reachfixReportedCount: 10,
          reachabilityRecall: 1,
          reachablePrecision: 0.5,
          alertReduction: null,
          fixSuccessRate: null,
          medianTimeMs: 12.4,
          averageApiCostUsd: null,
        },
      }),
    );
    const report = await renderBenchmarkReport(directory);
    expect(report).toContain(
      "| 2025-01-02 |    50 |             21 |                10 | 100.0% |     50.0% |             n/a |         n/a |       12 ms |           n/a |",
    );
  });

  it("rejects malformed result files and updates only the marked README section", async () => {
    const directory = await makeTemporaryDirectory();
    const results = path.join(directory, "results");
    const readme = path.join(directory, "README.md");
    await mkdir(results, { recursive: true });
    await writeFile(path.join(results, "2025-01-02.json"), "{}");
    await expect(renderBenchmarkReport(results)).rejects.toThrow(
      "invalid report shape",
    );

    await rm(path.join(results, "2025-01-02.json"));
    await writeFile(
      readme,
      "Before\n<!-- reachfix-benchmark:start -->\nold\n<!-- reachfix-benchmark:end -->\nAfter\n",
    );
    await updateReadmeBenchmarkSection(readme, results);
    const updated = await readFile(readme, "utf8");
    expect(updated).toContain("Before\n");
    expect(updated).toContain("Metrics are withheld until");
    expect(updated).toContain("<!-- reachfix-benchmark:end -->\nAfter");
    expect(updated).not.toContain("\nold\n");
  });
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "reachfix-report-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
