import type { NextRequest } from "next/server";
import { replaceMaterial } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { badRequest } from "@/server/errors";
import { z } from "zod";
import { MATERIAL_KINDS } from "@/domain/constants";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fieldKey: z.enum(["identityProof", "economicProof"]),
  kind: z.enum(MATERIAL_KINDS),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
  checksum: z.string().max(200).optional(),
  materialId: z.string().min(1).max(200).optional(),
});

// POST /api/applications/:id/materials — replace attachment METADATA (never
// bytes) bound to a material field. Preserves accommodations and all other
// fields. Editable only in DRAFT / NEEDS_CORRECTION.
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
    const result = await replaceMaterial(id, {
      fieldKey: parsed.fieldKey,
      kind: parsed.kind,
      filename: parsed.filename,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      checksum: parsed.checksum ?? null,
      ...(parsed.materialId ? { materialId: parsed.materialId } : {}),
    });
    return ok(result, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
