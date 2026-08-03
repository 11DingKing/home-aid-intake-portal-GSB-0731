import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeCorrection, serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError, apiConflict } from "@/lib/api-response";
import { correctionCreateSchema } from "@/domain/validation";
import { assertTransition } from "@/domain/state-machine";
import { saveSnapshot, getBaseForMerge } from "@/lib/snapshots";
import { diffChangedFields, CLIENT_EDITABLE_FIELDS } from "@/domain/conflict";

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
      return apiError(`当前状态 ${app.state} 不允许发起补正`, 403, undefined, {
        currentState: app.state,
      });
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

      return apiConflict("申请数据已被申请人修改，请刷新后重试", {
        serverData: serverApp,
        conflicts: changedFields,
        serverVersion: app.version,
        changedByOther: changedFields,
        serverWins: changedFields,
        applicantWins: [],
        autoMerged: [],
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

    await prisma.auditLog.create({
      data: {
        applicationId: params.id,
        action: "CORRECTION_REQUESTED",
        fromState: app.state,
        toState: "NEEDS_CORRECTION",
        actor: "STAFF",
        details: JSON.stringify({ fields, reasonCode, staffBaseVersion: version ?? null }),
      },
    });

    return apiSuccess(serializeCorrection(correction), 201);
  } catch (err) {
    console.error("Correction error:", err);
    return apiError("发起补正失败", 500);
  }
}
