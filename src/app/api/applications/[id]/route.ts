import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import {
  ApiError,
  recordRejection,
  saveDraft,
  serializeApplicantView,
} from "@/lib/services";
import { draftFieldsSchema } from "@/lib/validation";
import {
  fieldForbiddenReason,
  findRejectedFields,
  stateConflictReason,
  writableFieldsFor,
} from "@/lib/policy";
import type { AppState } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

const TOP_LEVEL_KEYS = ["baseVersion", "fields"];

/** 申请人视角：读取自己的完整申请。 */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const app = await prisma.application.findUnique({
      where: { id },
      include: {
        materials: true,
        corrections: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    return NextResponse.json(serializeApplicantView(app));
  } catch (e) {
    return jsonError(e);
  }
}

/**
 * 草稿保存：{ baseVersion, fields } → 字段级合并。
 * 每次提交都在服务端按状态×角色×字段白名单重新计算；
 * 白名单外字段整体拒绝并写入可审计的拒绝理由。
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    const state = app.state as AppState;

    // 状态边界：非草稿状态拒绝并审计
    if (state !== "DRAFT" && state !== "NEEDS_CORRECTION") {
      const reason = stateConflictReason("APPLICANT", state, "PATCH draft");
      await recordRejection(prisma, id, "APPLICANT", reason);
      throw new ApiError(409, "DRAFT_LOCKED", `当前状态 ${state} 不可编辑草稿`);
    }

    // 字段白名单：顶层键 + fields 内键都必须落在可写集合内
    const fieldsObj =
      body.fields &&
      typeof body.fields === "object" &&
      !Array.isArray(body.fields)
        ? (body.fields as Record<string, unknown>)
        : {};
    const rejected = [
      ...findRejectedFields(Object.keys(body), TOP_LEVEL_KEYS),
      ...findRejectedFields(
        Object.keys(fieldsObj),
        writableFieldsFor("APPLICANT", state),
      ),
    ];
    if (rejected.length > 0) {
      const reason = fieldForbiddenReason("APPLICANT", state, rejected);
      await recordRejection(prisma, id, "APPLICANT", reason);
      throw new ApiError(403, "FIELD_FORBIDDEN", reason, {
        rejectedFields: rejected,
      });
    }

    const baseVersion = body.baseVersion;
    if (typeof baseVersion !== "number") {
      throw new ApiError(400, "BAD_VERSION", "缺少 baseVersion");
    }
    const parsed = draftFieldsSchema.partial().safeParse(fieldsObj);
    if (!parsed.success) {
      throw new ApiError(400, "BAD_FIELDS", "草稿字段不合法", {
        issues: parsed.error.issues,
      });
    }
    const result = await prisma.$transaction((tx) =>
      saveDraft(tx, id, baseVersion, parsed.data as Record<string, unknown>),
    );
    return NextResponse.json({
      ...serializeApplicantView(result.application),
      conflicts: result.conflicts,
    });
  } catch (e) {
    return jsonError(e);
  }
}
