import type { NextRequest } from "next/server";
import { getAuditTrail } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";

export const dynamic = "force-dynamic";

// GET /api/applications/:id/audit — the auditable field-level access decision
// trail (reads + write attempts, with allowed/denied fields and reason codes).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const entries = await getAuditTrail(id);
    return ok({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
