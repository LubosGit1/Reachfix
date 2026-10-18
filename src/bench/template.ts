import { copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { BenchmarkError } from "./errors.js";

const TEMPLATE_PATH = path.resolve("bench/cases/templates/case.json.template");

export async function createBenchmarkCaseTemplate(
  caseId: string,
  casesDirectory = path.resolve("bench/cases"),
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(caseId)) {
    throw new BenchmarkError(
      "INVALID_DATASET",
      "Case IDs must contain lowercase letters, digits, and hyphens.",
    );
  }
  const outputPath = path.join(casesDirectory, `${caseId}.json`);
  if (
    !path
      .resolve(outputPath)
      .startsWith(`${path.resolve(casesDirectory)}${path.sep}`)
  ) {
    throw new BenchmarkError(
      "INVALID_DATASET",
      "The case template destination must be inside the cases directory.",
    );
  }
  try {
    await mkdir(casesDirectory, { recursive: true });
    await copyFile(TEMPLATE_PATH, outputPath, constants.COPYFILE_EXCL);
  } catch (error) {
    throw new BenchmarkError(
      "RESULT_WRITE_FAILED",
      `Could not create benchmark case template at ${outputPath}.`,
      { cause: error },
    );
  }
  return outputPath;
}
