import { z } from "zod";
import {
  ACCOMMODATIONS,
  EXEMPTION_REASONS,
  MATERIAL_KINDS,
  MATTER_TYPES,
  type Accommodation,
  type ExemptionReason,
} from "./constants";

export const draftFieldsSchema = z
  .object({
    contactName: z.string().max(50).optional(),
    contactPhone: z.string().max(20).optional(),
    address: z.string().max(200).optional(),
    matterType: z.union([z.literal(""), z.enum(MATTER_TYPES)]).optional(),
    matterDescription: z.string().max(2000).optional(),
    exemptionReason: z.enum(EXEMPTION_REASONS).optional(),
    accommodations: z.array(z.enum(ACCOMMODATIONS)).optional(),
  })
  .strict();

export type DraftFields = z.infer<typeof draftFieldsSchema>;

export type FieldErrors = Record<string, string>;

/** 无固定收入 / 通知辩护 免交经济困难证明；其余情形必须提交。 */
export function requiresEconomicProof(reason: ExemptionReason): boolean {
  return reason === "NONE";
}

export interface MaterialMeta {
  kind: string;
  label: string;
  metadata: unknown;
}

export interface SubmittableShape {
  contactName: string;
  contactPhone: string;
  address: string;
  matterType: string;
  matterDescription: string;
  exemptionReason: string;
  accommodations: string | Accommodation[];
}

export function parseAccommodations(raw: string | string[]): Accommodation[] {
  const arr = typeof raw === "string" ? safeParseArray(raw) : raw;
  return arr.filter((a): a is Accommodation =>
    (ACCOMMODATIONS as readonly string[]).includes(a),
  );
}

function safeParseArray(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * 提交前整单校验。返回以字段名为键的错误信息映射（无错误则为空对象）。
 * 规则：选择 NO_FIXED_INCOME / NOTIFIED_CRIMINAL_DEFENSE 时不强制经济困难证明，
 * 身份证明等其他必要材料照常校验。
 */
export function validateForSubmit(
  app: SubmittableShape,
  materials: MaterialMeta[],
): FieldErrors {
  const errors: FieldErrors = {};

  if (app.contactName.trim().length < 2) {
    errors.contactName = "请填写姓名（至少 2 个字符）";
  }
  if (!/^1[3-9]\d{9}$|^0\d{2,3}-?\d{7,8}$/.test(app.contactPhone.trim())) {
    errors.contactPhone = "请填写有效的手机或座机号码";
  }
  if (app.address.trim().length < 5) {
    errors.address = "请填写完整联系地址（至少 5 个字符）";
  }
  if (!(MATTER_TYPES as readonly string[]).includes(app.matterType)) {
    errors.matterType = "请选择事项类型";
  }
  if (app.matterDescription.trim().length < 10) {
    errors.matterDescription = "请填写案情简述（至少 10 个字符）";
  }
  if (!(EXEMPTION_REASONS as readonly string[]).includes(app.exemptionReason)) {
    errors.exemptionReason = "请选择经济状况情形";
  }

  const kinds = new Set(materials.map((m) => m.kind));
  if (!kinds.has("IDENTITY")) {
    errors.identity = "请上传身份证明材料";
  }
  if (
    (EXEMPTION_REASONS as readonly string[]).includes(app.exemptionReason) &&
    requiresEconomicProof(app.exemptionReason as ExemptionReason) &&
    !kinds.has("ECONOMIC_PROOF")
  ) {
    errors.economicProof =
      "当前情形需提交经济困难证明；如无固定收入请选择对应免交情形";
  }

  return errors;
}

export const materialInputSchema = z.object({
  kind: z.enum(MATERIAL_KINDS),
  label: z.string().min(1).max(100),
  metadata: z.record(z.unknown()).default({}),
});

export const correctionInputSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
  reasonCode: z.string().min(1).max(100),
  note: z.string().max(500).default(""),
});
