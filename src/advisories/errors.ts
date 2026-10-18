export type OsvClientErrorCode =
  | "REQUEST_FAILED"
  | "INVALID_RESPONSE"
  | "CACHE_READ_FAILED"
  | "CACHE_WRITE_FAILED";

export class OsvClientError extends Error {
  constructor(
    public readonly code: OsvClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OsvClientError";
  }
}
