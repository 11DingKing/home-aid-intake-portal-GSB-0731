import type { NextRequest } from "next/server";
import { getStaffView } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { badRequest } from "@/server/errors";
import { STAFF_VIEWS, type StaffViewName } from "@/domain/constants";

export const dynamic = "force-dynamic";

function parseView(raw: string | null): StaffViewName {
  if (raw && raw in STAFF_VIEWS) return raw as StaffViewName;
  // Default to the narrowest sensible view.
  return "INTAKE_REVIEW";
}

// GET /api/staff/applications/:id?view=INTAKE_REVIEW|CORRECTION_REVIEW
// Returns ONLY the fields whitelisted for the requested disclosure view.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const viewParam = req.nextUrl.searchParams.get("view");
    if (viewParam && !(viewParam in STAFF_VIEWS)) {
      throw badRequest(`Unknown staff view: ${viewParam}`);
    }
    const view = parseView(viewParam);
    const disclosed = await getStaffView(id, view);
    return ok(disclosed);
  } catch (err) {
    return errorResponse(err);
  }
}
