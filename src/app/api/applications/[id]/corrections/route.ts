import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeCorrection, serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError, apiConflict } from "@/lib/api-response";
import { correctionCreateSchema } from "@/domain/validation";
import { assertTransition } from "@/domain/state-machine";
import { saveSnapshot, getBaseForMerge } from "@/lib/snapshots";
import { diffChangedFields, CLIENT_EDITABLE_FIELDS } from "@/domain/conflict";
import { writeAuditLog, logRejectedFields, logInvalidTransition } from "@/lib/audit";
import { validateStaffMutation, getStaleLinkState } from "@/domain/field-permissions";

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

    const raw = (await request.json()) as Record<string, unknown>;

    const fieldValidation = validateStaffMutation(raw, app.state as never, "correction");
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

    const parsed = correctionCreateSchema.safeParse(raw);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return apiError("数据校验失败", 422, errors);
    }

    if (app.state !== "SUBMITTED" && app.state !== "RESUBMITTED") {
      await logInvalidTransition(
        params.id,
        "STAFF",
        app.state,
        "NEEDS_CORRECTION",
        `Correction not allowed in state ${app.state}`
      );
      return apiError(`当前状态 ${app.state} 不允许发起补正`, 403, undefined, {
        currentState: app.state,
      });
    }

    const { fields, reasonCode, version } = parsed.data;

    if (version !== undefined && version < app.version) {
      const baseData = await getBaseForMerge(params.id, version, app);
      const serverApp = serializeApplication(app);
      const serverData = serverApp as unknown as Record<string, unknown>;
      const changedFields = diffChangedFields(
        baseData,
        serverData,
        CLIENT_EDITABLE_FIELDS as readonly string[]
      );

      const staleInfo = getStaleLinkState("SUBMITTED", app.state as never);

      await writeAuditLog({
        applicationId: params.id,
        action: "STALE_LINK_DETECTED",
        fromState: app.state,
        actor: "STAFF",
        details: { staffVersion: version, serverVersion: app.version, changedFields },
      });

      return apiConflict("申请数据已被修改，请刷新后重试", {
        serverData: serverApp,
        conflicts: changedFields,
        serverVersion: app.version,
        changedByOther: changedFields,
        serverWins: changedFields,
        applicantWins: [],
        autoMerged: [],
        staleLink: staleInfo.isStale ? { message: staleInfo.message } : undefined,
      });
    }

    assertTransition(app.state as never, "NEEDS_CORRECTION");

    const existingActive = await prisma.correction.findFirst({
      where: { applicationId: params.id, resolved: false },
    });

    let correction;
    if (existingActive) {
      correction = await prisma.correction.update({
        where: { id: existingActive.id },
        data: {
          fields: JSON.stringify(fields),
          reasonCode,
        },
      });
    } else {
      correction = await prisma.correction.create({
        data: {
          applicationId: params.id,
          fields: JSON.stringify(fields),
          reasonCode,
        },
      });
    }

    const updated = await prisma.application.update({
      where: { id: params.id },
      data: { state: "NEEDS_CORRECTION", version: app.version + 1 },
    });

    await saveSnapshot(updated, "STAFF");

    await writeAuditLog({
      applicationId: params.id,
      action: "CORRECTION_REQUESTED",
      fromState: app.state,
      toState: "NEEDS_CORRECTION",
      actor: "STAFF",
      details: { fields, reasonCode, staffBaseVersion: version ?? null, rejectionReason: reasonCode },
    });

    return apiSuccess(serializeCorrection(correction), 201);
  } catch (err) {
    console.error("Correction error:", err);
    return apiError("发起补正失败", 500);
  }
}
