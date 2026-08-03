import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError } from "@/lib/api-response";
import { staffDecisionSchema } from "@/domain/validation";
import { assertTransition } from "@/domain/state-machine";
import { saveSnapshot } from "@/lib/snapshots";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const app = await prisma.application.findUnique({ where: { id: params.id } });
    if (!app) return apiError("申请不存在", 404);

    if (app.state !== "SUBMITTED" && app.state !== "RESUBMITTED") {
      return apiError(`当前状态 ${app.state} 不允许审核决定`, 403);
    }

    const raw = await request.json();
    const parsed = staffDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError("无效的审核决定", 400);
    }

    const { action } = parsed.data;
    assertTransition(app.state as never, action as never);

    const updated = await prisma.application.update({
      where: { id: params.id },
      data: { state: action, version: app.version + 1 },
    });

    await saveSnapshot(updated, "STAFF");

    await prisma.auditLog.create({
      data: {
        applicationId: params.id,
        action: action === "ACCEPTED" ? "ACCEPTED" : "DECLINED",
        fromState: app.state,
        toState: action,
        actor: "STAFF",
      },
    });

    return apiSuccess(serializeApplication(updated));
  } catch (err) {
    console.error("Staff decision error:", err);
    return apiError("审核操作失败", 500);
  }
}
