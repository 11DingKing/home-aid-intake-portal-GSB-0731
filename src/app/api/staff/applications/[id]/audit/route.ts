import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { ApiError } from "@/lib/services";

type Ctx = { params: Promise<{ id: string }> };

/** 工作人员审计轨迹：状态流转与可审计的拒绝理由（不含申请人字段值）。 */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({
      id,
      events: events.map((e) => ({
        actor: e.actor,
        fromState: e.fromState,
        toState: e.toState,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
