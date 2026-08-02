import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import {
  ApiError,
  resubmitApplication,
  serializeApplicantView,
} from "@/lib/services";

type Ctx = { params: Promise<{ id: string }> };

/** 补正后重新提交（NEEDS_CORRECTION → RESUBMITTED），幂等键去重。 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
    const idempotencyKey =
      typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : (request.headers.get("idempotency-key") ?? "");
    if (!idempotencyKey) {
      throw new ApiError(400, "BAD_IDEMPOTENCY_KEY", "缺少 idempotencyKey");
    }
    const result = await prisma.$transaction((tx) =>
      resubmitApplication(tx, id, idempotencyKey),
    );
    return NextResponse.json(
      {
        ...serializeApplicantView(result.application),
        duplicate: result.duplicate,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
