// Shared client/server types for API payloads. Kept framework-free so both the
// browser code and route handlers can rely on the same shapes.

import type { ApplicantFieldKey, ApplicationState } from "@/domain/constants";
import type { StoredValue } from "@/domain/merge";

export interface ApplicationDTO {
  id: string;
  state: ApplicationState;
  version: number;
  fields: Record<ApplicantFieldKey, { value: StoredValue; updatedAtVersion: number }>;
  values: {
    fullName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    exemptionReason?: string | null;
    economicProof?: string | null;
    identityProof?: string | null;
    accommodations?: string[] | null;
    accommodationNote?: string | null;
  };
  materials: Array<{
    id: string;
    kind: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  openCorrection: { fields: string[]; reasonCode: string; note: string | null } | null;
  updatedAt: string;
}

export interface FieldMergeSummary {
  key: ApplicantFieldKey;
  status: "applied" | "noop" | "conflict";
  serverValue: StoredValue;
  incomingValue: StoredValue;
  resolvedValue: StoredValue;
  serverVersion: number;
  conflictReason: "STALE_EDIT" | "PROTECTED_ACCOMMODATION" | null;
}

export interface DraftPatchResponse {
  application: ApplicationDTO;
  applied: FieldMergeSummary[];
  conflicts: FieldMergeSummary[];
}

export interface SubmitResponse {
  application: ApplicationDTO;
  replayed: boolean;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
