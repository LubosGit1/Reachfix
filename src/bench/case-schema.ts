import { z } from "zod";
import type { BenchmarkCase } from "../types.js";

export const BenchmarkCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    repository: z.string().url(),
    commit: z.string().regex(/^[a-f0-9]{40}$/i),
    advisoryId: z.string().min(1),
    expectedVerdict: z.enum(["REACHABLE", "NOT_REACHABLE", "UNKNOWN"]),
    rationale: z.string().min(1),
  })
  .strict()
  .superRefine((benchmarkCase, context) => {
    const url = new URL(benchmarkCase.repository);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password
    ) {
      context.addIssue({
        code: "custom",
        message: "Benchmark repositories must be public HTTPS GitHub URLs.",
        path: ["repository"],
      });
    }
  });

export function parseBenchmarkCase(value: unknown): BenchmarkCase {
  return BenchmarkCaseSchema.parse(value);
}
