import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError } from "@/lib/api-response";
import { submitSchema, validateForSubmission } from "@/domain/validation";
import { assertTransition } from "@/domain/state-machine";
import type { ExemptionReason } from "@/domain/types";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const app = await prisma.application.findUnique({ where: { id: params.id } });
    if (!app) return apiError("申请不存在", 404);

    const raw = await request.json();
    const parsed = submitSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError("缺少幂等键", 400);
    }

    const { idempotencyKey } = parsed.data;

    if (app.idempotencyKey === idempotencyKey) {
      return apiSuccess(serializeApplication(app));
    }

    if (app.state === "SUBMITTED" || app.state === "RESUBMITTED") {
      return apiSuccess(serializeApplication(app));
    }

    if (app.state !== "DRAFT" && app.state !== "NEEDS_CORRECTION") {
      return apiError(`当前状态 ${app.state} 不允许提交`, 403);
    }

    const validation = validateForSubmission({
      fullName: app.fullName,
      contactPhone: app.contactPhone,
      contactEmail: app.contactEmail,
      caseDescription: app.caseDescription,
      legalIssueType: app.legalIssueType,
      exemptionReason: app.exemptionReason as ExemptionReason,
      economicProofMeta: app.economicProofMeta,
      idDocumentMeta: app.idDocumentMeta,
      otherMaterialMeta: app.otherMaterialMeta,
    });

    if (!validation.valid) {
      return apiError("请补全所有必填信息", 422, validation.errors);
    }

    const targetState = app.state === "NEEDS_CORRECTION" ? "RESUBMITTED" : "SUBMITTED";
    assertTransition(app.state as never, targetState as never);

    const updated = await prisma.application.update({
      where: { id: params.id },
      data: {
        state: targetState,
        idempotencyKey,
        submittedAt: new Date(),
        version: app.version + 1,
      },
    });

    await prisma.auditLog.create({
      data: {
        applicationId: params.id,
        action: targetState === "RESUBMITTED" ? "RESUBMITTED" : "SUBMITTED",
        fromState: app.state,
        toState: targetState,
        actor: "APPLICANT",
        details: JSON.stringify({ idempotencyKey }),
      },
    });

    if (app.state === "NEEDS_CORRECTION") {
      await prisma.correction.updateMany({
        where: { applicationId: params.id, resolved: false },
        data: { resolved: true, resolvedAt: new Date() },
      });
    }

    return apiSuccess(serializeApplication(updated));
  } catch (err) {
    console.error("Submit error:", err);
    return apiError("提交失败", 500);
  }
}
