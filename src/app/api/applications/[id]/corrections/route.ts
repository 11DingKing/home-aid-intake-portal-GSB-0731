import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeCorrection } from "@/lib/serializers";
import { apiSuccess, apiError } from "@/lib/api-response";
import { correctionCreateSchema } from "@/domain/validation";
import { assertTransition } from "@/domain/state-machine";

interface RouteContext {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const corrections = await prisma.correction.findMany({
    where: { applicationId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return apiSuccess(corrections.map(serializeCorrection));
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const app = await prisma.application.findUnique({ where: { id: params.id } });
    if (!app) return apiError("申请不存在", 404);

    if (app.state !== "SUBMITTED" && app.state !== "RESUBMITTED") {
      return apiError(`当前状态 ${app.state} 不允许发起补正`, 403);
    }

    const raw = await request.json();
    const parsed = correctionCreateSchema.safeParse(raw);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return apiError("数据校验失败", 422, errors);
    }

    const { fields, reasonCode } = parsed.data;

    assertTransition(app.state as never, "NEEDS_CORRECTION");

    const correction = await prisma.correction.create({
      data: {
        applicationId: params.id,
        fields: JSON.stringify(fields),
        reasonCode,
      },
    });

    await prisma.application.update({
      where: { id: params.id },
      data: { state: "NEEDS_CORRECTION", version: app.version + 1 },
    });

    await prisma.auditLog.create({
      data: {
        applicationId: params.id,
        action: "CORRECTION_REQUESTED",
        fromState: app.state,
        toState: "NEEDS_CORRECTION",
        actor: "STAFF",
        details: JSON.stringify({ fields, reasonCode }),
      },
    });

    return apiSuccess(serializeCorrection(correction), 201);
  } catch (err) {
    console.error("Correction error:", err);
    return apiError("发起补正失败", 500);
  }
}
