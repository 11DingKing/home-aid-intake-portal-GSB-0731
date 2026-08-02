import type { NextRequest } from "next/server";
import { patchDraft } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";
import { draftPatchSchema } from "@/domain/validation";
import { badRequest } from "@/server/errors";
import type { FieldMergeResult, IncomingEdit, StoredValue } from "@/domain/merge";
import type { ApplicantFieldKey } from "@/domain/constants";

export const dynamic = "force-dynamic";

// PATCH /api/applications/:id/draft — field-level three-way merge of draft edits.
// Body: { baseVersion, edits: [{ key, value, baseVersion, baseValue? }] }
// When `baseValue` is present the server performs a base/server/client three-way
// merge; otherwise it falls back to version-based two-way resolution.
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

    const edits: IncomingEdit[] = parsed.edits.map((e) => {
      const edit: IncomingEdit = {
        key: e.key as ApplicantFieldKey,
        value: e.value as StoredValue,
        baseVersion: e.baseVersion,
      };
      // Only set baseValue when the client actually supplied it (distinguish
      // "absent" from "present but null" to select three-way vs version merge).
      if (Object.prototype.hasOwnProperty.call(e, "baseValue")) {
        edit.baseValue = e.baseValue as StoredValue;
      }
      return edit;
    });

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

function summarize(r: FieldMergeResult) {
  return {
    key: r.key,
    status: r.status,
    serverValue: r.serverValue,
    incomingValue: r.incomingValue,
    resolvedValue: r.resolvedValue,
    baseValue: r.baseValue ?? null,
    serverVersion: r.serverVersion,
    basis: r.basis,
    conflictReason: r.conflictReason ?? null,
  };
}
