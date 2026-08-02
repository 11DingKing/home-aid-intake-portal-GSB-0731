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

export const LEGAL_ISSUE_TYPES = [
  "FAMILY_LAW",
  "HOUSING",
  "EMPLOYMENT",
  "IMMIGRATION",
  "CRIMINAL_DEFENSE",
  "CONSUMER_RIGHTS",
  "PUBLIC_BENEFITS",
  "OTHER",
] as const;

export type LegalIssueType = (typeof LEGAL_ISSUE_TYPES)[number];

export const CORRECTION_REASON_CODES = [
  "ECONOMIC_PROOF_REQUIRED",
  "ID_DOCUMENT_REQUIRED",
  "INCOMPLETE_INFORMATION",
  "CLARIFICATION_NEEDED",
] as const;

export type CorrectionReasonCode = (typeof CORRECTION_REASON_CODES)[number];

export interface MaterialMeta {
  materialId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  status: "UPLOADED" | "PENDING" | "REJECTED";
}

export interface ApplicationData {
  id: string;
  state: ApplicationState;
  exemptionReason: ExemptionReason;
  fullName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  caseDescription: string | null;
  legalIssueType: LegalIssueType | null;
  accommodations: Accommodation[];
  economicProofMeta: MaterialMeta | null;
  idDocumentMeta: MaterialMeta | null;
  otherMaterialMeta: MaterialMeta | null;
  version: number;
  idempotencyKey: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CorrectionData {
  id: number;
  applicationId: string;
  fields: string[];
  reasonCode: CorrectionReasonCode;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export type DraftField =
  | "fullName"
  | "contactPhone"
  | "contactEmail"
  | "caseDescription"
  | "legalIssueType"
  | "exemptionReason"
  | "accommodations"
  | "economicProofMeta"
  | "idDocumentMeta"
  | "otherMaterialMeta";

export const PROTECTED_FIELDS: DraftField[] = ["accommodations"];

export const STAFF_VIEW_FIELDS = {
  INTAKE_REVIEW: [
    "id",
    "state",
    "exemptionReason",
    "idDocumentMeta",
    "otherMaterialMeta",
    "accommodations",
    "legalIssueType",
  ],
  CORRECTION_REVIEW: [
    "id",
    "state",
    "correctionFields",
    "fullName",
    "contactPhone",
    "contactEmail",
    "caseDescription",
    "economicProofMeta",
    "idDocumentMeta",
    "otherMaterialMeta",
    "legalIssueType",
    "exemptionReason",
    "accommodations",
  ],
} as const;

export type StaffViewType = keyof typeof STAFF_VIEW_FIELDS;

export const FORM_STEPS = [
  { id: "personal", title: "个人信息", fields: ["fullName", "contactPhone", "contactEmail"] },
  { id: "case", title: "案件信息", fields: ["legalIssueType", "caseDescription"] },
  { id: "eligibility", title: "资格与豁免", fields: ["exemptionReason"] },
  { id: "accommodations", title: "合理便利", fields: ["accommodations"] },
  { id: "materials", title: "材料上传", fields: ["economicProofMeta", "idDocumentMeta", "otherMaterialMeta"] },
  { id: "review", title: "确认提交", fields: [] },
] as const;

export type FormStepId = (typeof FORM_STEPS)[number]["id"];
