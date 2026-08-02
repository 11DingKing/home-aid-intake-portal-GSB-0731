import type { NextRequest } from "next/server";
import { listApplicationsForStaff } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";

export const dynamic = "force-dynamic";

// GET /api/staff/applications — queue for staff (no sensitive PII in the list).
export async function GET(_req: NextRequest) {
  try {
    const items = await listApplicationsForStaff();
    return ok({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
