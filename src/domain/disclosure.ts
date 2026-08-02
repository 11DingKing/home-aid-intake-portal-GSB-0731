import { STAFF_VIEWS, type StaffViewName } from "./constants";

// Field-level disclosure projection for staff surfaces (least privilege).
//
// The staff continuation pages must only ever see the fields enumerated for the
// active view in materials/application-cases.json. This module is the single
// choke point that projects a full application into a disclosure-limited shape;
// any field not listed for the view is never included in the payload — it is
// not merely hidden in the UI.

export interface MaterialMetadataView {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

// The complete internal projection source. Only whitelisted keys are emitted.
export interface FullApplicationProjection {
  id: string;
  state: string;
  exemptionReason: string | null;
  accommodations: string[];
  accommodationNote: string | null;
  correctionFields: string[];
  materialMetadata: MaterialMetadataView[];
  // Metadata for fields the applicant submitted (no raw values beyond what the
  // view allows) — used by CORRECTION_REVIEW.
  submittedFieldMetadata: Array<{ key: string; present: boolean; updatedAtVersion: number }>;
  // Sensitive fields that must NOT leak to staff views that don't list them.
  fullName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export type DisclosedApplication = Partial<Record<keyof FullApplicationProjection, unknown>> & {
  __view: StaffViewName;
};

/**
 * Project a full application down to exactly the fields allowed for `view`.
 * Returns an object containing ONLY whitelisted keys plus a `__view` tag.
 */
export function projectForStaff(
  view: StaffViewName,
  full: FullApplicationProjection,
): DisclosedApplication {
  const allowed = STAFF_VIEWS[view] as readonly string[];
  const out: DisclosedApplication = { __view: view };
  for (const key of allowed) {
    // Only copy keys that exist on the projection source.
    if (Object.prototype.hasOwnProperty.call(full, key)) {
      (out as Record<string, unknown>)[key] = full[key as keyof FullApplicationProjection];
    }
  }
  return out;
}

/**
 * Fields that are considered over-privileged for a given staff view — used by
 * tests to assert nothing sensitive leaks.
 */
export function disallowedKeysForView(view: StaffViewName): string[] {
  const allowed = new Set(STAFF_VIEWS[view] as readonly string[]);
  const sensitive = ["fullName", "contactPhone", "contactEmail"];
  return sensitive.filter((k) => !allowed.has(k));
}
