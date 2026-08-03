import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError } from "@/lib/api-response";
import { staffDecisionSchema } from "@/domain/validation";
import { assertTransition } from "@/domain/state-machine";
import { saveSnapshot } from "@/lib/snapshots";
import { writeAuditLog, logRejectedFields, logInvalidTransition } from "@/lib/audit";
import { validateStaffMutation } from "@/domain/field-permissions";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const app = await prisma.application.findUnique({ where: { id: params.id } });
    if (!app) return apiError("申请不存在", 404);

    const raw = (await request.json()) as Record<string, unknown>;

    const fieldValidation = validateStaffMutation(raw, app.state as never, "decision");
    if (fieldValidation.rejectedFields.length > 0) {
      await logRejectedFields(
        params.id,
        "STAFF",
        fieldValidation.rejectedFields,
        fieldValidation.reasons,
        app.state
      );
      return apiError("包含不允许的字段", 403, undefined, {
        rejectedFields: fieldValidation.rejectedFields,
        reasons: fieldValidation.reasons,
      });
    }

    if (app.state !== "SUBMITTED" && app.state !== "RESUBMITTED") {
      const action = (raw.action as string) || "UNKNOWN";
      await logInvalidTransition(
        params.id,
        "STAFF",
        app.state,
        action,
        `Decision not allowed in state ${app.state}`
      );
      return apiError(`当前状态 ${app.state} 不允许审核决定`, 403, undefined, {
        currentState: app.state,
      });
    }

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

    await writeAuditLog({
      applicationId: params.id,
      action: action === "ACCEPTED" ? "ACCEPTED" : "DECLINED",
      fromState: app.state,
      toState: action,
      actor: "STAFF",
      details: {
        rejectionReason: action === "DECLINED" ? "Staff declined application" : undefined,
      },
    });

    return apiSuccess(serializeApplication(updated));
  } catch (err) {
    console.error("Staff decision error:", err);
    return apiError("审核操作失败", 500);
  }
}
