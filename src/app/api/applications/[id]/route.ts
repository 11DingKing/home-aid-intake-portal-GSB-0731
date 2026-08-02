import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, saveDraft, serializeApplicantView } from "@/lib/services";
import { draftFieldsSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

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

/** 草稿保存：{ baseVersion, fields } → 字段级合并，回传最新 version 与冲突。 */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
    const baseVersion = body.baseVersion;
    if (typeof baseVersion !== "number") {
      throw new ApiError(400, "BAD_VERSION", "缺少 baseVersion");
    }
    const parsed = draftFieldsSchema.partial().safeParse(body.fields ?? {});
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
