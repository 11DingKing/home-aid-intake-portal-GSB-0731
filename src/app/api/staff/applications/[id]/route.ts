import type { NextRequest } from "next/server";
import { getStaffContinuation } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";

export const dynamic = "force-dynamic";

// GET /api/staff/applications/:id?view=INTAKE_REVIEW|CORRECTION_REVIEW
//
// The disclosure view is RECOMPUTED server-side from the current application
// state — the `view` query param is only a hint. A stale link that requests a
// broader view than the current state permits is downgraded (and audited), so
// the body only ever contains fields whitelisted for the enforced view. The
// enforcement outcome is surfaced via response headers for transparency.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const viewParam = req.nextUrl.searchParams.get("view");
    const result = await getStaffContinuation(id, viewParam);
    const res = ok(result.disclosed);
    res.headers.set("X-Enforced-View", result.enforcedView);
    res.headers.set("X-View-Downgraded", String(result.downgraded));
    res.headers.set("X-Application-State", result.state);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
