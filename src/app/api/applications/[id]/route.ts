import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError, apiConflict } from "@/lib/api-response";
import { draftUpdateSchema, isEconomicProofRequired } from "@/domain/validation";
import { resolveFieldLevelConflict, sanitizeClientDraft, CLIENT_EDITABLE_FIELDS } from "@/domain/conflict";
import { isEditableState } from "@/domain/state-machine";
import type { ExemptionReason } from "@/domain/types";

interface RouteContext {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return apiError("申请不存在", 404);
  return apiSuccess(serializeApplication(app));
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const app = await prisma.application.findUnique({ where: { id: params.id } });
    if (!app) return apiError("申请不存在", 404);

    if (!isEditableState(app.state as never)) {
      return apiError("当前状态不允许编辑", 403);
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

    if (clientVersion < app.version) {
      const serverApp = serializeApplication(app);
      const sanitizedClient = sanitizeClientDraft(
        input as Record<string, unknown>,
        CLIENT_EDITABLE_FIELDS
      );

      const result = resolveFieldLevelConflict(
        serverApp as unknown as Record<string, unknown>,
        sanitizedClient,
        clientVersion,
        app.version
      );

      return apiConflict(
        "草稿版本冲突，已执行字段级合并",
        result.merged,
        result.conflicts,
        app.version
      );
    }

    const updateData: Record<string, unknown> = {
      version: app.version + 1,
    };

    if (input.fullName !== undefined) updateData.fullName = input.fullName;
    if (input.contactPhone !== undefined) updateData.contactPhone = input.contactPhone;
    if (input.contactEmail !== undefined) updateData.contactEmail = input.contactEmail || null;
    if (input.caseDescription !== undefined) updateData.caseDescription = input.caseDescription;
    if (input.legalIssueType !== undefined) updateData.legalIssueType = input.legalIssueType;
    if (input.exemptionReason !== undefined) updateData.exemptionReason = input.exemptionReason;

    if (input.accommodations !== undefined) {
      const existingAccoms = JSON.parse(app.accommodations) as string[];
      const merged = Array.from(new Set([...existingAccoms, ...input.accommodations]));
      updateData.accommodations = JSON.stringify(merged);
    }

    if (input.economicProofMeta !== undefined) {
      const exemption = (input.exemptionReason ?? app.exemptionReason) as ExemptionReason;
      if (isEconomicProofRequired(exemption) || input.economicProofMeta !== null) {
        updateData.economicProofMeta = input.economicProofMeta
          ? JSON.stringify(input.economicProofMeta)
          : null;
      } else if (!isEconomicProofRequired(exemption)) {
        updateData.economicProofMeta = null;
      }
    }

    if (input.idDocumentMeta !== undefined) {
      updateData.idDocumentMeta = input.idDocumentMeta
        ? JSON.stringify(input.idDocumentMeta)
        : null;
    }
    if (input.otherMaterialMeta !== undefined) {
      updateData.otherMaterialMeta = input.otherMaterialMeta
        ? JSON.stringify(input.otherMaterialMeta)
        : null;
    }

    const updated = await prisma.application.update({
      where: { id: params.id },
      data: updateData,
    });

    return apiSuccess(serializeApplication(updated));
  } catch (err) {
    console.error("PUT application error:", err);
    return apiError("保存草稿失败", 500);
  }
}
