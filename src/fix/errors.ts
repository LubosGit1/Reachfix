export type FixErrorCode =
  | "INVALID_CONTEXT"
  | "MODEL_REQUEST_FAILED"
  | "INVALID_MODEL_OUTPUT"
  | "PATCH_REJECTED"
  | "PATCH_APPLY_FAILED"
  | "COST_LIMIT_EXCEEDED";

export class FixError extends Error {
  constructor(
    public readonly code: FixErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FixError";
  }
}
