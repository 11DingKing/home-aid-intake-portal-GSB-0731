import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError, apiConflict } from "@/lib/api-response";
import { draftUpdateSchema, isEconomicProofRequired } from "@/domain/validation";
import {
  threeWayMerge,
  sanitizeClientDraft,
  CLIENT_EDITABLE_FIELDS,
  diffChangedFields,
} from "@/domain/conflict";
import { isEditableState } from "@/domain/state-machine";
import { saveSnapshot, getBaseForMerge } from "@/lib/snapshots";
import { PROTECTED_FIELDS } from "@/domain/types";
import type { ExemptionReason } from "@/domain/types";

interface RouteContext {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return apiError("申请不存在", 404);
  return apiSuccess(serializeApplication(app));
}

function buildUpdateData(
  input: Record<string, unknown>,
  app: { exemptionReason: string; accommodations: string },
  merged: Record<string, unknown>
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};

  const stringFields = ["fullName", "contactPhone", "contactEmail", "caseDescription", "legalIssueType", "exemptionReason"];
  for (const field of stringFields) {
    if (field in merged) {
      updateData[field] = merged[field] ?? null;
    } else if (field in input) {
      updateData[field] = input[field] ?? null;
    }
  }

  if ("accommodations" in merged) {
    const accoms = merged.accommodations;
    if (Array.isArray(accoms)) {
      updateData.accommodations = JSON.stringify(accoms);
    }
  } else if (input.accommodations !== undefined && Array.isArray(input.accommodations)) {
    const existingAccoms = JSON.parse(app.accommodations) as string[];
    const mergedAccoms = Array.from(new Set([...existingAccoms, ...input.accommodations]));
    updateData.accommodations = JSON.stringify(mergedAccoms);
  }

  const materialFields = ["economicProofMeta", "idDocumentMeta", "otherMaterialMeta"] as const;
  for (const field of materialFields) {
    if (field in merged) {
      const val = merged[field];
      updateData[field] = val ? JSON.stringify(val) : null;
    } else if (field in input) {
      const val = input[field];
      if (field === "economicProofMeta") {
        const exemption = ((merged.exemptionReason as string) ?? app.exemptionReason) as ExemptionReason;
        if (isEconomicProofRequired(exemption) || val !== null) {
          updateData[field] = val ? JSON.stringify(val) : null;
        } else {
          updateData[field] = null;
        }
      } else {
        updateData[field] = val ? JSON.stringify(val) : null;
      }
    }
  }

  return updateData;
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const app = await prisma.application.findUnique({ where: { id: params.id } });
    if (!app) return apiError("申请不存在", 404);

    if (!isEditableState(app.state as never)) {
      return apiError(`当前状态 ${app.state} 不允许编辑`, 403);
    }

    const raw = await request.json();
    const parsed = draftUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return apiError("数据校验失败", 422, errors);
    }

    const input = parsed.data;
    const clientVersion = input.version;
    const sanitizedClient = sanitizeClientDraft(
      input as Record<string, unknown>,
      CLIENT_EDITABLE_FIELDS
    );

    if (clientVersion < app.version) {
      const baseData = await getBaseForMerge(params.id, clientVersion, app);
      const serverApp = serializeApplication(app);
      const serverData = serverApp as unknown as Record<string, unknown>;

      const result = threeWayMerge(baseData, sanitizedClient, serverData, PROTECTED_FIELDS);

      const hasTrueConflicts = result.conflicts.length > 0;
      const hasProtectedAutoMerge = result.autoMerged.length > 0;

      if (hasTrueConflicts) {
        return apiConflict("草稿版本冲突，已执行字段级三方合并", {
          serverData: result.merged,
          conflicts: result.conflicts,
          serverVersion: app.version,
          applicantWins: result.applicantWins,
          serverWins: result.serverWins,
          autoMerged: result.autoMerged,
          changedByOther: diffChangedFields(baseData, serverData, CLIENT_EDITABLE_FIELDS as readonly string[]),
        });
      }

      const updateData = buildUpdateData(sanitizedClient, app, result.merged);
      if (Object.keys(updateData).length > 0 || hasProtectedAutoMerge) {
        updateData.version = app.version + 1;
        const updated = await prisma.application.update({
          where: { id: params.id },
          data: updateData,
        });
        await saveSnapshot(updated, "APPLICANT");
        await prisma.auditLog.create({
          data: {
            applicationId: params.id,
            action: "DRAFT_MERGED",
            fromState: app.state,
            toState: updated.state,
            actor: "APPLICANT",
            details: JSON.stringify({
              conflicts: result.conflicts,
              autoMerged: result.autoMerged,
              serverWins: result.serverWins,
            }),
          },
        });
        return apiSuccess(serializeApplication(updated));
      }

      return apiSuccess(serverApp);
    }

    const updateData = buildUpdateData(sanitizedClient, app, {} as Record<string, unknown>);
    updateData.version = app.version + 1;

    const updated = await prisma.application.update({
      where: { id: params.id },
      data: updateData,
    });

    await saveSnapshot(updated, "APPLICANT");

    return apiSuccess(serializeApplication(updated));
  } catch (err) {
    console.error("PUT application error:", err);
    return apiError("保存草稿失败", 500);
  }
}
