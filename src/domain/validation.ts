import { z } from "zod";
import {
  ACCOMMODATIONS,
  EXEMPTION_REASONS,
  LEGAL_ISSUE_TYPES,
  CORRECTION_REASON_CODES,
  type ExemptionReason,
} from "./types";

const materialMetaSchema = z.object({
  materialId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string(),
  status: z.enum(["UPLOADED", "PENDING", "REJECTED"]),
});

export const draftUpdateSchema = z.object({
  fullName: z.string().trim().min(1, "请输入姓名").max(100).optional().nullable(),
  contactPhone: z
    .string()
    .trim()
    .min(1, "请输入联系电话")
    .regex(/^[\d\s\-+()]{7,20}$/, "请输入有效的电话号码")
    .optional()
    .nullable(),
  contactEmail: z
    .string()
    .trim()
    .email("请输入有效的电子邮箱")
    .optional()
    .nullable()
    .or(z.literal("")),
  caseDescription: z.string().trim().max(5000).optional().nullable(),
  legalIssueType: z.enum(LEGAL_ISSUE_TYPES).optional().nullable(),
  exemptionReason: z.enum(EXEMPTION_REASONS).optional(),
  accommodations: z.array(z.enum(ACCOMMODATIONS)).optional(),
  economicProofMeta: materialMetaSchema.optional().nullable(),
  idDocumentMeta: materialMetaSchema.optional().nullable(),
  otherMaterialMeta: materialMetaSchema.optional().nullable(),
  version: z.number().int().positive(),
});

export type DraftUpdateInput = z.infer<typeof draftUpdateSchema>;

export const submitSchema = z.object({
  idempotencyKey: z.string().min(1),
  version: z.number().int().positive().optional(),
});

export const correctionCreateSchema = z.object({
  fields: z.array(z.string().min(1)).min(1, "请至少选择一个需要补正的字段"),
  reasonCode: z.enum(CORRECTION_REASON_CODES),
  version: z.number().int().positive().optional(),
});

export const staffDecisionSchema = z.object({
  action: z.enum(["ACCEPTED", "DECLINED"]),
});

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
}

export function isEconomicProofRequired(exemptionReason: ExemptionReason): boolean {
  return exemptionReason !== "NO_FIXED_INCOME";
}

export function validateForSubmission(data: {
  fullName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  caseDescription: string | null;
  legalIssueType: string | null;
  exemptionReason: ExemptionReason;
  economicProofMeta: unknown;
  idDocumentMeta: unknown;
  otherMaterialMeta: unknown;
}): ValidationResult {
  const errors: FieldError[] = [];

  if (!data.fullName || data.fullName.trim().length === 0) {
    errors.push({ field: "fullName", message: "请输入姓名" });
  }
  if (!data.contactPhone || data.contactPhone.trim().length === 0) {
    errors.push({ field: "contactPhone", message: "请输入联系电话" });
  }
  if (!data.legalIssueType) {
    errors.push({ field: "legalIssueType", message: "请选择案件类型" });
  }
  if (!data.caseDescription || data.caseDescription.trim().length < 10) {
    errors.push({ field: "caseDescription", message: "请简要描述案件情况（至少10个字）" });
  }
  if (!data.idDocumentMeta) {
    errors.push({ field: "idDocumentMeta", message: "请上传身份证明材料" });
  }
  if (!data.otherMaterialMeta) {
    errors.push({ field: "otherMaterialMeta", message: "请上传其他必要材料" });
  }

  if (isEconomicProofRequired(data.exemptionReason) && !data.economicProofMeta) {
    errors.push({ field: "economicProofMeta", message: "请上传经济困难证明" });
  }

  return { valid: errors.length === 0, errors };
}

export function validateStepFields(
  step: string,
  data: Record<string, unknown>,
  exemptionReason: ExemptionReason
): FieldError[] {
  const errors: FieldError[] = [];

  switch (step) {
    case "personal":
      if (!data.fullName || String(data.fullName).trim().length === 0) {
        errors.push({ field: "fullName", message: "请输入姓名" });
      }
      if (!data.contactPhone || String(data.contactPhone).trim().length === 0) {
        errors.push({ field: "contactPhone", message: "请输入联系电话" });
      }
      break;
    case "case":
      if (!data.legalIssueType) {
        errors.push({ field: "legalIssueType", message: "请选择案件类型" });
      }
      if (!data.caseDescription || String(data.caseDescription).trim().length < 10) {
        errors.push({ field: "caseDescription", message: "请简要描述案件情况（至少10个字）" });
      }
      break;
    case "eligibility":
      if (!data.exemptionReason) {
        errors.push({ field: "exemptionReason", message: "请选择豁免原因" });
      }
      break;
    case "materials":
      if (!data.idDocumentMeta) {
        errors.push({ field: "idDocumentMeta", message: "请上传身份证明材料" });
      }
      if (!data.otherMaterialMeta) {
        errors.push({ field: "otherMaterialMeta", message: "请上传其他必要材料" });
      }
      if (isEconomicProofRequired(exemptionReason) && !data.economicProofMeta) {
        errors.push({ field: "economicProofMeta", message: "请上传经济困难证明" });
      }
      break;
  }

  return errors;
}
