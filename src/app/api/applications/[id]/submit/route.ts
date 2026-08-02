import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import {
  ApiError,
  recordRejection,
  serializeApplicantView,
  submitApplication,
} from "@/lib/services";
import { fieldForbiddenReason, findRejectedFields } from "@/lib/policy";
import type { AppState } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

/** 最终提交：幂等键去重，重复提交返回首次结果。白名单外字段整体拒绝并审计。 */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);

    const rejected = findRejectedFields(Object.keys(body), ["idempotencyKey"]);
    if (rejected.length > 0) {
      const reason = fieldForbiddenReason(
        "APPLICANT",
        app.state as AppState,
        rejected,
      );
      await recordRejection(prisma, id, "APPLICANT", reason);
      throw new ApiError(403, "FIELD_FORBIDDEN", reason, {
        rejectedFields: rejected,
      });
    }

    const idempotencyKey =
      typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : (request.headers.get("idempotency-key") ?? "");
    if (!idempotencyKey) {
      throw new ApiError(400, "BAD_IDEMPOTENCY_KEY", "缺少 idempotencyKey");
    }
    try {
      const result = await prisma.$transaction((tx) =>
        submitApplication(tx, id, idempotencyKey),
      );
      return NextResponse.json(
        {
          ...serializeApplicantView(result.application),
          duplicate: result.duplicate,
        },
        { status: result.duplicate ? 200 : 201 },
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === "STATE_CONFLICT") {
        await recordRejection(prisma, id, "APPLICANT", e.message);
      }
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}
