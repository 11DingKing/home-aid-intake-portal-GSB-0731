import { NextResponse } from "next/server";
import { ApiError } from "./services";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "服务器内部错误", details: null } },
    { status: 500 },
  );
}

export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  throw new ApiError(400, "BAD_JSON", "请求体必须是 JSON 对象");
}
