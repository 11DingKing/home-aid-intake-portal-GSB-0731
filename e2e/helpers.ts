import type { APIRequestContext } from "@playwright/test";

export interface AppView {
  id: string;
  version: number;
  state: string;
  fields: Record<string, unknown>;
  materials: Array<{ id: string; kind: string; label: string }>;
}

export const VALID_FIELDS = {
  contactName: "测试用户",
  contactPhone: "13900001111",
  address: "东城区测试路 88 号 1 单元 101",
  matterType: "LABOR_DISPUTE",
  matterDescription: "用人单位拖欠工资三个月，多次协商未果。",
  exemptionReason: "NONE",
  accommodations: [] as string[],
};

export async function createApp(request: APIRequestContext): Promise<AppView> {
  const res = await request.post("/api/applications");
  if (!res.ok()) throw new Error(`create failed: ${res.status()}`);
  return (await res.json()) as AppView;
}

export async function patchDraft(
  request: APIRequestContext,
  id: string,
  baseVersion: number,
  fields: Record<string, unknown>,
): Promise<AppView> {
  const res = await request.patch(`/api/applications/${id}`, {
    data: { baseVersion, fields },
  });
  if (!res.ok())
    throw new Error(`patch failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as AppView;
}

export async function addMaterial(
  request: APIRequestContext,
  id: string,
  kind: string,
  label: string,
): Promise<AppView> {
  const res = await request.post(`/api/applications/${id}/materials`, {
    data: { kind, label, metadata: { fileName: `${label}.pdf`, size: 1024 } },
  });
  if (!res.ok()) throw new Error(`addMaterial failed: ${res.status()}`);
  return (await res.json()) as AppView;
}

/** 创建一份资料齐全、处于 DRAFT 状态的申请。 */
export async function createValidDraft(
  request: APIRequestContext,
  exemptionReason = "NONE",
): Promise<AppView> {
  const app = await createApp(request);
  const patched = await patchDraft(request, app.id, app.version, {
    ...VALID_FIELDS,
    exemptionReason,
  });
  let view = await addMaterial(request, app.id, "IDENTITY", "身份证复印件");
  if (exemptionReason === "NONE") {
    view = await addMaterial(request, app.id, "ECONOMIC_PROOF", "经济困难证明");
  }
  return { ...view, id: app.id };
}

export async function getApp(
  request: APIRequestContext,
  id: string,
): Promise<AppView> {
  const res = await request.get(`/api/applications/${id}`);
  return (await res.json()) as AppView;
}

export async function submitApp(
  request: APIRequestContext,
  id: string,
  idempotencyKey: string,
) {
  return request.post(`/api/applications/${id}/submit`, { data: { idempotencyKey } });
}

export async function staffTransition(
  request: APIRequestContext,
  id: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  return request.post(`/api/staff/applications/${id}/transition`, {
    data: { action, ...payload },
  });
}

/**
 * 创建一份 NEEDS_CORRECTION 申请：资料齐全提交后被工作人员退回补正
 * （economicProof / ECONOMIC_PROOF_REQUIRED）。返回最新视图（含版本号）。
 */
export async function createNeedsCorrection(
  request: APIRequestContext,
  accommodations: string[] = ["HOME_VISIT_NEEDED"],
): Promise<AppView> {
  const app = await createApp(request);
  await patchDraft(request, app.id, app.version, { ...VALID_FIELDS, accommodations });
  let view = await addMaterial(request, app.id, "IDENTITY", "身份证复印件");
  view = await addMaterial(request, app.id, "ECONOMIC_PROOF", "经济困难证明");
  const sub = await submitApp(request, app.id, `nc-${app.id}`);
  if (!sub.ok()) throw new Error(`submit failed: ${sub.status()}`);
  const corr = await staffTransition(request, app.id, "REQUEST_CORRECTION", {
    fields: ["economicProof"],
    reasonCode: "ECONOMIC_PROOF_REQUIRED",
    note: "证明已过期，请重新上传",
  });
  if (!corr.ok()) throw new Error(`correction failed: ${corr.status()}`);
  view = await getApp(request, app.id);
  if (view.state !== "NEEDS_CORRECTION") throw new Error(`unexpected state ${view.state}`);
  return view;
}
