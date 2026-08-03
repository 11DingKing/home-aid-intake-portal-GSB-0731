import type { DraftField } from "./types";
import { PROTECTED_FIELDS } from "./types";

export interface ThreeWayMergeResult {
  merged: Record<string, unknown>;
  conflicts: string[];
  applicantWins: string[];
  serverWins: string[];
  autoMerged: string[];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export function threeWayMerge(
  base: Record<string, unknown>,
  applicant: Record<string, unknown>,
  server: Record<string, unknown>,
  protectedFields: readonly string[] = PROTECTED_FIELDS
): ThreeWayMergeResult {
  const conflicts: string[] = [];
  const applicantWins: string[] = [];
  const serverWins: string[] = [];
  const autoMerged: string[] = [];
  const merged: Record<string, unknown> = { ...server };

  const allFields = new Set([
    ...Object.keys(applicant),
    ...Object.keys(server),
    ...Object.keys(base),
  ]);

  for (const field of allFields) {
    const baseVal = base[field];
    const clientVal = applicant[field];
    const serverVal = server[field];

    const clientProvided = field in applicant;
    const serverProvided = field in server;

    if (!clientProvided && serverProvided) {
      merged[field] = serverVal;
      if (!valuesEqual(baseVal, serverVal)) {
        serverWins.push(field);
      }
      continue;
    }

    if (clientProvided && !serverProvided) {
      merged[field] = clientVal;
      if (!valuesEqual(baseVal, clientVal)) {
        applicantWins.push(field);
      }
      continue;
    }

    if (!clientProvided && !serverProvided) {
      continue;
    }

    const clientChanged = !valuesEqual(baseVal, clientVal);
    const serverChanged = !valuesEqual(baseVal, serverVal);

    if (!clientChanged && !serverChanged) {
      continue;
    }

    if (clientChanged && !serverChanged) {
      merged[field] = clientVal;
      applicantWins.push(field);
      continue;
    }

    if (!clientChanged && serverChanged) {
      merged[field] = serverVal;
      serverWins.push(field);
      continue;
    }

    if (valuesEqual(clientVal, serverVal)) {
      merged[field] = clientVal;
      continue;
    }

    if (protectedFields.includes(field)) {
      if (Array.isArray(clientVal) && Array.isArray(serverVal)) {
        const mergedArray = Array.from(
          new Set([...(clientVal as unknown[]), ...(serverVal as unknown[])])
        );
        merged[field] = mergedArray;
        autoMerged.push(field);
      } else if (Array.isArray(clientVal) && isEmptyValue(serverVal)) {
        merged[field] = clientVal;
        applicantWins.push(field);
      } else if (Array.isArray(serverVal) && isEmptyValue(clientVal)) {
        merged[field] = serverVal;
        serverWins.push(field);
      } else {
        merged[field] = serverVal;
        serverWins.push(field);
      }
      continue;
    }

    if (isEmptyValue(clientVal) && !isEmptyValue(serverVal)) {
      merged[field] = serverVal;
      serverWins.push(field);
      conflicts.push(field);
      continue;
    }

    if (isEmptyValue(serverVal) && !isEmptyValue(clientVal)) {
      merged[field] = clientVal;
      applicantWins.push(field);
      continue;
    }

    merged[field] = clientVal;
    applicantWins.push(field);
    conflicts.push(field);
  }

  return { merged, conflicts, applicantWins, serverWins, autoMerged };
}

export interface ConflictResolutionResult {
  merged: Record<string, unknown>;
  conflicts: string[];
  serverWins: string[];
  clientWins: string[];
}

export function resolveFieldLevelConflict(
  serverData: Record<string, unknown>,
  clientData: Record<string, unknown>,
  baseVersion: number,
  serverVersion: number
): ConflictResolutionResult {
  const conflicts: string[] = [];
  const serverWins: string[] = [];
  const clientWins: string[] = [];

  if (baseVersion >= serverVersion) {
    return {
      merged: { ...serverData, ...clientData },
      conflicts,
      serverWins,
      clientWins: Object.keys(clientData),
    };
  }

  const merged: Record<string, unknown> = { ...serverData };

  for (const [key, clientValue] of Object.entries(clientData)) {
    if (clientValue === undefined) continue;

    const serverValue = serverData[key];
    const field = key as DraftField;

    if (PROTECTED_FIELDS.includes(field)) {
      if (Array.isArray(serverValue) && Array.isArray(clientValue)) {
        const mergedArray = Array.from(new Set([...serverValue, ...clientValue]));
        merged[key] = mergedArray;
        if (JSON.stringify(serverValue) !== JSON.stringify(clientValue)) {
          conflicts.push(key);
        }
      } else {
        merged[key] = serverValue;
        serverWins.push(key);
      }
      continue;
    }

    if (JSON.stringify(serverValue) === JSON.stringify(clientValue)) {
      continue;
    }

    if (clientValue === null || clientValue === "") {
      if (serverValue !== null && serverValue !== "") {
        merged[key] = serverValue;
        serverWins.push(key);
        conflicts.push(key);
      }
      continue;
    }

    if (serverValue === null || serverValue === "" || serverValue === undefined) {
      merged[key] = clientValue;
      clientWins.push(key);
      continue;
    }

    merged[key] = clientValue;
    clientWins.push(key);
    conflicts.push(key);
  }

  return { merged, conflicts, serverWins, clientWins };
}

export function isStaleDraft(baseVersion: number, serverVersion: number): boolean {
  return baseVersion < serverVersion;
}

export function sanitizeClientDraft(
  data: Record<string, unknown>,
  allowedFields: readonly DraftField[]
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in data) {
      sanitized[field] = data[field];
    }
  }
  return sanitized;
}

export function diffChangedFields(
  base: Record<string, unknown>,
  current: Record<string, unknown>,
  fields: readonly string[]
): string[] {
  const changed: string[] = [];
  for (const field of fields) {
    if (!valuesEqual(base[field], current[field])) {
      changed.push(field);
    }
  }
  return changed;
}

export const CLIENT_EDITABLE_FIELDS: readonly DraftField[] = [
  "fullName",
  "contactPhone",
  "contactEmail",
  "caseDescription",
  "legalIssueType",
  "exemptionReason",
  "accommodations",
  "economicProofMeta",
  "idDocumentMeta",
  "otherMaterialMeta",
] as const;
