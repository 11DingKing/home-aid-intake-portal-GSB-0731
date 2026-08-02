import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, replaceMaterialMetadata, serializeApplicantView } from "@/lib/services";

type Ctx = { params: Promise<{ id: string; materialId: string }> };

/** 替换材料元数据：{ label?, metadata }，保留材料 ID 与种类。 */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id, materialId } = await ctx.params;
    const body = await readJson(request);
    if (body.metadata !== undefined && (typeof body.metadata !== "object" || body.metadata === null || Array.isArray(body.metadata))) {
      throw new ApiError(400, "BAD_MATERIAL", "metadata 必须是对象");
    }
    if (body.label !== undefined && typeof body.label !== "string") {
      throw new ApiError(400, "BAD_MATERIAL", "label 必须是字符串");
    }
    const updated = await prisma.$transaction((tx) =>
      replaceMaterialMetadata(tx, id, materialId, {
        label: body.label as string | undefined,
        metadata: (body.metadata ?? {}) as Record<string, unknown>,
      }),
    );
    return NextResponse.json(serializeApplicantView(updated));
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const { id, materialId } = await ctx.params;
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    if (app.state !== "DRAFT" && app.state !== "NEEDS_CORRECTION") {
      throw new ApiError(
        409,
        "DRAFT_LOCKED",
        `当前状态 ${app.state} 不可修改材料`,
      );
    }
    const material = await prisma.material.findUnique({
      where: { id: materialId },
    });
    if (!material || material.applicationId !== id) {
      throw new ApiError(404, "NOT_FOUND", `材料 ${materialId} 不存在`);
    }
    await prisma.material.delete({ where: { id: materialId } });
    const updated = await prisma.application.update({
      where: { id },
      data: { version: { increment: 1 } },
      include: {
        materials: true,
        corrections: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return NextResponse.json(serializeApplicantView(updated));
  } catch (e) {
    return jsonError(e);
  }
}
