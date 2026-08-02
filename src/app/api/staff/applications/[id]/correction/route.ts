import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, recordRejection, saveStaffCorrection } from "@/lib/services";
import {
  CORRECTION_KEY_TO_PSEUDO,
  fieldForbiddenReason,
  findRejectedFields,
  stateConflictReason,
  writableFieldsFor,
} from "@/lib/policy";
import type { AppState } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

const TOP_LEVEL_KEYS = ["baseVersion", "fields", "reasonCode", "note"];

/**
 * 工作人员编辑补正要求：{ baseVersion, fields?, reasonCode?, note? }。
 * 与申请人草稿共用同一乐观版本合并域；白名单外字段整体拒绝并审计。
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    const state = app.state as AppState;

    // 状态边界：只有 NEEDS_CORRECTION 可编辑补正（旧链接提交同样被拒并审计）
    if (state !== "NEEDS_CORRECTION") {
      const reason = stateConflictReason("STAFF", state, "PATCH correction");
      await recordRejection(prisma, id, "STAFF", reason);
      throw new ApiError(409, "STATE_CONFLICT", `当前状态 ${state} 没有可编辑的补正要求`);
    }

    // 字段白名单：请求键映射到补正伪字段后校验
    const rejected = findRejectedFields(Object.keys(body), TOP_LEVEL_KEYS);
    const attemptedPseudo = Object.keys(body)
      .filter((k) => k !== "baseVersion")
      .map((k) => CORRECTION_KEY_TO_PSEUDO[k] ?? k);
    const rejectedPseudo = findRejectedFields(
      attemptedPseudo,
      writableFieldsFor("STAFF", state),
    );
    const allRejected = [...new Set([...rejected, ...rejectedPseudo])];
    if (allRejected.length > 0) {
      const reason = fieldForbiddenReason("STAFF", state, allRejected);
      await recordRejection(prisma, id, "STAFF", reason);
      throw new ApiError(403, "FIELD_FORBIDDEN", reason, { rejectedFields: allRejected });
    }

    const baseVersion = body.baseVersion;
    if (typeof baseVersion !== "number") {
      throw new ApiError(400, "BAD_VERSION", "缺少 baseVersion");
    }
    const patch: { fields?: string[]; reasonCode?: string; note?: string } = {};
    if (body.fields !== undefined) {
      if (!Array.isArray(body.fields) || body.fields.some((f) => typeof f !== "string")) {
        throw new ApiError(400, "BAD_CORRECTION", "fields 必须是字符串数组");
      }
      patch.fields = body.fields as string[];
    }
    if (body.reasonCode !== undefined) {
      if (typeof body.reasonCode !== "string" || !body.reasonCode.trim()) {
        throw new ApiError(400, "BAD_CORRECTION", "reasonCode 必须是非空字符串");
      }
      patch.reasonCode = body.reasonCode;
    }
    if (body.note !== undefined) {
      if (typeof body.note !== "string") {
        throw new ApiError(400, "BAD_CORRECTION", "note 必须是字符串");
      }
      patch.note = body.note;
    }

    const result = await prisma.$transaction((tx) =>
      saveStaffCorrection(tx, id, baseVersion, patch),
    );
    return NextResponse.json({ id, ...result });
  } catch (e) {
    return jsonError(e);
  }
}
