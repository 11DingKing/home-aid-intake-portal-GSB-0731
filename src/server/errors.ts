// Typed application-layer errors. Route handlers map these to HTTP responses.

export type AppErrorCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "VERSION_CONFLICT"
  | "FIELD_CONFLICT"
  | "VALIDATION_FAILED"
  | "NOT_EDITABLE"
  | "BAD_REQUEST"
  | "IDEMPOTENCY_MISMATCH";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (msg = "Application not found.") => new AppError("NOT_FOUND", msg, 404);
export const badRequest = (msg: string, details?: unknown) =>
  new AppError("BAD_REQUEST", msg, 400, details);
