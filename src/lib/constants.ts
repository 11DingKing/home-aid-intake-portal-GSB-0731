export const STATES = [
  "DRAFT",
  "SUBMITTED",
  "NEEDS_CORRECTION",
  "RESUBMITTED",
  "ACCEPTED",
  "DECLINED",
] as const;
export type AppState = (typeof STATES)[number];

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

export const MATERIAL_KINDS = ["IDENTITY", "ECONOMIC_PROOF", "OTHER"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATTER_TYPES = [
  "LABOR_DISPUTE",
  "FAMILY",
  "TORT_COMPENSATION",
  "ADMINISTRATIVE",
  "CRIMINAL_DEFENSE",
  "OTHER",
] as const;
export type MatterType = (typeof MATTER_TYPES)[number];

export const STATE_LABELS: Record<AppState, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已提交",
  NEEDS_CORRECTION: "待补正",
  RESUBMITTED: "已重新提交",
  ACCEPTED: "已受理",
  DECLINED: "已不予受理",
};

export const EXEMPTION_LABELS: Record<ExemptionReason, string> = {
  NO_FIXED_INCOME: "无固定收入",
  NOTIFIED_CRIMINAL_DEFENSE: "通知辩护刑事案件",
  NONE: "不属于免交情形",
};

export const ACCOMMODATION_LABELS: Record<Accommodation, string> = {
  HOME_VISIT_NEEDED: "需要上门服务",
  SIGN_INTERPRETER: "需要手语翻译",
  TEXT_ONLY: "仅文字交流",
  BRAILLE_MATERIAL: "需要盲文材料",
};

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  IDENTITY: "身份证明",
  ECONOMIC_PROOF: "经济困难证明",
  OTHER: "其他材料",
};

export const MATTER_TYPE_LABELS: Record<MatterType, string> = {
  LABOR_DISPUTE: "劳动争议",
  FAMILY: "婚姻家庭",
  TORT_COMPENSATION: "侵权赔偿",
  ADMINISTRATIVE: "行政争议",
  CRIMINAL_DEFENSE: "刑事辩护",
  OTHER: "其他",
};

/** Editable applicant draft fields (whitelist for draft merge). */
export const EDITABLE_FIELDS = [
  "contactName",
  "contactPhone",
  "address",
  "matterType",
  "matterDescription",
  "exemptionReason",
  "accommodations",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<string, string> = {
  contactName: "姓名",
  contactPhone: "联系电话",
  address: "联系地址",
  matterType: "事项类型",
  matterDescription: "案情简述",
  exemptionReason: "经济状况免交情形",
  accommodations: "合理便利需求",
  economicProof: "经济困难证明",
  identity: "身份证明",
};
