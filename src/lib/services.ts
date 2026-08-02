import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppState, EditableField } from "./constants";
import { CORRECTION_FIELDS } from "./constants";
import {
  parseFieldVersions,
  mergeDraftFields,
  type MergeConflict,
} from "./merge";
import {
  nextState,
  StateTransitionError,
  type TransitionAction,
} from "./state-machine";
import {
  parseAccommodations,
  validateForSubmit,
  type FieldErrors,
} from "./validation";

type Tx = Prisma.TransactionClient | PrismaClient;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const includeRels = {
  materials: true,
  corrections: { orderBy: { createdAt: "desc" as const }, take: 1 },
} satisfies Prisma.ApplicationInclude;

type ApplicationWithRels = Prisma.ApplicationGetPayload<{
  include: typeof includeRels;
}>;

async function mustGet(tx: Tx, id: string): Promise<ApplicationWithRels> {
  const app = await tx.application.findUnique({
    where: { id },
    include: includeRels,
  });
  if (!app) throw new ApiError(404, "NOT_FOUND", `申请 ${id} 不存在`);
  return app;
}

/** 申请人视角的完整自有数据。 */
export function serializeApplicantView(app: ApplicationWithRels) {
  return {
    id: app.id,
    version: app.version,
    state: app.state as AppState,
    fields: {
      contactName: app.contactName,
      contactPhone: app.contactPhone,
      address: app.address,
      matterType: app.matterType,
      matterDescription: app.matterDescription,
      exemptionReason: app.exemptionReason,
      accommodations: parseAccommodations(app.accommodations),
    },
    materials: app.materials.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      metadata: safeObject(m.metadata),
    })),
    submittedAt: app.submittedAt?.toISOString() ?? null,
    latestCorrection: app.corrections[0]
      ? {
          fields: safeStringArray(app.corrections[0].fields),
          reasonCode: app.corrections[0].reasonCode,
          note: app.corrections[0].note,
        }
      : null,
  };
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeStringArray(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

const DRAFT_EDITABLE_STATES: AppState[] = ["DRAFT", "NEEDS_CORRECTION"];

export interface DraftSaveResult {
  application: ApplicationWithRels;
  conflicts: Array<MergeConflict & { serverValue: unknown }>;
}

/** 草稿保存：按 baseVersion 做字段级合并，冲突字段以服务端为准并回传。 */
export async function saveDraft(
  tx: Tx,
  id: string,
  baseVersion: number,
  patch: Record<string, unknown>,
): Promise<DraftSaveResult> {
  const app = await mustGet(tx, id);
  const state = app.state as AppState;
  if (!DRAFT_EDITABLE_STATES.includes(state)) {
    throw new ApiError(409, "DRAFT_LOCKED", `当前状态 ${state} 不可编辑草稿`);
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new ApiError(400, "BAD_VERSION", "baseVersion 必须是非负整数");
  }

  const fieldVersions = parseFieldVersions(app.fieldVersions);
  const serverFields: Record<string, unknown> = {
    contactName: app.contactName,
    contactPhone: app.contactPhone,
    address: app.address,
    matterType: app.matterType,
    matterDescription: app.matterDescription,
    exemptionReason: app.exemptionReason,
    accommodations: parseAccommodations(app.accommodations),
  };
  const merge = mergeDraftFields({
    serverVersion: app.version,
    serverFields,
    fieldVersions,
    baseVersion,
    patch,
  });

  const data: Prisma.ApplicationUpdateInput = {
    version: app.version + 1,
    fieldVersions: JSON.stringify(merge.newFieldVersions),
  };
  for (const [field, value] of Object.entries(merge.applied)) {
    if (field === "accommodations") {
      data.accommodations = JSON.stringify(value ?? []);
    } else {
      data[field as Exclude<EditableField, "accommodations">] = value as string;
    }
  }

  const updated = await tx.application.update({
    where: { id: app.id },
    data,
    include: includeRels,
  });

  return { application: updated, conflicts: merge.conflicts };
}

export interface StaffCorrectionPatch {
  fields?: string[];
  reasonCode?: string;
  note?: string;
}

export interface StaffCorrectionResult {
  version: number;
  state: AppState;
  correction: { fields: string[]; reasonCode: string; note: string };
  conflicts: MergeConflict[];
}

/**
 * 工作人员编辑补正要求：与申请人草稿共用同一乐观版本合并域。
 * 基于同一旧草稿时——申请人改字段/补材料、工作人员写补正 reason code
 * 互不冲突、各自生效；两个工作人员会话改同一补正伪字段则冲突，
 * 服务端值获胜并把冲突字段返回给对应会话。合理便利等申请人字段不受影响。
 */
export async function saveStaffCorrection(
  tx: Tx,
  id: string,
  baseVersion: number,
  patch: StaffCorrectionPatch,
): Promise<StaffCorrectionResult> {
  const app = await mustGet(tx, id);
  const state = app.state as AppState;
  if (state !== "NEEDS_CORRECTION") {
    throw new ApiError(
      409,
      "STATE_CONFLICT",
      `当前状态 ${state} 没有可编辑的补正要求`,
    );
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    throw new ApiError(400, "BAD_VERSION", "baseVersion 必须是非负整数");
  }
  const latest = app.corrections[0];
  if (!latest) {
    throw new ApiError(409, "NO_CORRECTION", "该申请没有补正记录");
  }

  const serverFields: Record<string, unknown> = {
    correctionFields: safeStringArray(latest.fields),
    correctionReasonCode: latest.reasonCode,
    correctionNote: latest.note,
  };
  const pseudoPatch: Record<string, unknown> = {};
  if (patch.fields !== undefined) pseudoPatch.correctionFields = patch.fields;
  if (patch.reasonCode !== undefined)
    pseudoPatch.correctionReasonCode = patch.reasonCode;
  if (patch.note !== undefined) pseudoPatch.correctionNote = patch.note;

  const fieldVersions = parseFieldVersions(app.fieldVersions);
  const merge = mergeDraftFields({
    serverVersion: app.version,
    serverFields,
    fieldVersions,
    baseVersion,
    patch: pseudoPatch,
    allowedFields: CORRECTION_FIELDS,
  });

  if (Object.keys(merge.applied).length > 0) {
    await tx.correction.update({
      where: { id: latest.id },
      data: {
        fields: JSON.stringify(
          merge.applied.correctionFields ?? serverFields.correctionFields,
        ),
        reasonCode: String(
          merge.applied.correctionReasonCode ??
            serverFields.correctionReasonCode,
        ),
        note: String(
          merge.applied.correctionNote ?? serverFields.correctionNote,
        ),
      },
    });
  }
  const updated = await tx.application.update({
    where: { id },
    data: {
      version: app.version + 1,
      fieldVersions: JSON.stringify(merge.newFieldVersions),
    },
    include: includeRels,
  });
  const updatedLatest = updated.corrections[0]!;
  return {
    version: updated.version,
    state: updated.state as AppState,
    correction: {
      fields: safeStringArray(updatedLatest.fields),
      reasonCode: updatedLatest.reasonCode,
      note: updatedLatest.note,
    },
    conflicts: merge.conflicts,
  };
}

/** 替换材料元数据（保留材料 ID 与种类，整体替换 metadata，可改 label）。 */
export async function replaceMaterialMetadata(
  tx: Tx,
  id: string,
  materialId: string,
  patch: { label?: string; metadata: Record<string, unknown> },
): Promise<ApplicationWithRels> {
  const app = await mustGet(tx, id);
  const state = app.state as AppState;
  if (!DRAFT_EDITABLE_STATES.includes(state)) {
    throw new ApiError(409, "DRAFT_LOCKED", `当前状态 ${state} 不可修改材料`);
  }
  const material = await tx.material.findUnique({ where: { id: materialId } });
  if (!material || material.applicationId !== id) {
    throw new ApiError(404, "NOT_FOUND", `材料 ${materialId} 不存在`);
  }
  await tx.material.update({
    where: { id: materialId },
    data: {
      label: patch.label ?? material.label,
      metadata: JSON.stringify(patch.metadata),
    },
  });
  return tx.application.update({
    where: { id },
    data: { version: { increment: 1 } },
    include: includeRels,
  });
}

export interface SubmitResult {
  application: ApplicationWithRels;
  duplicate: boolean;
}

/**
 * 幂等最终提交。同一 idempotencyKey 重复提交返回首次结果（duplicate=true），
 * 不重复校验、不重复写入事件。
 */
export async function submitApplication(
  tx: Tx,
  id: string,
  idempotencyKey: string,
): Promise<SubmitResult> {
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new ApiError(400, "BAD_IDEMPOTENCY_KEY", "缺少有效的幂等键");
  }
  const app = await mustGet(tx, id);
  const state = app.state as AppState;

  if (app.idempotencyKey === idempotencyKey && state !== "DRAFT") {
    return { application: app, duplicate: true };
  }
  if (state !== "DRAFT") {
    throw new ApiError(409, "STATE_CONFLICT", `当前状态 ${state} 不能提交`);
  }
  const keyOwner = await tx.application.findUnique({
    where: { idempotencyKey },
  });
  if (keyOwner && keyOwner.id !== id) {
    throw new ApiError(409, "DUPLICATE_KEY", "幂等键已被其他申请使用");
  }

  const fieldErrors = validateForSubmit(app, app.materials);
  if (Object.keys(fieldErrors).length > 0) {
    throw new ApiError(422, "VALIDATION_FAILED", "提交校验未通过", {
      fieldErrors,
    });
  }

  const to = nextState("DRAFT", "SUBMIT");
  const claimed = await tx.application.updateMany({
    where: { id, state: "DRAFT" },
    data: {
      state: to,
      idempotencyKey,
      submittedAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    // 并发下另一请求已提交：同键视为重复成功，异键视为状态冲突。
    const fresh = await mustGet(tx, id);
    if (fresh.idempotencyKey === idempotencyKey) {
      return { application: fresh, duplicate: true };
    }
    throw new ApiError(409, "STATE_CONFLICT", "申请已被提交");
  }
  await tx.applicationEvent.create({
    data: {
      applicationId: id,
      fromState: "DRAFT",
      toState: to,
      actor: "APPLICANT",
    },
  });
  return { application: await mustGet(tx, id), duplicate: false };
}

/** 补正后重新提交，同样按幂等键去重。 */
export async function resubmitApplication(
  tx: Tx,
  id: string,
  idempotencyKey: string,
): Promise<SubmitResult> {
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new ApiError(400, "BAD_IDEMPOTENCY_KEY", "缺少有效的幂等键");
  }
  const app = await mustGet(tx, id);
  const state = app.state as AppState;

  if (app.idempotencyKey === idempotencyKey && state === "RESUBMITTED") {
    return { application: app, duplicate: true };
  }
  if (state !== "NEEDS_CORRECTION") {
    throw new ApiError(409, "STATE_CONFLICT", `当前状态 ${state} 不能重新提交`);
  }

  const fieldErrors = validateForSubmit(app, app.materials);
  if (Object.keys(fieldErrors).length > 0) {
    throw new ApiError(422, "VALIDATION_FAILED", "提交校验未通过", {
      fieldErrors,
    });
  }

  const to = nextState("NEEDS_CORRECTION", "RESUBMIT");
  await tx.application.update({
    where: { id },
    data: {
      state: to,
      idempotencyKey,
      submittedAt: new Date(),
      version: { increment: 1 },
    },
  });
  await tx.applicationEvent.create({
    data: {
      applicationId: id,
      fromState: "NEEDS_CORRECTION",
      toState: to,
      actor: "APPLICANT",
    },
  });
  return { application: await mustGet(tx, id), duplicate: false };
}

/** 工作人员状态操作：请求补正 / 受理 / 不予受理。 */
export async function staffTransition(
  tx: Tx,
  id: string,
  action: TransitionAction,
  payload: { fields?: string[]; reasonCode?: string; note?: string } = {},
): Promise<ApplicationWithRels> {
  const app = await mustGet(tx, id);
  const from = app.state as AppState;

  let to: AppState;
  try {
    to = nextState(from, action);
  } catch (e) {
    if (e instanceof StateTransitionError) {
      throw new ApiError(409, "STATE_CONFLICT", e.message);
    }
    throw e;
  }

  if (action === "REQUEST_CORRECTION") {
    if (!payload.fields?.length || !payload.reasonCode) {
      throw new ApiError(
        400,
        "BAD_CORRECTION",
        "请求补正必须包含 fields 与 reasonCode",
      );
    }
    await tx.correction.create({
      data: {
        applicationId: id,
        fields: JSON.stringify(payload.fields),
        reasonCode: payload.reasonCode,
        note: payload.note ?? "",
      },
    });
  }

  await tx.application.update({
    where: { id },
    data: { state: to, version: { increment: 1 } },
  });
  await tx.applicationEvent.create({
    data: {
      applicationId: id,
      fromState: from,
      toState: to,
      actor: "STAFF",
      note: payload.note ?? "",
    },
  });
  return mustGet(tx, id);
}

export function materialFieldErrors(app: ApplicationWithRels): FieldErrors {
  return validateForSubmit(app, app.materials);
}
