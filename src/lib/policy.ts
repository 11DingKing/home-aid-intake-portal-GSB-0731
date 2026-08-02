import {
  CORRECTION_FIELDS,
  EDITABLE_FIELDS,
  FIELD_LABELS,
  STATE_LABELS,
  type AppState,
} from "./constants";

export type Role = "APPLICANT" | "STAFF";

/**
 * 写权限边界：按角色 × 状态返回可写字段白名单。
 * 每次加载与提交都在服务端重新计算，不信任客户端缓存。
 */
export function writableFieldsFor(role: Role, state: AppState): readonly string[] {
  if (role === "APPLICANT") {
    return state === "DRAFT" || state === "NEEDS_CORRECTION" ? EDITABLE_FIELDS : [];
  }
  return state === "NEEDS_CORRECTION" ? CORRECTION_FIELDS : [];
}

/** 找出尝试提交中超出白名单的字段。 */
export function findRejectedFields(
  attempted: readonly string[],
  allowed: readonly string[],
): string[] {
  return attempted.filter((f) => !allowed.includes(f));
}

/** 可审计的拒绝理由（写入 ApplicationEvent.note）。 */
export function fieldForbiddenReason(
  role: Role,
  state: AppState,
  rejectedFields: readonly string[],
): string {
  const names = rejectedFields.map((f) => FIELD_LABELS[f] ?? f).join("、");
  return `FIELD_FORBIDDEN: ${role} 在 ${state}（${STATE_LABELS[state]}）状态提交白名单外字段 [${rejectedFields.join(", ")}]（${names}），已整体拒绝`;
}

export function stateConflictReason(role: Role, state: AppState, action: string): string {
  return `STATE_CONFLICT: ${role} 在 ${state}（${STATE_LABELS[state]}）状态尝试 ${action}，被状态机拒绝`;
}

/** 补正伪字段与 API 请求键的映射。 */
export const CORRECTION_KEY_TO_PSEUDO: Record<string, string> = {
  fields: "correctionFields",
  reasonCode: "correctionReasonCode",
  note: "correctionNote",
};
