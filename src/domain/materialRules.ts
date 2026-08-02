import type { ExemptionReason, MaterialKind } from "./constants";

// Required-material rules for a *final* submission.
//
// Core accessibility/fairness rule from the brief:
//   When the applicant selects exemptionReason = NO_FIXED_INCOME, they must NOT
//   be forced to upload economic-hardship proof. All other required materials
//   still apply.
//
// NOTIFIED_CRIMINAL_DEFENSE is likewise exempt from economic proof (criminal
// defense notification substitutes for the means test). NONE requires economic
// proof as normal. Identity proof is always required.

export interface MaterialRequirement {
  kind: MaterialKind;
  // The applicant field key that must reference an uploaded material's id.
  fieldKey: string;
  required: boolean;
  // Machine-readable reason a requirement is waived (for non-color status + a11y).
  waivedReason?: "EXEMPT_NO_FIXED_INCOME" | "EXEMPT_CRIMINAL_DEFENSE";
}

const ECONOMIC_PROOF_WAIVED: Partial<Record<ExemptionReason, MaterialRequirement["waivedReason"]>> = {
  NO_FIXED_INCOME: "EXEMPT_NO_FIXED_INCOME",
  NOTIFIED_CRIMINAL_DEFENSE: "EXEMPT_CRIMINAL_DEFENSE",
};

export function economicProofRequired(reason: ExemptionReason): boolean {
  return ECONOMIC_PROOF_WAIVED[reason] === undefined;
}

/**
 * Compute the material requirements for a given exemption reason. Identity is
 * always required; economic proof is required unless the reason waives it.
 */
export function materialRequirements(reason: ExemptionReason): MaterialRequirement[] {
  const economicWaived = ECONOMIC_PROOF_WAIVED[reason];
  return [
    {
      kind: "IDENTITY",
      fieldKey: "identityProof",
      required: true,
    },
    {
      kind: "ECONOMIC_PROOF",
      fieldKey: "economicProof",
      required: economicWaived === undefined,
      ...(economicWaived ? { waivedReason: economicWaived } : {}),
    },
  ];
}

export interface MissingMaterial {
  kind: MaterialKind;
  fieldKey: string;
}

/**
 * Given the current field values, return the required materials that are still
 * missing. `has(fieldKey)` reports whether a material metadata id is present for
 * that field.
 */
export function missingRequiredMaterials(
  reason: ExemptionReason,
  has: (fieldKey: string) => boolean,
): MissingMaterial[] {
  return materialRequirements(reason)
    .filter((r) => r.required && !has(r.fieldKey))
    .map((r) => ({ kind: r.kind, fieldKey: r.fieldKey }));
}
