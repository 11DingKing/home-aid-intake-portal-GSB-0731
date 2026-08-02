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

/** 工作人员列表：按视图做最小披露投影，越权字段不出服务器。 */
export async function GET(request: Request) {
  try {
    const view =
      new URL(request.url).searchParams.get("view") ?? "INTAKE_REVIEW";
    if (!isStaffView(view)) {
      throw new ApiError(
        400,
        "BAD_VIEW",
        "view 必须是 INTAKE_REVIEW 或 CORRECTION_REVIEW",
      );
    }
    const apps = await prisma.application.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        materials: true,
        corrections: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    const items = apps.map((a) =>
      projectForStaffView(
        {
          ...a,
          state: a.state as AppState,
          corrections: a.corrections,
        },
        view as StaffView,
      ),
    );
    return NextResponse.json({ view, items });
  } catch (e) {
    return jsonError(e);
  }
}
