import type { NextRequest } from "next/server";
import { getApplicantContinuation } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";

export const dynamic = "force-dynamic";

// GET /api/applications/:id/continuation?step=contact|eligibility|materials|accommodations|review
//
// Applicant continuation read scoped to a single step. The readable + writable
// field sets are recomputed server-side from (state, step); fields the step does
// not own are never included in the payload. Every read is audited.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const step = req.nextUrl.searchParams.get("step") ?? "review";
    const result = await getApplicantContinuation(id, step);
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
