import { z } from "zod";

export const GeneratedFixSchema = z
  .object({
    unifiedDiff: z.string().min(1),
    changedFiles: z.array(z.string().min(1)).min(1),
    rationale: z.string().min(1).max(2000),
  })
  .strict();

export type GeneratedFix = z.infer<typeof GeneratedFixSchema>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface GeneratedFixResponse {
  fix: GeneratedFix;
  usage: TokenUsage;
}
