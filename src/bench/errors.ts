export type BenchmarkErrorCode =
  | "INVALID_DATASET"
  | "DATASET_EMPTY"
  | "CHECKOUT_FAILED"
  | "AUDIT_FAILED"
  | "RESULT_WRITE_FAILED";

export class BenchmarkError extends Error {
  constructor(
    public readonly code: BenchmarkErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BenchmarkError";
  }
}
