import { Command } from "commander";

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
    .description("Find vulnerable dependencies and analyze their reachability.")
    .argument("[path]", "project directory", ".")
    .action(() => markUnimplemented("scan"));

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
