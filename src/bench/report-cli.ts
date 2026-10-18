import path from "node:path";
import { updateReadmeBenchmarkSection } from "./report.js";

try {
  await updateReadmeBenchmarkSection(
    path.resolve("README.md"),
    path.resolve("bench/results"),
  );
  process.stdout.write("Updated README benchmark table.\n");
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "Could not update benchmark report.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}
