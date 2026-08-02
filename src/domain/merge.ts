import { ACCOMMODATION_FIELD_KEYS, type ApplicantFieldKey } from "./constants";

// Field-level draft merge / conflict resolution.
//
// Each stored field carries `updatedAtVersion` — the application version at
// which it last changed. A client edit carries `baseVersion` — the version the
// client last observed for that field. The merge rule:
//
//   * If the server's field has NOT changed since the client's baseVersion
//     (server.updatedAtVersion <= edit.baseVersion), accept the edit.
//   * If the server's field HAS changed and the incoming value is identical,
//     it is a no-op (converged) — accept silently.
//   * If the server's field HAS changed and the value differs, it is a
//     CONFLICT — reject that field and report both values so the client can
//     resolve. Other, non-conflicting fields in the same patch still apply.
//
// Reasonable-accommodation fields get an extra guard: a stale draft can never
// CLEAR an accommodation that the server currently holds. If an incoming edit
// would blank an accommodation field while the server has a value and the edit
// is stale, it is treated as a protected conflict rather than silently wiping
// the accommodation need.

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
}

export type FieldMergeStatus = "applied" | "noop" | "conflict";

export interface FieldMergeResult {
  key: ApplicantFieldKey;
  status: FieldMergeStatus;
  // For applied/noop: the resolved value. For conflict: the server's value.
  resolvedValue: StoredValue;
  serverValue: StoredValue;
  incomingValue: StoredValue;
  serverVersion: number;
  // Machine-readable conflict reason for UI + tests.
  conflictReason?: "STALE_EDIT" | "PROTECTED_ACCOMMODATION";
}

export interface MergeOutcome {
  results: FieldMergeResult[];
  applied: FieldMergeResult[];
  conflicts: FieldMergeResult[];
}

function normalize(value: StoredValue): string {
  if (value === null) return "\u0000null";
  if (Array.isArray(value)) {
    // Order-insensitive comparison for multi-select fields.
    return JSON.stringify([...value].map((v) => v).sort());
  }
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
 * Merge one incoming edit against the current stored field.
 */
export function mergeField(
  stored: StoredField | undefined,
  edit: IncomingEdit,
): FieldMergeResult {
  const serverValue: StoredValue = stored?.value ?? null;
  const serverVersion = stored?.updatedAtVersion ?? 0;

  // No divergence since the client last saw this field: accept.
  if (serverVersion <= edit.baseVersion) {
    const status: FieldMergeStatus = valuesEqual(serverValue, edit.value) ? "noop" : "applied";
    return {
      key: edit.key,
      status,
      resolvedValue: edit.value,
      serverValue,
      incomingValue: edit.value,
      serverVersion,
    };
  }

  // Server changed since baseVersion. Identical value => already converged.
  if (valuesEqual(serverValue, edit.value)) {
    return {
      key: edit.key,
      status: "noop",
      resolvedValue: serverValue,
      serverValue,
      incomingValue: edit.value,
      serverVersion,
    };
  }

  // Protected accommodation: a stale edit must not clear a live accommodation.
  if (isAccommodationField(edit.key) && isEmptyValue(edit.value) && !isEmptyValue(serverValue)) {
    return {
      key: edit.key,
      status: "conflict",
      resolvedValue: serverValue,
      serverValue,
      incomingValue: edit.value,
      serverVersion,
      conflictReason: "PROTECTED_ACCOMMODATION",
    };
  }

  // Genuine divergent edit to the same field: conflict.
  return {
    key: edit.key,
    status: "conflict",
    resolvedValue: serverValue,
    serverValue,
    incomingValue: edit.value,
    serverVersion,
    conflictReason: "STALE_EDIT",
  };
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
