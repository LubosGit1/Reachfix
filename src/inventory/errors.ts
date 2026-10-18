export type InventoryErrorCode =
  | "LOCKFILE_NOT_FOUND"
  | "MULTIPLE_LOCKFILES"
  | "INVALID_MANIFEST"
  | "INVALID_LOCKFILE"
  | "UNSUPPORTED_LOCKFILE";

export class InventoryError extends Error {
  constructor(
    public readonly code: InventoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InventoryError";
  }
}
