import {
  ACCOMMODATION_FIELD_KEYS,
  APPLICANT_FIELD_KEYS,
  type ApplicantFieldKey,
  type ApplicationState,
} from "./constants";

// ---------------------------------------------------------------------------
// Field-level access policy (server-authoritative).
//
// This module is the single source of truth for "which fields may this actor
// READ or WRITE, given the current server-computed (role, state, step)". It is
// recomputed on every load and every submit from server state — the client
// cache is never trusted. Both the applicant continuation surface and the staff
// continuation surface funnel through here.
//
// Design rules encoded here:
//   * Least privilege: expose only the fields the current step needs.
//   * Staff never receive applicant PII (fullName/contact*), in any state/step.
//   * Reasonable-accommodation fields are ALWAYS readable to the actor who owns
//     the surface and are never writable by staff, so staff actions cannot
//     overwrite the accommodation need.
//   * A field a step does not list is not merely hidden — it is excluded from
//     the projection and rejected on write, with an auditable reason.
// ---------------------------------------------------------------------------

export type ActorRole = "applicant" | "staff";

// Applicant continuation steps (mirror the multi-step form) — used to scope the
// minimal field set the current step needs.
export const APPLICANT_STEPS = [
  "contact",
  "eligibility",
  "materials",
  "accommodations",
  "review",
] as const;
export type ApplicantStep = (typeof APPLICANT_STEPS)[number];

// Staff continuation steps map to disclosure intents.
export const STAFF_STEPS = ["intake", "correction"] as const;
export type StaffStep = (typeof STAFF_STEPS)[number];

// Applicant PII that must never reach a staff surface.
export const APPLICANT_PII_FIELDS: readonly ApplicantFieldKey[] = [
  "fullName",
  "contactPhone",
  "contactEmail",
];

// Per-step applicant field whitelist. "review" intentionally lists every field
// so the applicant can confirm before submit.
const APPLICANT_STEP_FIELDS: Record<ApplicantStep, readonly ApplicantFieldKey[]> = {
  contact: ["fullName", "contactPhone", "contactEmail"],
  eligibility: ["exemptionReason"],
  materials: ["economicProof", "identityProof"],
  accommodations: ["accommodations", "accommodationNote"],
  review: [...APPLICANT_FIELD_KEYS],
};

export type DenyReasonCode =
  | "UNKNOWN_FIELD"
  | "NOT_IN_STEP_WHITELIST"
  | "NOT_WRITABLE_IN_STATE"
  | "ROLE_NOT_PERMITTED"
  | "STAFF_PII_FORBIDDEN"
  | "ACCOMMODATION_READ_ONLY_FOR_STAFF";

export interface FieldPolicy {
  role: ActorRole;
  state: ApplicationState;
  step: string;
  // Fields the actor may READ on this surface/step.
  readable: ApplicantFieldKey[];
  // Fields the actor may WRITE on this surface/step.
  writable: ApplicantFieldKey[];
}

const EDITABLE_STATES: ReadonlySet<ApplicationState> = new Set(["DRAFT", "NEEDS_CORRECTION"]);

function isAccommodation(key: ApplicantFieldKey): boolean {
  return (ACCOMMODATION_FIELD_KEYS as readonly string[]).includes(key);
}

/**
 * Normalize an arbitrary requested applicant step to a valid one, defaulting to
 * "review" (the broadest applicant self-view) if unknown.
 */
export function coerceApplicantStep(step: string | null | undefined): ApplicantStep {
  return (APPLICANT_STEPS as readonly string[]).includes(step ?? "")
    ? (step as ApplicantStep)
    : "review";
}

/**
 * Choose the staff step from the server state so a stale link cannot request a
 * broader view than the current state permits:
 *   NEEDS_CORRECTION / RESUBMITTED -> "correction"
 *   otherwise                      -> "intake"
 */
export function staffStepForState(state: ApplicationState): StaffStep {
  return state === "NEEDS_CORRECTION" || state === "RESUBMITTED" ? "correction" : "intake";
}

/**
 * Compute the applicant's readable/writable field sets for a given state + step.
 * Applicants may write only in editable states, and only fields their current
 * step owns. Accommodations remain readable on their step.
 */
export function applicantFieldPolicy(
  state: ApplicationState,
  step: ApplicantStep,
): FieldPolicy {
  const stepFields = APPLICANT_STEP_FIELDS[step];
  const readable = [...stepFields];
  const canWrite = EDITABLE_STATES.has(state);
  const writable = canWrite ? [...stepFields] : [];
  return { role: "applicant", state, step, readable, writable };
}

/**
 * Compute the staff readable/writable field sets. Staff never read PII and never
 * write applicant fields at all (their power is corrections/decisions, handled
 * by the state machine, not field writes). Accommodations are readable so a
 * caseworker can honor them, but never writable.
 */
export function staffFieldPolicy(state: ApplicationState, step: StaffStep): FieldPolicy {
  // Non-PII applicant fields the staff step is allowed to see.
  const base: ApplicantFieldKey[] =
    step === "correction"
      ? ["exemptionReason", "economicProof", "identityProof", "accommodations", "accommodationNote"]
      : ["exemptionReason", "economicProof", "identityProof", "accommodations", "accommodationNote"];
  // Filter out any PII defensively (base already excludes it).
  const readable = base.filter((k) => !APPLICANT_PII_FIELDS.includes(k));
  return { role: "staff", state, step, readable, writable: [] };
}

export function fieldPolicy(
  role: ActorRole,
  state: ApplicationState,
  step: string,
): FieldPolicy {
  return role === "staff"
    ? staffFieldPolicy(state, staffStepForState(state))
    : applicantFieldPolicy(state, coerceApplicantStep(step));
}

// ---------------------------------------------------------------------------
// Write-time enforcement
// ---------------------------------------------------------------------------

export interface WriteDecision {
  key: string;
  allowed: boolean;
  reasonCode?: DenyReasonCode;
}

export interface WriteEvaluation {
  allowedKeys: ApplicantFieldKey[];
  denied: WriteDecision[];
}

/**
 * Given the writable policy and a set of requested field keys (which may include
 * unknown or over-privileged keys from a crafted request), classify each into
 * allowed vs denied WITH a reason. The caller applies only allowedKeys and
 * audits the denied set. This is what stops a maliciously constructed hidden
 * field from ever being written.
 */
export function evaluateWrites(
  policy: FieldPolicy,
  requestedKeys: string[],
): WriteEvaluation {
  const writable = new Set<string>(policy.writable);
  const known = new Set<string>(APPLICANT_FIELD_KEYS);
  const allowedKeys: ApplicantFieldKey[] = [];
  const denied: WriteDecision[] = [];

  for (const key of requestedKeys) {
    if (!known.has(key)) {
      denied.push({ key, allowed: false, reasonCode: "UNKNOWN_FIELD" });
      continue;
    }
    if (policy.role === "staff") {
      // Staff never write applicant fields through the draft path.
      denied.push({ key, allowed: false, reasonCode: "ROLE_NOT_PERMITTED" });
      continue;
    }
    if (!writable.has(key)) {
      // Known field, but not writable in this state/step.
      const reason: DenyReasonCode = policy.writable.length === 0
        ? "NOT_WRITABLE_IN_STATE"
        : "NOT_IN_STEP_WHITELIST";
      denied.push({ key, allowed: false, reasonCode: reason });
      continue;
    }
    allowedKeys.push(key as ApplicantFieldKey);
  }
  return { allowedKeys, denied };
}

// ---------------------------------------------------------------------------
// Read-time enforcement helpers
// ---------------------------------------------------------------------------

/**
 * True if a field is over-privileged for a staff read (PII or, defensively, not
 * in the staff readable set). Used by tests and the projection layer.
 */
export function isStaffOverPrivileged(state: ApplicationState, key: string): boolean {
  if ((APPLICANT_PII_FIELDS as readonly string[]).includes(key)) return true;
  const policy = staffFieldPolicy(state, staffStepForState(state));
  return !policy.readable.includes(key as ApplicantFieldKey);
}

/**
 * Fields that must never appear in a staff response, for any state — the strong
 * invariant asserted by adversarial tests.
 */
export function alwaysForbiddenForStaff(): readonly ApplicantFieldKey[] {
  return APPLICANT_PII_FIELDS;
}

export { isAccommodation };
