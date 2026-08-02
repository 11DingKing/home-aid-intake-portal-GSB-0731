import { z } from "zod";
import {
  ACCOMMODATIONS,
  EXEMPTION_REASONS,
  APPLICANT_FIELD_KEYS,
  type ApplicantFieldKey,
} from "./constants";
import { economicProofRequired } from "./materialRules";

// ---------------------------------------------------------------------------
// Field-level schemas. Each maps to one editable applicant field. Error
// messages are user-facing and are surfaced next to the associated control with
// a programmatic name (see the UI's field error wiring).
// ---------------------------------------------------------------------------

const fullName = z
  .string({ required_error: "Enter the applicant's full name." })
  .trim()
  .min(1, "Enter the applicant's full name.")
  .max(120, "Full name must be 120 characters or fewer.");

const contactPhone = z
  .string()
  .trim()
  .max(40, "Phone number must be 40 characters or fewer.")
  .regex(/^[0-9+()\-\s]*$/, "Phone number may only contain digits and + ( ) - characters.")
  .optional()
  .or(z.literal(""));

const contactEmail = z
  .string()
  .trim()
  .max(200, "Email must be 200 characters or fewer.")
  .email("Enter a valid email address, e.g. name@example.org.")
  .optional()
  .or(z.literal(""));

const exemptionReason = z.enum(EXEMPTION_REASONS, {
  errorMap: () => ({ message: "Select an economic-eligibility basis." }),
});

const materialRef = z
  .string()
  .trim()
  .max(200, "Material reference is too long.")
  .optional()
  .or(z.literal(""));

const accommodations = z
  .array(z.enum(ACCOMMODATIONS), {
    invalid_type_error: "Choose accommodations from the available options.",
  })
  .max(ACCOMMODATIONS.length, "Too many accommodations selected.");

const accommodationNote = z
  .string()
  .trim()
  .max(1000, "Accommodation note must be 1000 characters or fewer.")
  .optional()
  .or(z.literal(""));

/** Per-field validators used for incremental (draft) validation. */
export const FIELD_SCHEMAS = {
  fullName,
  contactPhone,
  contactEmail,
  exemptionReason,
  economicProof: materialRef,
  identityProof: materialRef,
  accommodations,
  accommodationNote,
} satisfies Record<ApplicantFieldKey, z.ZodTypeAny>;

export function isApplicantFieldKey(key: string): key is ApplicantFieldKey {
  return (APPLICANT_FIELD_KEYS as readonly string[]).includes(key);
}

// A single draft field edit carried by the client, tagged with the base version
// at which the applicant last observed the field, and optionally the base value
// it started editing from (enables true three-way field merge).
const editValue = z.union([z.string(), z.array(z.string()), z.null()]);
export const draftFieldEditSchema = z.object({
  // Accept ANY string key at the transport layer: unknown / over-privileged keys
  // (e.g. a maliciously crafted hidden field) are not rejected with a blunt 400 —
  // they are carried through so the server-side access policy can classify and
  // AUDIT each one with a specific reason. `isApplicantFieldKey` still gates
  // what may actually be written.
  key: z.string().min(1).max(120),
  value: editValue,
  baseVersion: z.number().int().nonnegative(),
  // Present => three-way merge; absent => version-based fallback.
  baseValue: editValue.optional(),
});
export type DraftFieldEdit = z.infer<typeof draftFieldEditSchema>;

// Applicant continuation step (scopes the writable whitelist). Optional; the
// server defaults to the broadest applicant self-view ("review").
const stepSchema = z
  .enum(["contact", "eligibility", "materials", "accommodations", "review"])
  .optional();

export const draftPatchSchema = z.object({
  // The application version the client believes it is editing from.
  baseVersion: z.number().int().nonnegative(),
  step: stepSchema,
  edits: z.array(draftFieldEditSchema).min(1, "Provide at least one field edit."),
});
export type DraftPatchInput = z.infer<typeof draftPatchSchema>;

// ---------------------------------------------------------------------------
// Whole-application validation for final submission. Uses field values plus the
// material rules; NO_FIXED_INCOME (and criminal-defense) waive economic proof.
// ---------------------------------------------------------------------------

export interface ApplicationValues {
  fullName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  exemptionReason?: string | null;
  economicProof?: string | null;
  identityProof?: string | null;
  accommodations?: string[] | null;
  accommodationNote?: string | null;
}

export interface FieldError {
  field: string;
  message: string;
  // Machine-readable code so the UI can render non-color-only status and tests
  // can assert without matching prose.
  code: string;
}

/**
 * Validate a full application for submission. Returns a list of field errors
 * (empty means valid). Economic-proof requirement is conditional on the
 * exemption reason — the key accessibility rule.
 */
export function validateForSubmission(values: ApplicationValues): FieldError[] {
  const errors: FieldError[] = [];

  const name = (values.fullName ?? "").trim();
  if (name.length === 0) {
    errors.push({ field: "fullName", message: "Enter the applicant's full name.", code: "REQUIRED" });
  }

  const reasonRaw = (values.exemptionReason ?? "").trim();
  if (reasonRaw.length === 0) {
    errors.push({
      field: "exemptionReason",
      message: "Select an economic-eligibility basis.",
      code: "REQUIRED",
    });
  } else if (!(EXEMPTION_REASONS as readonly string[]).includes(reasonRaw)) {
    errors.push({
      field: "exemptionReason",
      message: "Select a valid economic-eligibility basis.",
      code: "INVALID",
    });
  }

  // Contact: at least one channel so staff can reach the applicant.
  const phone = (values.contactPhone ?? "").trim();
  const email = (values.contactEmail ?? "").trim();
  if (phone.length === 0 && email.length === 0) {
    errors.push({
      field: "contactPhone",
      message: "Provide a phone number or an email so we can reach you.",
      code: "CONTACT_REQUIRED",
    });
  }
  if (email.length > 0) {
    const parsed = contactEmail.safeParse(email);
    if (!parsed.success) {
      errors.push({
        field: "contactEmail",
        message: "Enter a valid email address, e.g. name@example.org.",
        code: "INVALID",
      });
    }
  }

  // Identity proof is always required.
  if (((values.identityProof ?? "").trim()).length === 0) {
    errors.push({
      field: "identityProof",
      message: "Attach an identity document.",
      code: "MATERIAL_REQUIRED",
    });
  }

  // Economic proof requirement depends on the exemption reason.
  if ((EXEMPTION_REASONS as readonly string[]).includes(reasonRaw)) {
    const needsEconomic = economicProofRequired(reasonRaw as (typeof EXEMPTION_REASONS)[number]);
    const hasEconomic = ((values.economicProof ?? "").trim()).length > 0;
    if (needsEconomic && !hasEconomic) {
      errors.push({
        field: "economicProof",
        message: "Attach proof of economic hardship, or select an exemption that waives it.",
        code: "MATERIAL_REQUIRED",
      });
    }
  }

  return errors;
}
