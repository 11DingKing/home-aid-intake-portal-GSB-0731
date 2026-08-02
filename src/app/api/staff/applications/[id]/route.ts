import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { ApiError } from "@/lib/services";
import {
  isStaffView,
  projectForStaffView,
  type StaffView,
} from "@/lib/disclosure";
import type { AppState } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const view =
      new URL(request.url).searchParams.get("view") ?? "INTAKE_REVIEW";
    if (!isStaffView(view)) {
      throw new ApiError(
        400,
        "BAD_VIEW",
        "view 必须是 INTAKE_REVIEW 或 CORRECTION_REVIEW",
      );
    }
    const app = await prisma.application.findUnique({
      where: { id },
      include: {
        materials: true,
        corrections: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
    return NextResponse.json(
      projectForStaffView(
        { ...app, state: app.state as AppState },
        view as StaffView,
      ),
    );
  } catch (e) {
    return jsonError(e);
  }
}
