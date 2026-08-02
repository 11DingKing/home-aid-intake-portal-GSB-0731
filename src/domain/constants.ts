// Domain constants and enum unions. These mirror materials/application-cases.json
// exactly and are the single source of truth for the TEXT columns in Prisma.

export const APPLICATION_STATES = [
  "DRAFT",
  "SUBMITTED",
  "NEEDS_CORRECTION",
  "RESUBMITTED",
  "ACCEPTED",
  "DECLINED",
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const EXEMPTION_REASONS = [
  "NO_FIXED_INCOME",
  "NOTIFIED_CRIMINAL_DEFENSE",
  "NONE",
] as const;
export type ExemptionReason = (typeof EXEMPTION_REASONS)[number];

export const ACCOMMODATIONS = [
  "HOME_VISIT_NEEDED",
  "SIGN_INTERPRETER",
  "TEXT_ONLY",
  "BRAILLE_MATERIAL",
] as const;
export type Accommodation = (typeof ACCOMMODATIONS)[number];

// Material "kinds" — metadata only, never bytes.
export const MATERIAL_KINDS = ["ECONOMIC_PROOF", "IDENTITY", "OTHER"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const CORRECTION_REASON_CODES = [
  "ECONOMIC_PROOF_REQUIRED",
  "IDENTITY_REQUIRED",
  "INCOMPLETE_FORM",
] as const;
export type CorrectionReasonCode = (typeof CORRECTION_REASON_CODES)[number];

// Editable applicant field keys, ordered by the multi-step form.
export const APPLICANT_FIELD_KEYS = [
  "fullName",
  "contactPhone",
  "contactEmail",
  "exemptionReason",
  "economicProof", // metadata id reference for the economic proof material
  "identityProof", // metadata id reference for identity material
  "accommodations",
  "accommodationNote",
] as const;
export type ApplicantFieldKey = (typeof APPLICANT_FIELD_KEYS)[number];

// Fields that hold accommodation ("reasonable accommodation") intent. These must
// never be silently dropped when an older draft is reconciled.
export const ACCOMMODATION_FIELD_KEYS = [
  "accommodations",
  "accommodationNote",
] as const;

// Staff disclosure views — mirror materials/application-cases.json staffViews.
export const STAFF_VIEWS = {
  INTAKE_REVIEW: [
    "id",
    "state",
    "exemptionReason",
    "materialMetadata",
    "accommodations",
  ],
  CORRECTION_REVIEW: [
    "id",
    "state",
    "correctionFields",
    "submittedFieldMetadata",
  ],
} as const;
export type StaffViewName = keyof typeof STAFF_VIEWS;

export function isApplicationState(v: unknown): v is ApplicationState {
  return typeof v === "string" && (APPLICATION_STATES as readonly string[]).includes(v);
}
