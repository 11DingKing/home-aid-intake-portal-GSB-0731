import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, staffTransition } from "@/lib/services";
import { correctionInputSchema } from "@/lib/validation";
import type { TransitionAction } from "@/lib/state-machine";
import { isStaffView, projectForStaffView } from "@/lib/disclosure";
import type { AppState } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

const STAFF_ACTIONS: TransitionAction[] = [
  "REQUEST_CORRECTION",
  "ACCEPT",
  "DECLINE",
];

/** 工作人员状态操作：请求补正 / 受理 / 不予受理。响应同样按视图投影。 */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await readJson(request);
    const action = body.action;
    if (
      typeof action !== "string" ||
      !STAFF_ACTIONS.includes(action as TransitionAction)
    ) {
      throw new ApiError(
        400,
        "BAD_ACTION",
        "action 必须是 REQUEST_CORRECTION / ACCEPT / DECLINE",
      );
    }
    let payload: { fields?: string[]; reasonCode?: string; note?: string } = {};
    if (action === "REQUEST_CORRECTION") {
      const parsed = correctionInputSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "BAD_CORRECTION",
          "请求补正必须包含 fields 与 reasonCode",
          {
            issues: parsed.error.issues,
          },
        );
      }
      payload = parsed.data;
    } else if (typeof body.note === "string") {
      payload = { note: body.note };
    }

    const updated = await prisma.$transaction((tx) =>
      staffTransition(tx, id, action as TransitionAction, payload),
    );

    const view =
      new URL(request.url).searchParams.get("view") ?? "INTAKE_REVIEW";
    const safeView = isStaffView(view) ? view : "INTAKE_REVIEW";
    return NextResponse.json(
      projectForStaffView(
        { ...updated, state: updated.state as AppState },
        safeView,
      ),
    );
  } catch (e) {
    return jsonError(e);
  }
}
