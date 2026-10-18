import { createBenchmarkCaseTemplate } from "./template.js";

const caseId = process.argv[2];
if (!caseId) {
  process.stderr.write("Usage: pnpm bench:case -- <case-id>\n");
  process.exitCode = 2;
} else {
  try {
    const casePath = await createBenchmarkCaseTemplate(caseId);
    process.stdout.write(
      `Created ${casePath}; edit and manually verify its ground truth.\n`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create benchmark case.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}
