import { EDITABLE_FIELDS, type EditableField } from "./constants";

export interface MergeConflict {
  field: EditableField;
  serverValue: unknown;
  clientValue: unknown;
}

export interface MergeResult {
  applied: Partial<Record<EditableField, unknown>>;
  conflicts: MergeConflict[];
  newFieldVersions: Record<string, number>;
}

/**
 * 字段级三路合并：客户端基于 baseVersion 的离线编辑与服务端当前值合并。
 * 对每个被修改的字段：
 * - 值与服务端相同 → 跳过（不刷新字段版本，避免全量上送造成假冲突）；
 * - 服务端在 baseVersion 之后改过该字段（fieldVersions[field] > baseVersion）
 *   → 记为冲突并以服务端值为准；
 * - 否则应用客户端值并刷新字段版本。
 * 合理便利等字段因此不会被旧草稿静默覆盖。
 */
export function mergeDraftFields(opts: {
  serverVersion: number;
  serverFields: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  baseVersion: number;
  patch: Record<string, unknown>;
}): MergeResult {
  const { serverVersion, serverFields, fieldVersions, baseVersion, patch } =
    opts;
  const applied: Partial<Record<EditableField, unknown>> = {};
  const conflicts: MergeConflict[] = [];
  const newFieldVersions: Record<string, number> = { ...fieldVersions };

  for (const key of Object.keys(patch)) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) continue;
    const field = key as EditableField;
    if (JSON.stringify(patch[field]) === JSON.stringify(serverFields[field]))
      continue;
    const serverFieldVersion = fieldVersions[field] ?? 0;
    if (serverFieldVersion > baseVersion) {
      conflicts.push({
        field,
        serverValue: serverFields[field],
        clientValue: patch[field],
      });
      continue;
    }
    applied[field] = patch[field];
    newFieldVersions[field] = serverVersion + 1;
  }

  return { applied, conflicts, newFieldVersions };
}

export function parseFieldVersions(raw: string): Record<string, number> {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, number> = {};
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === "number" && Number.isInteger(val)) out[k] = val;
      }
      return out;
    }
  } catch {
    /* fall through */
  }
  return {};
}
