import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, serializeApplicantView } from "@/lib/services";
import { materialInputSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** 添加材料元数据（只存元数据，不存文件本体）。 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
    const parsed = materialInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "BAD_MATERIAL", "材料信息不合法", {
        issues: parsed.error.issues,
      });
    }
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    if (app.state !== "DRAFT" && app.state !== "NEEDS_CORRECTION") {
      throw new ApiError(
        409,
        "DRAFT_LOCKED",
        `当前状态 ${app.state} 不可修改材料`,
      );
    }

    const materialId = `MAT-${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.material.create({
      data: {
        id: materialId,
        applicationId: id,
        kind: parsed.data.kind,
        label: parsed.data.label,
        metadata: JSON.stringify(parsed.data.metadata),
      },
    });
    const updated = await prisma.application.update({
      where: { id },
      data: { version: { increment: 1 } },
      include: {
        materials: true,
        corrections: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return NextResponse.json(serializeApplicantView(updated), { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
