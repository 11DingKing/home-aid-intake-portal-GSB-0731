import type { NextRequest } from "next/server";
import { getApplication } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";

export const dynamic = "force-dynamic";

// GET /api/applications/:id — full applicant-facing view (owner surface).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const app = await getApplication(id);
    return ok(app);
  } catch (err) {
    return errorResponse(err);
  }
}
