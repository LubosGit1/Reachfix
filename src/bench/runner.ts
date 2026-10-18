import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { scanProject } from "../cli/scan.js";
import type {
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkRun,
} from "../types.js";
import { BenchmarkError } from "./errors.js";
import { parseBenchmarkCase } from "./case-schema.js";
import { calculateBenchmarkMetrics, conservativeVerdict } from "./metrics.js";

const execFile = promisify(nodeExecFile);
const AuditResponseSchema = z.object({
  metadata: z.object({
    vulnerabilities: z.object({
      total: z.number().int().nonnegative(),
    }),
  }),
});

export interface BenchmarkRunnerOptions {
  casesPath: string;
  resultsDirectory?: string;
  now?: () => Date;
  scan?: typeof scanProject;
  execute?: typeof execFile;
}

interface AuditOutcome {
  vulnerabilityCount: number;
}

export async function loadBenchmarkCases(
  casesPath: string,
): Promise<BenchmarkCase[]> {
  let entries;
  try {
    entries = await readdir(casesPath, { withFileTypes: true });
  } catch (error) {
    throw new BenchmarkError(
      "INVALID_DATASET",
      `Could not read benchmark dataset ${casesPath}.`,
      { cause: error },
    );
  }

  const caseFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  if (caseFiles.length === 0) {
    throw new BenchmarkError(
      "DATASET_EMPTY",
      `No benchmark case JSON files found in ${casesPath}. Add manually labeled cases before running benchmarks.`,
    );
  }

  const cases = await Promise.all(
    caseFiles.map(async (fileName) => {
      const filePath = path.join(casesPath, fileName);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      } catch (error) {
        throw new BenchmarkError(
          "INVALID_DATASET",
          `Could not parse benchmark case ${filePath}.`,
          { cause: error },
        );
      }
      try {
        const caseValues = Array.isArray(parsed) ? parsed : [parsed];
        if (caseValues.length === 0) {
          throw new Error(`Case file ${fileName} must not be empty.`);
        }
        return caseValues.map((caseValue) => {
          const benchmarkCase = parseBenchmarkCase(caseValue);
          if (
            !Array.isArray(parsed) &&
            `${benchmarkCase.id}.json` !== fileName
          ) {
            throw new Error(`Case ID must match filename ${fileName}.`);
          }
          return benchmarkCase;
        });
      } catch (error) {
        throw new BenchmarkError(
          "INVALID_DATASET",
          `Invalid benchmark case ${filePath}.`,
          { cause: error },
        );
      }
    }),
  );

  const flattenedCases = cases.flat();
  if (
    new Set(flattenedCases.map(({ id }) => id)).size !== flattenedCases.length
  ) {
    throw new BenchmarkError(
      "INVALID_DATASET",
      "Benchmark case IDs must be unique.",
    );
  }
  return flattenedCases;
}

export async function runBenchmarkDataset(
  options: BenchmarkRunnerOptions,
): Promise<{ run: BenchmarkRun; resultsPath: string }> {
  const cases = await loadBenchmarkCases(options.casesPath);
  const now = options.now ?? (() => new Date());
  const started = now();
  const execute = options.execute ?? execFile;
  const scan = options.scan ?? scanProject;
  const results: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of cases) {
    results.push(await executeCase(benchmarkCase, { execute, scan }));
  }

  const completed = now();
  const run: BenchmarkRun = {
    schemaVersion: "1.0",
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    datasetPath:
      path.relative(process.cwd(), path.resolve(options.casesPath)) || ".",
    results,
    metrics: calculateBenchmarkMetrics(results),
  };
  const resultsDirectory =
    options.resultsDirectory ?? path.resolve("bench/results");
  const date = completed.toISOString().slice(0, 10);
  const resultsPath = path.join(resultsDirectory, `${date}.json`);

  try {
    await mkdir(resultsDirectory, { recursive: true });
    await writeFile(resultsPath, `${JSON.stringify(run, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    throw new BenchmarkError(
      "RESULT_WRITE_FAILED",
      `Could not safely write benchmark results to ${resultsPath}.`,
      { cause: error },
    );
  }
  return { run, resultsPath };
}

async function executeCase(
  benchmarkCase: BenchmarkCase,
  services: {
    execute: typeof execFile;
    scan: typeof scanProject;
  },
): Promise<BenchmarkCaseResult> {
  const started = performance.now();
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "reachfix-bench-"),
  );
  const checkoutPath = path.join(temporaryDirectory, "project");
  try {
    await executeCommand(
      services.execute,
      "git",
      [
        "-c",
        "protocol.ext.allow=never",
        "clone",
        "--no-checkout",
        "--filter=blob:none",
        benchmarkCase.repository,
        checkoutPath,
      ],
      "CHECKOUT_FAILED",
      "Could not clone the benchmark repository.",
    );
    await executeCommand(
      services.execute,
      "git",
      ["checkout", "--detach", benchmarkCase.commit],
      "CHECKOUT_FAILED",
      "Could not check out the benchmark commit.",
      checkoutPath,
    );

    const [scanResults, audit] = await Promise.all([
      services.scan(checkoutPath).catch((error: unknown) => {
        throw new BenchmarkError(
          "INVALID_DATASET",
          `Could not scan benchmark case ${benchmarkCase.id}.`,
          { cause: error },
        );
      }),
      runNpmAudit(checkoutPath, services.execute),
    ]);
    const caseFindings = scanResults.filter(
      (result) =>
        result.advisory.id === benchmarkCase.advisoryId ||
        result.advisory.aliases.includes(benchmarkCase.advisoryId),
    );
    const actualVerdict = conservativeVerdict(
      caseFindings.map(({ reachability }) => ({
        verdict: reachability.verdict,
      })),
    );
    return {
      caseId: benchmarkCase.id,
      repository: benchmarkCase.repository,
      commit: benchmarkCase.commit,
      advisoryId: benchmarkCase.advisoryId,
      expectedVerdict: benchmarkCase.expectedVerdict,
      actualVerdict,
      npmAuditVulnerabilityCount: audit.vulnerabilityCount,
      reachfixFindingCount: scanResults.filter(
        ({ reachability }) => reachability.verdict !== "NOT_REACHABLE",
      ).length,
      elapsedMs: performance.now() - started,
      apiCostUsd: 0,
      fixAttempted: false,
      fixVerified: false,
      reason:
        caseFindings
          .map(({ reachability }) => reachability.reason)
          .join(" | ") ||
        "The scan did not return the specified advisory; reachability remains UNKNOWN.",
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runNpmAudit(
  projectPath: string,
  execute: typeof execFile,
): Promise<AuditOutcome> {
  let stdout = "";
  try {
    const result = await execute(
      "npm",
      [
        "audit",
        "--json",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-fund",
        "--no-progress",
      ],
      {
        cwd: projectPath,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    stdout = result.stdout;
  } catch (error) {
    if (!isExecFileError(error) || typeof error.stdout !== "string") {
      throw new BenchmarkError(
        "AUDIT_FAILED",
        "npm audit could not be run for a benchmark case.",
        { cause: error },
      );
    }
    stdout = error.stdout;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new BenchmarkError(
      "AUDIT_FAILED",
      "npm audit did not return valid JSON for a benchmark case.",
      { cause: error },
    );
  }
  const outcome = AuditResponseSchema.safeParse(parsed);
  if (!outcome.success) {
    throw new BenchmarkError(
      "AUDIT_FAILED",
      "npm audit returned a response without a vulnerability count.",
      { cause: outcome.error },
    );
  }
  return { vulnerabilityCount: outcome.data.metadata.vulnerabilities.total };
}

async function executeCommand(
  execute: typeof execFile,
  command: string,
  args: string[],
  code: "CHECKOUT_FAILED",
  message: string,
  cwd?: string,
): Promise<void> {
  try {
    await execute(command, args, {
      ...(cwd ? { cwd } : {}),
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
  } catch (error) {
    throw new BenchmarkError(code, message, { cause: error });
  }
}

function isExecFileError(error: unknown): error is Error & { stdout: string } {
  return (
    error instanceof Error &&
    "stdout" in error &&
    typeof error.stdout === "string"
  );
}
