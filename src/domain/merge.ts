import { ACCOMMODATION_FIELD_KEYS, type ApplicantFieldKey } from "./constants";

// Field-level draft merge / conflict resolution.
//
// This is a THREE-WAY merge (base / server / client) when the client supplies
// the common-ancestor value it started editing from (`baseValue`), and falls
// back to a version-based two-way merge when it does not.
//
// Each stored field carries `updatedAtVersion` — the application version at
// which it last changed. A client edit carries `baseVersion` (the version it
// last observed) and, ideally, `baseValue` (the value it started from).
//
// Three-way rules (baseValue present):
//   1. server == client                       -> noop   (already converged)
//   2. client == base (client didn't change)  -> noop   (keep server value)
//   3. server == base (server didn't change)  -> applied (take client value)
//   4. server != base && client != base       -> conflict (both edited; server wins,
//                                                 client value returned for re-edit)
//
// Version-based fallback (no baseValue):
//   * server.updatedAtVersion <= baseVersion  -> applied (server not moved past base)
//   * otherwise, differing values             -> conflict
//
// Reasonable-accommodation fields get an extra guard that supersedes the above:
// a merge can never CLEAR an accommodation the server currently holds. Any edit
// that would empty a non-empty accommodation field is returned as a protected
// conflict rather than silently wiping the need — this covers correction,
// offline recovery, and duplicate-submit paths equally.

export type StoredValue = string | string[] | null;

export interface StoredField {
  key: ApplicantFieldKey;
  value: StoredValue;
  updatedAtVersion: number;
}

export interface IncomingEdit {
  key: ApplicantFieldKey;
  value: StoredValue;
  baseVersion: number;
  // Optional common-ancestor value enabling true three-way merge. When omitted,
  // the merge falls back to version-based two-way resolution.
  baseValue?: StoredValue;
}

export type FieldMergeStatus = "applied" | "noop" | "conflict";

export interface FieldMergeResult {
  key: ApplicantFieldKey;
  status: FieldMergeStatus;
  // For applied/noop: the resolved value. For conflict: the server's value.
  resolvedValue: StoredValue;
  serverValue: StoredValue;
  incomingValue: StoredValue;
  // The base (common-ancestor) value used for three-way resolution, if any.
  baseValue: StoredValue | undefined;
  serverVersion: number;
  // How the field was resolved: "three-way" or "version".
  basis: "three-way" | "version";
  // Machine-readable conflict reason for UI + tests.
  conflictReason?: "STALE_EDIT" | "PROTECTED_ACCOMMODATION";
}

export interface MergeOutcome {
  results: FieldMergeResult[];
  applied: FieldMergeResult[];
  conflicts: FieldMergeResult[];
}

function normalize(value: StoredValue): string {
  // Treat null, an empty array, and an empty/whitespace string as the same
  // "empty" value: an absent field row (server default null), a deserialized
  // empty multi-select ([]), and a blank scalar all mean "unset", so they must
  // not read as a spurious change during three-way merge.
  if (value === null) return "\u0000empty";
  if (Array.isArray(value)) {
    if (value.length === 0) return "\u0000empty";
    // Order-insensitive comparison for multi-select fields.
    return JSON.stringify([...value].map((v) => v).sort());
  }
  if (value.trim().length === 0) return "\u0000empty";
  return JSON.stringify(value);
}

export function valuesEqual(a: StoredValue, b: StoredValue): boolean {
  return normalize(a) === normalize(b);
}

function isAccommodationField(key: ApplicantFieldKey): boolean {
  return (ACCOMMODATION_FIELD_KEYS as readonly string[]).includes(key);
}

function isEmptyValue(value: StoredValue): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim().length === 0;
}

/**
 * Merge one incoming edit against the current stored field using three-way
 * resolution when a base value is available.
 */
export function mergeField(
  stored: StoredField | undefined,
  edit: IncomingEdit,
): FieldMergeResult {
  const serverValue: StoredValue = stored?.value ?? null;
  const serverVersion = stored?.updatedAtVersion ?? 0;
  const hasBaseValue = Object.prototype.hasOwnProperty.call(edit, "baseValue");
  const basis: FieldMergeResult["basis"] = hasBaseValue ? "three-way" : "version";

  const result = (
    status: FieldMergeStatus,
    resolvedValue: StoredValue,
    conflictReason?: FieldMergeResult["conflictReason"],
  ): FieldMergeResult => ({
    key: edit.key,
    status,
    resolvedValue,
    serverValue,
    incomingValue: edit.value,
    baseValue: hasBaseValue ? edit.baseValue : undefined,
    serverVersion,
    basis,
    ...(conflictReason ? { conflictReason } : {}),
  });

  // (0) Already converged: client value equals server value.
  if (valuesEqual(serverValue, edit.value)) {
    return result("noop", serverValue);
  }

  // (Guard) Never clear a live accommodation through a merge. This protects the
  // reasonable-accommodation need across correction, offline recovery, and
  // duplicate-submit flows.
  if (isAccommodationField(edit.key) && isEmptyValue(edit.value) && !isEmptyValue(serverValue)) {
    return result("conflict", serverValue, "PROTECTED_ACCOMMODATION");
  }

  if (hasBaseValue) {
    const serverChanged = !valuesEqual(serverValue, edit.baseValue ?? null);
    const clientChanged = !valuesEqual(edit.value, edit.baseValue ?? null);

    // (2) Client never actually changed this field relative to its base: keep
    // the server value (this is how a stale draft avoids clobbering newer data).
    if (!clientChanged) {
      return result("noop", serverValue);
    }
    // (3) Server untouched since the client's base: safely take the client edit.
    if (!serverChanged) {
      return result("applied", edit.value);
    }
    // (4) Both sides changed the same field differently: conflict, server wins.
    return result("conflict", serverValue, "STALE_EDIT");
  }

  // Version-based fallback (no base value supplied).
  if (serverVersion <= edit.baseVersion) {
    return result("applied", edit.value);
  }
  return result("conflict", serverValue, "STALE_EDIT");
}

/**
 * Merge a batch of edits against the current field map. Non-conflicting edits
 * are reported as applied; conflicting fields are isolated so the rest can
 * still be persisted.
 */
export function mergeFields(
  stored: Map<ApplicantFieldKey, StoredField>,
  edits: IncomingEdit[],
): MergeOutcome {
  const results = edits.map((edit) => mergeField(stored.get(edit.key), edit));
  return {
    results,
    applied: results.filter((r) => r.status === "applied"),
    conflicts: results.filter((r) => r.status === "conflict"),
  };
}

/**
 * Compute which applicant fields changed on the server after a given version.
 * Used to report concurrent changes back to a staff session that acted on an
 * older base (e.g., the applicant supplemented materials meanwhile).
 */
export function fieldsChangedSince(
  stored: Iterable<StoredField>,
  sinceVersion: number,
): ApplicantFieldKey[] {
  const changed: ApplicantFieldKey[] = [];
  for (const field of stored) {
    if (field.updatedAtVersion > sinceVersion) changed.push(field.key);
  }
  return changed;
}
