import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { StateTransitionError } from "@/domain/stateMachine";
import { ZodError } from "zod";

// Uniform JSON error envelope so the client + tests can rely on { error: {...} }.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status },
    );
  }
  // Illegal state-machine transitions (e.g. correcting a terminal application)
  // are a client conflict, not a server fault.
  if (err instanceof StateTransitionError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: { from: err.from, action: err.action },
        },
      },
      { status: 409 },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Request body failed validation.",
          details: { issues: err.issues },
        },
      },
      { status: 400 },
    );
  }
  console.error("Unhandled route error:", err);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Unexpected server error." } },
    { status: 500 },
  );
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
