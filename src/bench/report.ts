import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BenchmarkError } from "./errors.js";

const ReportRunSchema = z.object({
  completedAt: z.string().datetime(),
  metrics: z.object({
    caseCount: z.number().int().nonnegative(),
    reachabilityRecall: z.number().nullable(),
    reachablePrecision: z.number().nullable(),
    alertReduction: z.number().nullable(),
    fixSuccessRate: z.number().nullable(),
    medianTimeMs: z.number().nonnegative(),
    averageApiCostUsd: z.number().nonnegative(),
  }),
});

const REPORT_HEADERS = [
  "Date",
  "Cases",
  "Recall",
  "Precision",
  "Alert reduction",
  "Fix success",
  "Median time",
  "Avg. API cost",
];

const EMPTY_REPORT = [
  "",
  "## Benchmark results",
  "",
  "> No benchmark metrics are published until a curated, manually labeled dataset is run.",
  "",
  ...renderTable([]),
  "",
].join("\n");

interface ReportRun {
  completedAt: string;
  metrics: {
    caseCount: number;
    reachabilityRecall: number | null;
    reachablePrecision: number | null;
    alertReduction: number | null;
    fixSuccessRate: number | null;
    medianTimeMs: number;
    averageApiCostUsd: number;
  };
}

export async function renderBenchmarkReport(
  resultsDirectory: string,
): Promise<string> {
  let entries;
  try {
    entries = await readdir(resultsDirectory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return EMPTY_REPORT;
    }
    throw new BenchmarkError(
      "INVALID_DATASET",
      `Could not read benchmark results at ${resultsDirectory}.`,
      { cause: error },
    );
  }

  const resultFiles = entries
    .filter(
      (entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  const runs: ReportRun[] = [];
  for (const fileName of resultFiles) {
    const filePath = path.join(resultsDirectory, fileName);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch (error) {
      throw new BenchmarkError(
        "INVALID_DATASET",
        `Could not parse benchmark result ${filePath}.`,
        { cause: error },
      );
    }
    const result = ReportRunSchema.safeParse(parsed);
    if (!result.success) {
      throw new BenchmarkError(
        "INVALID_DATASET",
        `Benchmark result ${filePath} has an invalid report shape.`,
        { cause: result.error },
      );
    }
    runs.push(result.data);
  }

  if (runs.length === 0) {
    return EMPTY_REPORT;
  }
  const rows = runs.map(({ completedAt, metrics }) => [
    completedAt.slice(0, 10),
    String(metrics.caseCount),
    formatPercent(metrics.reachabilityRecall),
    formatPercent(metrics.reachablePrecision),
    formatPercent(metrics.alertReduction),
    formatPercent(metrics.fixSuccessRate),
    `${Math.round(metrics.medianTimeMs)} ms`,
    `$${metrics.averageApiCostUsd.toFixed(4)}`,
  ]);
  return [
    "",
    "## Benchmark results",
    "",
    "> No benchmark metrics are published until a curated, manually labeled dataset is run.",
    "",
    ...renderTable(rows),
    "",
  ].join("\n");
}

export async function updateReadmeBenchmarkSection(
  readmePath: string,
  resultsDirectory: string,
): Promise<void> {
  let readme: string;
  try {
    readme = await readFile(readmePath, "utf8");
  } catch (error) {
    throw new BenchmarkError(
      "RESULT_WRITE_FAILED",
      `Could not read README at ${readmePath}.`,
      { cause: error },
    );
  }
  const startMarker = "<!-- reachfix-benchmark:start -->";
  const endMarker = "<!-- reachfix-benchmark:end -->";
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);
  if (
    startIndex < 0 ||
    endIndex < 0 ||
    endIndex < startIndex ||
    readme.indexOf(startMarker, startIndex + startMarker.length) >= 0 ||
    readme.indexOf(endMarker, endIndex + endMarker.length) >= 0
  ) {
    throw new BenchmarkError(
      "RESULT_WRITE_FAILED",
      "README must contain exactly one ordered benchmark marker pair.",
    );
  }

  const report = await renderBenchmarkReport(resultsDirectory);
  const before = readme.slice(0, startIndex + startMarker.length);
  const after = readme.slice(endIndex);
  const updated = `${before}\n${report}\n${after}`;
  await writeFile(readmePath, updated, "utf8");
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function renderTable(rows: string[][]): string[] {
  const widths = REPORT_HEADERS.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const renderRow = (row: string[], rightAlign: boolean): string =>
    `| ${row
      .map((value, index) => {
        const width = widths[index] ?? value.length;
        return rightAlign && index > 0
          ? value.padStart(width)
          : value.padEnd(width);
      })
      .join(" | ")} |`;

  const separator = widths.map((width, index) =>
    index === 0 ? "-".repeat(width) : `${"-".repeat(width - 1)}:`,
  );
  return [
    renderRow(REPORT_HEADERS, false),
    `| ${separator.join(" | ")} |`,
    ...rows.map((row) => renderRow(row, true)),
  ];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
