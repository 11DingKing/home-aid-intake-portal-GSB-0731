import type { ApplicationState, DraftField } from "./types";
import { FORM_STEPS } from "./types";

export type Role = "APPLICANT" | "STAFF";

export type Permission = "read" | "write" | "none";

export interface FieldPermission {
  field: string;
  read: boolean;
  write: boolean;
  reason?: string;
}

export interface StepAccess {
  stepId: string;
  stepIndex: number;
  title: string;
  fields: DraftField[];
  accessible: boolean;
  reason?: string;
}

const APPLICANT_ALWAYS_READ: readonly string[] = [
  "id",
  "state",
  "version",
  "exemptionReason",
  "accommodations",
  "createdAt",
  "updatedAt",
];

const APPLICANT_STEP_FIELDS: Record<string, DraftField[]> = {
  personal: ["fullName", "contactPhone", "contactEmail"],
  case: ["legalIssueType", "caseDescription"],
  eligibility: ["exemptionReason"],
  accommodations: ["accommodations"],
  materials: ["economicProofMeta", "idDocumentMeta", "otherMaterialMeta"],
  review: [],
};

const STAFF_INTAKE_VISIBLE: readonly string[] = [
  "id",
  "state",
  "version",
  "exemptionReason",
  "idDocumentMeta",
  "otherMaterialMeta",
  "accommodations",
  "legalIssueType",
];

const STAFF_CORRECTION_VISIBLE: readonly string[] = [
  "id",
  "state",
  "version",
  "exemptionReason",
  "fullName",
  "contactPhone",
  "contactEmail",
  "caseDescription",
  "economicProofMeta",
  "idDocumentMeta",
  "otherMaterialMeta",
  "legalIssueType",
  "accommodations",
  "correctionFields",
  "activeCorrections",
];

const SERVER_ONLY_FIELDS: readonly string[] = [
  "idempotencyKey",
  "submittedAt",
];

const CLIENT_WRITABLE_FIELDS: readonly DraftField[] = [
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
];

export function getApplicantStepIndexForState(state: ApplicationState): number {
  if (state === "DRAFT") return 0;
  if (state === "NEEDS_CORRECTION") return 0;
  return FORM_STEPS.length - 1;
}

export function getApplicantAccessibleSteps(state: ApplicationState): StepAccess[] {
  const canEdit = state === "DRAFT" || state === "NEEDS_CORRECTION";
  const maxStep = getApplicantStepIndexForState(state);

  return FORM_STEPS.map((step, index) => {
    const isCurrentStep = index === maxStep;
    const isPastStep = index < maxStep;
    const accessible = canEdit ? index <= maxStep : isPastStep || isCurrentStep;

    return {
      stepId: step.id,
      stepIndex: index,
      title: step.title,
      fields: APPLICANT_STEP_FIELDS[step.id] || [],
      accessible,
      reason: accessible
        ? undefined
        : canEdit
        ? "请先完成前面的步骤"
        : "申请已提交，此步骤不可编辑",
    };
  });
}

export function getFieldsForApplicantStep(
  state: ApplicationState,
  stepId: string
): { fields: DraftField[]; allReadable: string[]; editable: DraftField[] } {
  const canEdit = state === "DRAFT" || state === "NEEDS_CORRECTION";
  const stepFields = APPLICANT_STEP_FIELDS[stepId] || [];

  const allReadable = new Set<string>([
    ...APPLICANT_ALWAYS_READ,
    ...stepFields,
  ]);

  const pastSteps: string[] = [];
  const stepIndex = FORM_STEPS.findIndex((s) => s.id === stepId);
  for (let i = 0; i < stepIndex; i++) {
    pastSteps.push(...(APPLICANT_STEP_FIELDS[FORM_STEPS[i].id] || []));
  }
  for (const f of pastSteps) allReadable.add(f);

  const editable = canEdit ? stepFields : [];

  return {
    fields: stepFields,
    allReadable: Array.from(allReadable),
    editable,
  };
}

export function getStaffViewForState(state: ApplicationState): "INTAKE_REVIEW" | "CORRECTION_REVIEW" | "NONE" {
  if (state === "NEEDS_CORRECTION") return "CORRECTION_REVIEW";
  if (state === "SUBMITTED" || state === "RESUBMITTED") return "INTAKE_REVIEW";
  return "NONE";
}

export function getStaffVisibleFields(state: ApplicationState): string[] {
  const view = getStaffViewForState(state);
  if (view === "CORRECTION_REVIEW") return [...STAFF_CORRECTION_VISIBLE];
  if (view === "INTAKE_REVIEW") return [...STAFF_INTAKE_VISIBLE];
  return [];
}

export function getStaffEditableFields(state: ApplicationState): string[] {
  if (state === "SUBMITTED" || state === "RESUBMITTED") {
    return ["correctionFields", "reasonCode", "action"];
  }
  return [];
}

export function projectDataForRole<T extends Record<string, unknown>>(
  data: T,
  role: Role,
  state: ApplicationState,
  stepId?: string
): Partial<T> {
  let visibleFields: string[];

  if (role === "APPLICANT") {
    if (stepId) {
      const access = getFieldsForApplicantStep(state, stepId);
      visibleFields = access.allReadable;
    } else {
      const allApplicantFields = new Set<string>(APPLICANT_ALWAYS_READ);
      for (const fields of Object.values(APPLICANT_STEP_FIELDS)) {
        for (const f of fields) allApplicantFields.add(f);
      }
      visibleFields = Array.from(allApplicantFields);
    }
  } else {
    visibleFields = getStaffVisibleFields(state);
  }

  const result: Partial<T> = {};
  for (const field of visibleFields) {
    if (field in data) {
      (result as Record<string, unknown>)[field] = data[field];
    }
  }
  return result;
}

export interface FieldValidationResult {
  allowed: boolean;
  rejectedFields: string[];
  acceptedFields: string[];
  reasons: Record<string, string>;
}

export function validateClientMutation(
  submittedFields: Record<string, unknown>,
  state: ApplicationState
): FieldValidationResult {
  const canEdit = state === "DRAFT" || state === "NEEDS_CORRECTION";
  const rejectedFields: string[] = [];
  const acceptedFields: string[] = [];
  const reasons: Record<string, string> = {};

  for (const field of Object.keys(submittedFields)) {
    if (field === "version") {
      acceptedFields.push(field);
      continue;
    }

    if (!canEdit) {
      rejectedFields.push(field);
      reasons[field] = `当前状态 ${state} 不允许编辑字段`;
      continue;
    }

    if (SERVER_ONLY_FIELDS.includes(field)) {
      rejectedFields.push(field);
      reasons[field] = `字段 ${field} 为服务端保留字段，客户端不可修改`;
      continue;
    }

    if (field === "state" || field === "id" || field === "createdAt" || field === "updatedAt") {
      rejectedFields.push(field);
      reasons[field] = `字段 ${field} 为系统字段，客户端不可修改`;
      continue;
    }

    if (CLIENT_WRITABLE_FIELDS.includes(field as DraftField)) {
      acceptedFields.push(field);
    } else {
      rejectedFields.push(field);
      reasons[field] = `字段 ${field} 不在允许的客户端可写字段白名单中`;
    }
  }

  return {
    allowed: rejectedFields.length === 0,
    rejectedFields,
    acceptedFields,
    reasons,
  };
}

export function validateStaffMutation(
  submittedFields: Record<string, unknown>,
  state: ApplicationState,
  action: "correction" | "decision"
): FieldValidationResult {
  const rejectedFields: string[] = [];
  const acceptedFields: string[] = [];
  const reasons: Record<string, string> = {};

  const allowedFields =
    action === "correction"
      ? ["fields", "reasonCode", "version"]
      : ["action", "version"];

  for (const field of Object.keys(submittedFields)) {
    if (allowedFields.includes(field)) {
      acceptedFields.push(field);
    } else {
      rejectedFields.push(field);
      reasons[field] = `工作人员${action === "correction" ? "补正" : "决定"}操作不接受字段 ${field}`;
    }
  }

  return {
    allowed: rejectedFields.length === 0,
    rejectedFields,
    acceptedFields,
    reasons,
  };
}

export function getStaleLinkState(
  expectedState: ApplicationState | undefined,
  actualState: ApplicationState
): { isStale: boolean; message: string; actualState: ApplicationState } {
  if (!expectedState || expectedState === actualState) {
    return { isStale: false, message: "", actualState };
  }

  const stateLabels: Record<string, string> = {
    DRAFT: "草稿",
    SUBMITTED: "已提交",
    NEEDS_CORRECTION: "需要补正",
    RESUBMITTED: "已重新提交",
    ACCEPTED: "已受理",
    DECLINED: "已拒绝",
  };

  return {
    isStale: true,
    message: `链接已过期。申请状态已从"${stateLabels[expectedState] || expectedState}"变更为"${stateLabels[actualState] || actualState}"，请刷新页面查看最新状态。`,
    actualState,
  };
}
