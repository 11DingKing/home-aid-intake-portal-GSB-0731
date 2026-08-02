import type { NextRequest } from "next/server";
import { patchDraft } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { draftPatchSchema } from "@/domain/validation";
import { badRequest } from "@/server/errors";
import type { IncomingEdit, StoredValue } from "@/domain/merge";
import type { ApplicantFieldKey } from "@/domain/constants";

export const dynamic = "force-dynamic";

// PATCH /api/applications/:id/draft — field-level merge of offline draft edits.
// Body: { baseVersion, edits: [{ key, value, baseVersion }] }
export async function PATCH(
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
    const parsed = draftPatchSchema.parse(json);

    const edits: IncomingEdit[] = parsed.edits.map((e) => ({
      key: e.key as ApplicantFieldKey,
      value: e.value as StoredValue,
      baseVersion: e.baseVersion,
    }));

    const result = await patchDraft(id, parsed.baseVersion, edits);
    // 200 with conflicts array; client reconciles field-by-field.
    return ok({
      application: result.application,
      applied: result.applied.map(summarize),
      conflicts: result.conflicts.map(summarize),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

function summarize(r: {
  key: string;
  status: string;
  serverValue: StoredValue;
  incomingValue: StoredValue;
  resolvedValue: StoredValue;
  serverVersion: number;
  conflictReason?: string;
}) {
  return {
    key: r.key,
    status: r.status,
    serverValue: r.serverValue,
    incomingValue: r.incomingValue,
    resolvedValue: r.resolvedValue,
    serverVersion: r.serverVersion,
    conflictReason: r.conflictReason ?? null,
  };
}
