import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, saveStaffCorrection } from "@/lib/services";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 工作人员编辑补正要求：{ baseVersion, fields?, reasonCode?, note? }。
 * 与申请人草稿共用同一乐观版本合并域；冲突字段随响应返回。
 */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
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
