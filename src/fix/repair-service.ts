import type { VerificationResult } from "../types.js";
import {
  AnthropicFixClient,
  type FixModel,
  type FixModelContext,
} from "./anthropic-client.js";
import { FixContextBuilder, type FixContextInput } from "./context.js";
import { FixError } from "./errors.js";
import {
  applyValidatedPatch,
  validateGeneratedFix,
} from "./patch-validator.js";
import {
  createSandboxSnapshot,
  removeSandboxSnapshot,
} from "../verify/sandbox.js";

const MAX_ATTEMPTS = 3;

export interface FixUsageLog {
  model: string;
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  cumulativeCostUsd: number;
}

export interface FixRepairInput extends FixContextInput {
  maxCostUsd: number;
}

export interface FixRepairResult {
  status: "VERIFIED" | "FAILED" | "INCONCLUSIVE";
  dependencyName: string;
  targetVersion: string;
  attempts: number;
  estimatedCostUsd: number;
  verification?: VerificationResult;
  rationale?: string;
  error?: string;
}

export interface FixRepairServices {
  model?: FixModel;
  contextBuilder?: FixContextBuilder;
  verify(
    projectPath: string,
    dependencyName: string,
    targetVersion: string,
    attempt: number,
    baselineProjectPath: string,
  ): Promise<VerificationResult>;
  onUsage?(usage: FixUsageLog): void;
}

export class FixRepairService {
  private readonly model: FixModel;
  private readonly contextBuilder: FixContextBuilder;

  constructor(private readonly services: FixRepairServices) {
    this.model = services.model ?? new AnthropicFixClient();
    this.contextBuilder = services.contextBuilder ?? new FixContextBuilder();
  }

  async repair(input: FixRepairInput): Promise<FixRepairResult> {
    if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) {
      throw new FixError(
        "COST_LIMIT_EXCEEDED",
        "maxCostUsd must be a positive finite value.",
      );
    }

    const baselineProjectPath = await createSandboxSnapshot(input.projectPath);
    try {
      return await this.repairAgainstBaseline(input, baselineProjectPath);
    } finally {
      await removeSandboxSnapshot(baselineProjectPath);
    }
  }

  private async repairAgainstBaseline(
    input: FixRepairInput,
    baselineProjectPath: string,
  ): Promise<FixRepairResult> {
    let cumulativeCostUsd = 0;
    let verification: VerificationResult | undefined;
    let rationale: string | undefined;
    let lastFailure = "The fix did not pass verification.";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const context = await this.contextBuilder.build(input);
      const modelContext = toModelContext(context);
      if (attempt > 1) {
        modelContext.verificationFeedback = lastFailure;
      }

      const projectedCost = this.model.estimateRequestCostUsd(modelContext);
      if (!Number.isFinite(projectedCost) || projectedCost < 0) {
        throw new FixError(
          "MODEL_REQUEST_FAILED",
          "The model returned an invalid estimated request cost.",
        );
      }
      if (cumulativeCostUsd + projectedCost > input.maxCostUsd) {
        throw new FixError(
          "COST_LIMIT_EXCEEDED",
          `The next model request is estimated to exceed maxCostUsd (${input.maxCostUsd.toFixed(4)} USD).`,
        );
      }

      const response = await this.model.generateFix(modelContext);
      if (
        !Number.isInteger(response.usage.inputTokens) ||
        !Number.isInteger(response.usage.outputTokens) ||
        response.usage.inputTokens < 0 ||
        response.usage.outputTokens < 0
      ) {
        throw new FixError(
          "MODEL_REQUEST_FAILED",
          "The model returned invalid token usage metadata.",
        );
      }
      const requestCost = this.model.estimateCostUsd(response.usage);
      if (!Number.isFinite(requestCost) || requestCost < 0) {
        throw new FixError(
          "MODEL_REQUEST_FAILED",
          "The model returned an invalid estimated response cost.",
        );
      }
      cumulativeCostUsd += requestCost;
      const usageLog: FixUsageLog = {
        model: this.model.model ?? "configured-anthropic-model",
        attempt,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        estimatedCostUsd: requestCost,
        cumulativeCostUsd,
      };
      if (this.services.onUsage) {
        this.services.onUsage(usageLog);
      } else {
        process.stderr.write(
          `reachfix LLM usage: model=${usageLog.model} attempt=${attempt} input_tokens=${usageLog.inputTokens} output_tokens=${usageLog.outputTokens} estimated_cost_usd=${usageLog.estimatedCostUsd.toFixed(6)} cumulative_cost_usd=${usageLog.cumulativeCostUsd.toFixed(6)}\n`,
        );
      }

      if (cumulativeCostUsd > input.maxCostUsd) {
        throw new FixError(
          "COST_LIMIT_EXCEEDED",
          "The estimated cost of the latest model response exceeded maxCostUsd; no further model requests will be made.",
        );
      }

      try {
        const patch = await validateGeneratedFix(response.input, {
          projectPath: input.projectPath,
          allowedCallSitePaths: context.files.map((file) => file.path),
          dependencyName: input.dependencyName,
          targetVersion: input.targetVersion,
        });
        await applyValidatedPatch(patch);
        rationale = patch.rationale;
      } catch (error) {
        if (!(error instanceof FixError)) {
          throw error;
        }
        lastFailure = error.message;
        continue;
      }

      verification = await this.services.verify(
        input.projectPath,
        input.dependencyName,
        input.targetVersion,
        attempt,
        baselineProjectPath,
      );
      if (verification.status === "VERIFIED") {
        return {
          status: "VERIFIED",
          dependencyName: input.dependencyName,
          targetVersion: input.targetVersion,
          attempts: attempt,
          estimatedCostUsd: cumulativeCostUsd,
          verification,
          rationale,
        };
      }
      if (verification.status === "INCONCLUSIVE") {
        return {
          status: "INCONCLUSIVE",
          dependencyName: input.dependencyName,
          targetVersion: input.targetVersion,
          attempts: attempt,
          estimatedCostUsd: cumulativeCostUsd,
          verification,
          ...(rationale ? { rationale } : {}),
          error: verification.message,
        };
      }
      lastFailure = `${verification.status}: ${verification.message}`;
    }

    return {
      status: "FAILED",
      dependencyName: input.dependencyName,
      targetVersion: input.targetVersion,
      attempts: MAX_ATTEMPTS,
      estimatedCostUsd: cumulativeCostUsd,
      ...(verification ? { verification } : {}),
      ...(rationale ? { rationale } : {}),
      error: lastFailure,
    };
  }
}

function toModelContext(
  context: Awaited<ReturnType<FixContextBuilder["build"]>>,
): FixModelContext {
  return {
    advisory: {
      id: context.advisory.id,
      summary: context.advisory.summary,
      details: context.advisory.details,
    },
    dependencyName: context.dependencyName,
    fromVersion: context.fromVersion,
    targetVersion: context.targetVersion,
    releaseNotes: context.releaseNotes,
    typeDefinitions: context.typeDefinitions,
    files: context.files,
  };
}
