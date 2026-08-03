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

export interface ConflictDetail {
  serverData: unknown;
  conflicts: string[];
  serverVersion: number;
  applicantWins?: string[];
  serverWins?: string[];
  autoMerged?: string[];
  changedByOther?: string[];
  staleLink?: { message: string };
}

export function apiConflict(
  message: string,
  detail: ConflictDetail
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: "VERSION_CONFLICT",
      ...detail,
    },
    { status: 409 }
  );
}

export function apiStateConflict(
  message: string,
  currentState: string,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code: "STATE_CONFLICT",
      currentState,
      ...extra,
    },
    { status: 409 }
  );
}
