import type { NextRequest } from "next/server";
import { requestCorrection } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { badRequest } from "@/server/errors";
import { z } from "zod";
import { APPLICANT_FIELD_KEYS, CORRECTION_REASON_CODES } from "@/domain/constants";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fields: z
    .array(z.enum(APPLICANT_FIELD_KEYS))
    .min(1, "Select at least one field to correct."),
  reasonCode: z.enum(CORRECTION_REASON_CODES),
  note: z.string().max(1000).optional(),
});

// POST /api/staff/applications/:id/request-correction
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
    const app = await requestCorrection(id, parsed.fields, parsed.reasonCode, parsed.note);
    return ok(app);
  } catch (err) {
    return errorResponse(err);
  }
}
