import { EDITABLE_FIELDS, type AppState } from "./constants";
import { parseAccommodations } from "./validation";

export type StaffView = "INTAKE_REVIEW" | "CORRECTION_REVIEW";

export const STAFF_VIEWS: Record<StaffView, readonly string[]> = {
  INTAKE_REVIEW: [
    "id",
    "state",
    "exemptionReason",
    "materialMetadata",
    "accommodations",
  ],
  CORRECTION_REVIEW: [
    "id",
    "state",
    "correctionFields",
    "submittedFieldMetadata",
  ],
};

export interface StaffProjectionSource {
  id: string;
  state: AppState;
  exemptionReason: string;
  accommodations: string;
  materials: Array<{ kind: string; label: string; metadata: string }>;
  corrections: Array<{
    fields: string;
    reasonCode: string;
    note: string;
    createdAt: Date;
  }>;
  contactName: string;
  contactPhone: string;
  address: string;
  matterType: string;
  matterDescription: string;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

/** 字段值元数据：只暴露是否存在与长度/类型，绝不暴露原始值。 */
function fieldValueMetadata(value: string): {
  present: boolean;
  length: number;
} {
  return { present: value.trim().length > 0, length: value.trim().length };
}

/**
 * 工作人员最小披露投影。服务端在响应前调用，越权字段根本不会离开服务器。
 * - INTAKE_REVIEW：受理初审只需要 id、状态、免交情形、材料元数据、合理便利。
 * - CORRECTION_REVIEW：补正复核只需要 id、状态、补正字段、已提交字段的元数据。
 */
export function projectForStaffView(
  app: StaffProjectionSource,
  view: StaffView,
): Record<string, unknown> {
  if (view === "INTAKE_REVIEW") {
    return {
      id: app.id,
      state: app.state,
      exemptionReason: app.exemptionReason,
      materialMetadata: app.materials.map((m) => ({
        kind: m.kind,
        label: m.label,
        metadata: parseJsonObject(m.metadata),
      })),
      accommodations: parseAccommodations(app.accommodations),
    };
  }

  const latestCorrection = [...app.corrections].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];

  const submittedFieldMetadata: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field === "accommodations") {
      submittedFieldMetadata[field] = {
        present: parseAccommodations(app.accommodations).length > 0,
        count: parseAccommodations(app.accommodations).length,
      };
    } else {
      submittedFieldMetadata[field] = fieldValueMetadata(
        String(app[field as keyof StaffProjectionSource] ?? ""),
      );
    }
  }
  submittedFieldMetadata.materials = app.materials.map((m) => ({
    kind: m.kind,
    label: m.label,
    metadata: parseJsonObject(m.metadata),
  }));

  return {
    id: app.id,
    state: app.state,
    correctionFields: latestCorrection
      ? {
          fields: parseJsonStringArray(latestCorrection.fields),
          reasonCode: latestCorrection.reasonCode,
          note: latestCorrection.note,
        }
      : null,
    submittedFieldMetadata,
  };
}

export function isStaffView(value: unknown): value is StaffView {
  return value === "INTAKE_REVIEW" || value === "CORRECTION_REVIEW";
}
