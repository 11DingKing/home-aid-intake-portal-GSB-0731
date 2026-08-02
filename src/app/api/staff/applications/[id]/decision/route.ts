import type { NextRequest } from "next/server";
import { staffDecision } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { badRequest } from "@/server/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["accept", "decline"]),
  note: z.string().max(1000).optional(),
});

// POST /api/staff/applications/:id/decision — accept or decline.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw badRequest("Request body must be valid JSON.");
    }
    const parsed = bodySchema.parse(json);
    const app = await staffDecision(id, parsed.action, parsed.note);
    return ok(app);
  } catch (err) {
    return errorResponse(err);
  }
}
