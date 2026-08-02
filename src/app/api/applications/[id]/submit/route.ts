import type { NextRequest } from "next/server";
import { submitApplication } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { badRequest } from "@/server/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  // Optional in body; header Idempotency-Key takes precedence if present.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

// POST /api/applications/:id/submit — final submission or post-correction
// resubmission. Idempotent via Idempotency-Key header (or body field).
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
    const headerKey = req.headers.get("idempotency-key") ?? undefined;
    const idempotencyKey = headerKey ?? parsed.idempotencyKey;
    if (!idempotencyKey) {
      throw badRequest("An Idempotency-Key header or idempotencyKey field is required.");
    }

    const result = await submitApplication(id, idempotencyKey, parsed.baseVersion);
    return ok({ application: result.application, replayed: result.replayed });
  } catch (err) {
    return errorResponse(err);
  }
}
