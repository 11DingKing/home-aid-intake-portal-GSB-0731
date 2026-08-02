import { NextResponse } from "next/server";
import type { FieldError } from "@/domain/validation";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(
  message: string,
  status = 400,
  errors?: FieldError[],
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, error: message, errors: errors ?? [], ...extra },
    { status }
  );
}

export function apiConflict(
  message: string,
  serverData: unknown,
  conflicts: string[],
  serverVersion: number
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: "VERSION_CONFLICT",
      serverData,
      conflicts,
      serverVersion,
    },
    { status: 409 }
  );
}
