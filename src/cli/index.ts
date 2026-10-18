#!/usr/bin/env node
import { createProgram } from "./program.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "An unexpected CLI error occurred.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}
