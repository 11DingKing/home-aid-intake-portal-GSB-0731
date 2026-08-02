import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, readJson } from "@/lib/api-helpers";
import { ApiError, recordRejection, staffTransition } from "@/lib/services";
import { correctionInputSchema } from "@/lib/validation";
import type { TransitionAction } from "@/lib/state-machine";
import { isStaffView, projectForStaffView } from "@/lib/disclosure";
import { fieldForbiddenReason, findRejectedFields } from "@/lib/policy";
import type { AppState } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

const STAFF_ACTIONS: TransitionAction[] = [
  "REQUEST_CORRECTION",
  "ACCEPT",
  "DECLINE",
];
const TOP_LEVEL_KEYS = ["action", "fields", "reasonCode", "note"];

/** 工作人员状态操作：请求补正 / 受理 / 不予受理。响应同样按视图投影。 */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const body = await readJson(request);
    const app = await prisma.application.findUnique({ where: { id } });
    if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);

    // 白名单外请求键（如伪造的 state/contactName）整体拒绝并审计
    const rejected = findRejectedFields(Object.keys(body), TOP_LEVEL_KEYS);
    if (rejected.length > 0) {
      const reason = fieldForbiddenReason(
        "STAFF",
        app.state as AppState,
        rejected,
      );
      await recordRejection(prisma, id, "STAFF", reason);
      throw new ApiError(403, "FIELD_FORBIDDEN", reason, {
        rejectedFields: rejected,
      });
    }

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

    try {
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
      // 非法状态流转留下可审计的拒绝理由
      if (e instanceof ApiError && e.code === "STATE_CONFLICT") {
        await recordRejection(
          prisma,
          id,
          "STAFF",
          `STATE_CONFLICT: STAFF 在 ${app.state} 状态尝试 ${action}，被状态机拒绝`,
        );
      }
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}
