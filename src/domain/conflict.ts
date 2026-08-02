import type { DraftField } from "./types";
import { PROTECTED_FIELDS } from "./types";

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
