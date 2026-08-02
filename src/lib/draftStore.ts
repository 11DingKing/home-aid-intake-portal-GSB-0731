import type { ApplicantFieldKey } from "@/domain/constants";
import type { StoredValue } from "@/domain/merge";

// Offline draft cache, keyed by application id. Persists each field the user has
// touched together with the base version at which they started editing it. This
// is what survives a page reload / connection drop and is later reconciled with
// the server via field-level merge (PATCH /draft).
//
// Convergence contract: the cache never invents an application id — it is always
// stamped with the server-issued id and the observed optimistic version.

const KEY_PREFIX = "haip:draft:";

export interface CachedField {
  value: StoredValue;
  // The application version the user was editing from when they changed it.
  baseVersion: number;
}

export interface CachedDraft {
  applicationId: string;
  // The last server version this cache was reconciled against.
  baseVersion: number;
  // Per-field pending edits not yet confirmed by the server.
  fields: Partial<Record<ApplicantFieldKey, CachedField>>;
  // Current wizard step so the applicant returns to where they left off.
  step: number;
  updatedAt: number;
}

function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

export function loadDraft(id: string): CachedDraft | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDraft;
    if (parsed.applicationId !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: CachedDraft): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      storageKey(draft.applicationId),
      JSON.stringify({ ...draft, updatedAt: Date.now() }),
    );
  } catch {
    // Quota or private-mode failures are non-fatal; the server remains source of truth.
  }
}

export function clearDraft(id: string): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(storageKey(id));
  } catch {
    /* noop */
  }
}

export function pendingEdits(draft: CachedDraft): Array<{
  key: ApplicantFieldKey;
  value: StoredValue;
  baseVersion: number;
}> {
  const out: Array<{ key: ApplicantFieldKey; value: StoredValue; baseVersion: number }> = [];
  for (const [key, cached] of Object.entries(draft.fields)) {
    if (!cached) continue;
    out.push({ key: key as ApplicantFieldKey, value: cached.value, baseVersion: cached.baseVersion });
  }
  return out;
}
