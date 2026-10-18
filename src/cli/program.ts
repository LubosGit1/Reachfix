import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { scanProject } from "./scan.js";
import { createJsonReport, renderJsonReport } from "../report/json.js";
import { renderMarkdownReport } from "../report/markdown.js";
import { createSarifReport, renderSarifReport } from "../report/sarif.js";
import { renderTerminalReport } from "../report/terminal.js";
import type { ScanFailThreshold } from "../types.js";
import { runBenchmarkDataset } from "../bench/runner.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("reachfix")
    .description("Find and fix reachable vulnerabilities in npm projects.")
    .version("0.1.0");

  program
    .command("scan")
    .description("Find vulnerable dependencies.")
    .argument("[path]", "project directory", ".")
    .option(
      "--format <format>",
      "output format (text, json, sarif, or markdown)",
      "text",
    )
    .option("--output <file>", "write report to a file instead of stdout")
    .option(
      "--fail-on <threshold>",
      "failure threshold (reachable, unknown, any, or never)",
      "reachable",
    )
    .action(
      async (
        projectPath: string,
        options: { format: string; output?: string; failOn: string },
      ) => {
        if (
          options.format !== "text" &&
          options.format !== "json" &&
          options.format !== "sarif" &&
          options.format !== "markdown"
        ) {
          process.stderr.write(
            `Unsupported scan format "${options.format}".\n`,
          );
          process.exitCode = 2;
          return;
        }
        if (!isScanFailThreshold(options.failOn)) {
          process.stderr.write(
            `Unsupported --fail-on threshold "${options.failOn}".\n`,
          );
          process.exitCode = 2;
          return;
        }

        const results = await scanProject(projectPath);
        const output = renderScanResults(
          results,
          options.format,
          path.resolve(projectPath),
        );
        if (options.output) {
          await writeFile(options.output, output, "utf8");
        } else {
          process.stdout.write(output);
        }
        process.exitCode = shouldFailScan(results, options.failOn) ? 1 : 0;
      },
    );

  program
    .command("fix")
    .description("Find, fix, and verify vulnerable dependencies.")
    .argument("[path]", "project directory", ".")
    .option("--advisory <id>", "fix only the specified advisory")
    .option("--pr", "open a pull request for a verified fix")
    .action(() => markUnimplemented("fix"));

  program
    .command("bench")
    .description("Run a manually labeled benchmark dataset.")
    .argument("<dataset>", "directory containing benchmark case JSON files")
    .action(async (dataset: string) => {
      const { run, resultsPath } = await runBenchmarkDataset({
        casesPath: dataset,
      });
      process.stdout.write(
        `Benchmark saved to ${resultsPath}\n` +
          `Cases: ${run.metrics.caseCount}\n` +
          `Reachability recall: ${formatPercent(run.metrics.reachabilityRecall)}\n` +
          `Reachable precision: ${formatPercent(run.metrics.reachablePrecision)}\n` +
          `Alert reduction: ${formatPercent(run.metrics.alertReduction)}\n`,
      );
    });

  return program;
}

function renderScanResults(
  results: Awaited<ReturnType<typeof scanProject>>,
  format: string,
  projectPath: string,
): string {
  switch (format) {
    case "json":
      return renderJsonReport(createJsonReport(results));
    case "sarif":
      return renderSarifReport(createSarifReport(results, projectPath));
    case "markdown":
      return renderMarkdownReport(results);
    default:
      return renderTerminalReport(results);
  }
}

export function isScanFailThreshold(value: string): value is ScanFailThreshold {
  return (
    value === "reachable" ||
    value === "unknown" ||
    value === "any" ||
    value === "never"
  );
}

export function shouldFailScan(
  results: Awaited<ReturnType<typeof scanProject>>,
  threshold: ScanFailThreshold,
): boolean {
  switch (threshold) {
    case "reachable":
      return results.some(
        ({ reachability }) => reachability.verdict === "REACHABLE",
      );
    case "unknown":
      return results.some(
        ({ reachability }) => reachability.verdict !== "NOT_REACHABLE",
      );
    case "any":
      return results.length > 0;
    case "never":
      return false;
  }
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function markUnimplemented(commandName: string): void {
  process.stderr.write(
    `The "${commandName}" command is not implemented yet.\n`,
  );
  process.exitCode = 2;
}
