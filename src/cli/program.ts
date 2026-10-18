import { Command } from "commander";
import { scanProject } from "./scan.js";

function markUnimplemented(commandName: string): void {
  process.stderr.write(
    `The "${commandName}" command is not implemented yet.\n`,
  );
  process.exitCode = 2;
}

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
    .option("--format <format>", "output format (text or json)", "text")
    .action(async (projectPath: string, options: { format: string }) => {
      if (options.format !== "text" && options.format !== "json") {
        process.stderr.write(`Unsupported scan format "${options.format}".\n`);
        process.exitCode = 2;
        return;
      }

      const findings = await scanProject(projectPath);
      if (options.format === "json") {
        process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
      } else if (findings.length === 0) {
        process.stdout.write("No vulnerable dependencies found.\n");
      } else {
        for (const finding of findings) {
          for (const advisory of finding.advisories) {
            const summary = advisory.summary ? ` — ${advisory.summary}` : "";
            process.stdout.write(
              `${finding.dependency.name}@${finding.dependency.version} ${advisory.id}${summary}\n`,
            );
          }
        }
      }
      process.exitCode = findings.length > 0 ? 1 : 0;
    });

  program
    .command("fix")
    .description("Find, fix, and verify vulnerable dependencies.")
    .argument("[path]", "project directory", ".")
    .option("--advisory <id>", "fix only the specified advisory")
    .option("--pr", "open a pull request for a verified fix")
    .action(() => markUnimplemented("fix"));

  program
    .command("bench")
    .description("Run a benchmark dataset.")
    .argument("<dataset>", "benchmark dataset")
    .action(() => markUnimplemented("bench"));

  return program;
}
