import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication, serializeCorrection } from "@/lib/serializers";
import { apiSuccess, apiError } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit";
import {
  getFieldsForApplicantStep,
  getStaffVisibleFields,
  getStaffViewForState,
  getApplicantAccessibleSteps,
  getStaleLinkState,
  type Role,
} from "@/domain/field-permissions";
import type { ApplicationState } from "@/domain/types";

interface RouteContext {
  params: { id: string };
}

function projectFields(
  data: Record<string, unknown>,
  allowedFields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in data) {
      result[field] = data[field];
    }
  }
  return result;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return apiError("申请不存在", 404);

  const url = new URL(request.url);
  const role = (url.searchParams.get("role") as Role) || "APPLICANT";
  const step = url.searchParams.get("step") || undefined;
  const expectedState = url.searchParams.get("expectedState") as ApplicationState | null;

  const serialized = serializeApplication(app);
  const appData = serialized as unknown as Record<string, unknown>;

  const staleInfo = expectedState
    ? getStaleLinkState(expectedState, app.state as ApplicationState)
    : null;

  if (staleInfo?.isStale) {
    await writeAuditLog({
      applicationId: params.id,
      action: "STALE_LINK_DETECTED",
      fromState: expectedState!,
      toState: app.state,
      actor: role === "STAFF" ? "STAFF" : "APPLICANT",
    });
  }

  let projectedData: Record<string, unknown>;
  let accessibleSteps: ReturnType<typeof getApplicantAccessibleSteps> = [];
  let view: string | null = null;
  let corrections: unknown[] = [];

  if (role === "STAFF") {
    view = getStaffViewForState(app.state as ApplicationState);
    if (view === "NONE") {
      return apiError("当前状态不允许工作人员查看", 403, undefined, {
        currentState: app.state,
      });
    }

    const correctionRecords = await prisma.correction.findMany({
      where: { applicationId: params.id },
      orderBy: { createdAt: "desc" },
    });
    corrections = correctionRecords.map(serializeCorrection);

    const visibleFields = getStaffVisibleFields(app.state as ApplicationState);
    projectedData = projectFields(appData, visibleFields);

    if (view === "CORRECTION_REVIEW") {
      const active = corrections.filter(
        (c) => !(c as { resolved: boolean }).resolved
      ) as { fields: string[] }[];
      projectedData.correctionFields = active.flatMap((c) => c.fields);
      projectedData.activeCorrections = active;
    }
  } else {
    const stepId = step || "personal";
    const access = getFieldsForApplicantStep(app.state as ApplicationState, stepId);
    accessibleSteps = getApplicantAccessibleSteps(app.state as ApplicationState);

    projectedData = projectFields(appData, access.allReadable);
    projectedData._editableFields = access.editable;
    projectedData._currentStep = stepId;
  }

  await writeAuditLog({
    applicationId: params.id,
    action: "FIELD_PROJECTION",
    fromState: app.state,
    actor: role === "STAFF" ? "STAFF" : "APPLICANT",
    details: {
      role,
      step,
      view,
      expectedState,
      staleDetected: staleInfo?.isStale ?? false,
      projectedFieldCount: Object.keys(projectedData).length,
    },
  });

  return apiSuccess({
    application: projectedData,
    state: app.state,
    version: app.version,
    role,
    view,
    accessibleSteps: role === "APPLICANT" ? accessibleSteps : undefined,
    staleLink: staleInfo?.isStale
      ? { message: staleInfo.message, expectedState, actualState: app.state }
      : null,
    corrections: role === "STAFF" ? corrections : undefined,
  });
}
