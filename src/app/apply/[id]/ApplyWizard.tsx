"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnouncer } from "@/components/Announcer";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ACCOMMODATIONS,
  ACCOMMODATION_LABELS,
  EXEMPTION_REASONS,
  EXEMPTION_LABELS,
  FIELD_LABELS,
  MATERIAL_KINDS,
  MATERIAL_KIND_LABELS,
  MATTER_TYPES,
  MATTER_TYPE_LABELS,
  STATE_LABELS,
  type Accommodation,
  type AppState,
  type ExemptionReason,
  type MaterialKind,
} from "@/lib/constants";
import { requiresEconomicProof } from "@/lib/validation";
import { Fieldset, TextField } from "./fields";

export interface ApplicantView {
  id: string;
  version: number;
  state: AppState;
  fields: {
    contactName: string;
    contactPhone: string;
    address: string;
    matterType: string;
    matterDescription: string;
    exemptionReason: string;
    accommodations: string[];
  };
  materials: Array<{
    id: string;
    kind: string;
    label: string;
    metadata: Record<string, unknown>;
  }>;
  submittedAt: string | null;
  latestCorrection: {
    fields: string[];
    reasonCode: string;
    note: string;
  } | null;
}

type Fields = ApplicantView["fields"];
type SyncStatus = "synced" | "dirty" | "syncing" | "offline";

interface ConflictInfo {
  field: string;
  serverValue: unknown;
  clientValue: unknown;
}

const STEPS = [
  { title: "联系方式", fields: ["contactName", "contactPhone", "address"] },
  { title: "案情信息", fields: ["matterType", "matterDescription"] },
  { title: "经济状况", fields: ["exemptionReason"] },
  { title: "申请材料", fields: ["identity", "economicProof"] },
  { title: "合理便利", fields: ["accommodations"] },
  { title: "确认提交", fields: [] },
] as const;

const SYNC_LABELS: Record<SyncStatus, string> = {
  synced: "已同步至服务器",
  dirty: "有未同步的修改",
  syncing: "正在同步…",
  offline: "离线：修改已保存在本机",
};

function draftKey(id: string) {
  return `draft:${id}`;
}
function idemKey(id: string) {
  return `idem:${id}`;
}

function loadLocalDraft(
  id: string,
): { baseVersion: number; fields: Fields; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      baseVersion: number;
      fields: Fields;
      savedAt: string;
    };
    if (typeof parsed.baseVersion !== "number" || !parsed.fields) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function ApplyWizard({ initial }: { initial: ApplicantView }) {
  const { announce } = useAnnouncer();
  const [appState, setAppState] = useState<AppState>(initial.state);
  const [version, setVersion] = useState(initial.version);
  const [fields, setFieldsState] = useState<Fields>(initial.fields);
  const [materials, setMaterials] = useState(initial.materials);
  const [latestCorrection, setLatestCorrection] = useState(
    initial.latestCorrection,
  );
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(
    initial.state !== "DRAFT" && initial.state !== "NEEDS_CORRECTION",
  );

  // ref 与 state 同步维护，保证异步同步流程读到的是最新字段。
  const baseVersionRef = useRef(initial.version);
  const fieldsRef = useRef<Fields>(initial.fields);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncingRef = useRef(false);
  const pendingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const correctionRef = useRef<string | null>(
    JSON.stringify(initial.latestCorrection),
  );

  const updateFields = useCallback((next: Fields) => {
    fieldsRef.current = next;
    setFieldsState(next);
  }, []);

  const editable = appState === "DRAFT" || appState === "NEEDS_CORRECTION";

  /** 应用服务端视图：版本、材料、状态、字段级冲突回退（服务端值为准）。 */
  const applyServerView = useCallback(
    (
      view: ApplicantView,
      conflictList: ConflictInfo[],
      overwriteAllFields: boolean,
    ) => {
      setVersion(view.version);
      baseVersionRef.current = view.version;
      setMaterials(view.materials);
      setAppState(view.state);
      // 工作人员更新补正要求时向申请人公告（补正、合并、冲突都不得清空合理便利）。
      const prevCorrection = correctionRef.current;
      const nextCorrection = JSON.stringify(view.latestCorrection);
      if (
        prevCorrection !== null &&
        prevCorrection !== nextCorrection &&
        view.latestCorrection
      ) {
        announce(
          `工作人员更新了补正要求：${view.latestCorrection.fields
            .map((f) => FIELD_LABELS[f] ?? f)
            .join("、")}（${view.latestCorrection.reasonCode}）`,
        );
      }
      correctionRef.current = nextCorrection;
      setLatestCorrection(view.latestCorrection);
      let nextFields = fieldsRef.current;
      if (overwriteAllFields) {
        nextFields = view.fields;
      } else if (conflictList.length > 0) {
        nextFields = { ...fieldsRef.current };
        for (const c of conflictList) {
          (nextFields as Record<string, unknown>)[c.field] = c.serverValue;
        }
      }
      updateFields(nextFields);
      if (conflictList.length > 0) {
        setConflicts(conflictList);
        const names = conflictList
          .map((c) => FIELD_LABELS[c.field] ?? c.field)
          .join("、");
        announce(`以下字段与其他会话冲突，已保留服务器版本：${names}`);
      }
      return nextFields;
    },
    [announce, updateFields],
  );

  const syncNow = useCallback(async () => {
    if (syncingRef.current) {
      pendingRef.current = true;
      return;
    }
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return;
    }
    syncingRef.current = true;
    setSyncStatus("syncing");
    try {
      const res = await fetch(`/api/applications/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersion: baseVersionRef.current,
          fields: fieldsRef.current,
        }),
      });
      if (res.ok) {
        const view = (await res.json()) as ApplicantView & {
          conflicts: ConflictInfo[];
        };
        const nextFields = applyServerView(view, view.conflicts ?? [], false);
        localStorage.setItem(
          draftKey(initial.id),
          JSON.stringify({
            baseVersion: view.version,
            fields: nextFields,
            savedAt: new Date().toISOString(),
          }),
        );
        setSyncStatus("synced");
      } else if (res.status === 409) {
        // 服务端状态机已前进（如已被受理）：以服务端为准整体收敛。
        const fresh = await fetch(`/api/applications/${initial.id}`);
        if (fresh.ok) {
          const view = (await fresh.json()) as ApplicantView;
          applyServerView(view, [], true);
          setSubmitted(
            view.state !== "DRAFT" && view.state !== "NEEDS_CORRECTION",
          );
          localStorage.removeItem(draftKey(initial.id));
          setSyncStatus("synced");
          announce(`申请状态已更新为：${STATE_LABELS[view.state]}`);
        }
      } else {
        setSyncStatus("dirty");
      }
    } catch {
      setSyncStatus("offline");
    } finally {
      syncingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void syncNow();
      }
    }
  }, [announce, applyServerView, initial.id]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void syncNow(), 700);
  }, [syncNow]);

  // 挂载时恢复本机离线草稿：以草稿记录的 baseVersion 参与后续字段级合并。
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const local = loadLocalDraft(initial.id);
    if (
      local &&
      JSON.stringify(local.fields) !== JSON.stringify(initial.fields)
    ) {
      baseVersionRef.current = local.baseVersion;
      updateFields(local.fields);
      setSyncStatus("dirty");
      announce("已从本机恢复未同步的离线草稿，正在与服务器合并");
      void syncNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  // 网络状态监听：断线公告、恢复后自动同步。
  useEffect(() => {
    function onOffline() {
      setSyncStatus("offline");
      announce("网络已断开，修改将保存在本机，恢复联网后自动同步");
    }
    function onOnline() {
      announce("网络已恢复，正在同步离线修改");
      void syncNow();
    }
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [announce, syncNow]);

  // 步骤切换后焦点恢复到步骤标题。
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function setField<K extends keyof Fields>(name: K, value: Fields[K]) {
    if (!editable) return;
    const next = { ...fieldsRef.current, [name]: value };
    updateFields(next);
    localStorage.setItem(
      draftKey(initial.id),
      JSON.stringify({
        baseVersion: baseVersionRef.current,
        fields: next,
        savedAt: new Date().toISOString(),
      }),
    );
    setErrors((prev) => {
      if (!prev[name as string]) return prev;
      const rest = { ...prev };
      delete rest[name as string];
      return rest;
    });
    setSyncStatus(navigator.onLine ? "dirty" : "offline");
    scheduleSync();
  }

  function gotoStep(next: number) {
    setStep(next);
    announce(`第 ${next + 1} 步，共 ${STEPS.length} 步：${STEPS[next].title}`);
  }

  function validateStepLocal(stepIndex: number): Record<string, string> {
    const errs: Record<string, string> = {};
    if (stepIndex === 0) {
      if (fields.contactName.trim().length < 2)
        errs.contactName = "请填写姓名（至少 2 个字符）";
      if (!fields.contactPhone.trim()) errs.contactPhone = "请填写联系电话";
      if (fields.address.trim().length < 5)
        errs.address = "请填写完整联系地址（至少 5 个字符）";
    }
    if (stepIndex === 1) {
      if (!fields.matterType) errs.matterType = "请选择事项类型";
      if (fields.matterDescription.trim().length < 10)
        errs.matterDescription = "请填写案情简述（至少 10 个字符）";
    }
    if (stepIndex === 3) {
      const kinds = new Set(materials.map((m) => m.kind));
      if (!kinds.has("IDENTITY")) errs.identity = "请上传身份证明材料";
      if (
        requiresEconomicProof(fields.exemptionReason as ExemptionReason) &&
        !kinds.has("ECONOMIC_PROOF")
      ) {
        errs.economicProof =
          "当前情形需提交经济困难证明；如无固定收入请选择对应免交情形";
      }
    }
    return errs;
  }

  // 错误汇总出现时焦点恢复到汇总框。
  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      summaryRef.current?.focus();
    }
  }, [errors]);

  function nextStep() {
    const errs = validateStepLocal(step);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      announce(`本步有 ${Object.keys(errs).length} 处需要修改`);
      return;
    }
    setErrors({});
    gotoStep(Math.min(step + 1, STEPS.length - 1));
  }

  function prevStep() {
    setErrors({});
    gotoStep(Math.max(step - 1, 0));
  }

  function focusField(fieldId: string) {
    // 材料类错误没有同名输入控件，依次回退到错误节点或字段容器。
    const el =
      document.getElementById(fieldId) ??
      document.getElementById(`${fieldId}-error`) ??
      document.querySelector(`[data-field="${fieldId}"]`);
    if (el instanceof HTMLElement) {
      if (!el.matches("input, select, textarea, button, a[href]")) {
        el.tabIndex = -1;
      }
      el.focus();
      el.scrollIntoView({ block: "center" });
    }
  }

  function getIdempotencyKey(): string {
    let key = localStorage.getItem(idemKey(initial.id));
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(idemKey(initial.id), key);
    }
    return key;
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    // 先冲刷未同步草稿，保证服务端校验基于最新值。
    if (syncTimer.current) clearTimeout(syncTimer.current);
    await syncNow();
    const isResubmit = appState === "NEEDS_CORRECTION";
    try {
      const res = await fetch(
        `/api/applications/${initial.id}/${isResubmit ? "resubmit" : "submit"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: getIdempotencyKey() }),
        },
      );
      const body = (await res.json()) as ApplicantView & {
        duplicate?: boolean;
        error?: {
          code: string;
          message: string;
          details?: { fieldErrors?: Record<string, string> };
        };
      };
      if (res.ok) {
        setAppState(body.state);
        setSubmitted(true);
        setVersion(body.version);
        localStorage.removeItem(draftKey(initial.id));
        if (body.duplicate) {
          announce("检测到重复提交，已忽略，保持首次提交结果");
        } else {
          announce(
            isResubmit
              ? "重新提交成功，等待工作人员复核"
              : "提交成功，等待工作人员初审",
          );
        }
      } else if (res.status === 422 && body.error?.details?.fieldErrors) {
        const fieldErrors = body.error.details.fieldErrors;
        setErrors(fieldErrors);
        const firstField = Object.keys(fieldErrors)[0];
        const targetStep = STEPS.findIndex((s) =>
          (s.fields as readonly string[]).includes(firstField),
        );
        if (targetStep >= 0 && targetStep !== step) setStep(targetStep);
        announce(
          `提交未通过，共 ${Object.keys(fieldErrors).length} 处需要修改`,
        );
      } else {
        announce(body.error?.message ?? "提交失败，请稍后重试");
        setErrors({ submit: body.error?.message ?? "提交失败，请稍后重试" });
      }
    } catch {
      setErrors({
        submit: "网络异常，提交未完成。修改已保存在本机，请联网后重试。",
      });
      announce("网络异常，提交未完成");
    } finally {
      setSubmitting(false);
    }
  }

  async function addMaterial(
    kind: MaterialKind,
    label: string,
    meta: Record<string, unknown>,
  ) {
    const res = await fetch(`/api/applications/${initial.id}/materials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, label, metadata: meta }),
    });
    if (res.ok) {
      const view = (await res.json()) as ApplicantView;
      applyServerView(view, [], false);
      setSyncStatus("synced");
      announce(`已添加材料：${label}`);
      setErrors((prev) => {
        const rest = { ...prev };
        delete rest.identity;
        delete rest.economicProof;
        return rest;
      });
    } else {
      announce("添加材料失败，请重试");
    }
  }

  async function removeMaterial(materialId: string, label: string) {
    const res = await fetch(
      `/api/applications/${initial.id}/materials/${materialId}`,
      {
        method: "DELETE",
      },
    );
    if (res.ok) {
      const view = (await res.json()) as ApplicantView;
      applyServerView(view, [], false);
      announce(`已删除材料：${label}`);
    }
  }

  /** 替换材料元数据（保留材料 ID 与种类），例如重新选择证明文件。 */
  async function replaceMaterial(
    materialId: string,
    label: string,
    meta: Record<string, unknown>,
  ) {
    const res = await fetch(
      `/api/applications/${initial.id}/materials/${materialId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: meta }),
      },
    );
    if (res.ok) {
      const view = (await res.json()) as ApplicantView;
      applyServerView(view, [], false);
      announce(`已替换材料 ${label} 的文件元数据`);
    } else {
      announce("替换材料失败，请重试");
    }
  }

  const exemption = fields.exemptionReason as ExemptionReason;
  const economicProofExempt = !requiresEconomicProof(exemption);
  const errorCount = Object.keys(errors).length;

  const summaryItems = useMemo(
    () =>
      Object.entries(errors).map(([field, msg]) => ({
        field,
        label: FIELD_LABELS[field] ?? field,
        msg,
      })),
    [errors],
  );

  return (
    <>
      <div className="status-line">
        <h1 style={{ margin: 0, fontSize: "1.35rem" }}>预申请 {initial.id}</h1>
        <StatusBadge state={appState} />
        <span data-testid="save-status" role="status">
          保存状态：{SYNC_LABELS[syncStatus]}
        </span>
        <span className="sr-only" data-testid="version">
          版本 v{version}
        </span>
      </div>

      {appState === "NEEDS_CORRECTION" && latestCorrection ? (
        <div
          className="notice warn"
          role="alert"
          data-testid="correction-notice"
        >
          <strong>工作人员要求补正：</strong>
          {latestCorrection.fields.map((f) => FIELD_LABELS[f] ?? f).join("、")}
          （{latestCorrection.reasonCode}）{latestCorrection.note}
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="notice" role="status" data-testid="conflict-notice">
          以下字段与其他会话的修改冲突，已保留服务器版本：
          {conflicts.map((c) => FIELD_LABELS[c.field] ?? c.field).join("、")}
        </div>
      ) : null}

      <nav aria-label="填写步骤">
        <ol className="step-list">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              aria-current={i === step ? "step" : undefined}
              className={i < step ? "done" : undefined}
            >
              {i < step ? "✓ " : ""}
              {i + 1}. {s.title}
            </li>
          ))}
        </ol>
      </nav>

      {errorCount > 0 ? (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
          data-testid="error-summary"
          aria-labelledby="error-summary-title"
        >
          <h2 id="error-summary-title">有 {errorCount} 处需要修改</h2>
          <ul>
            {summaryItems.map((item) => (
              <li key={item.field}>
                <a
                  href={`#${item.field}`}
                  onClick={(e) => {
                    e.preventDefault();
                    focusField(item.field);
                  }}
                >
                  {item.label}
                </a>
                ：{item.msg}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card" aria-labelledby="step-heading">
        <h2
          id="step-heading"
          tabIndex={-1}
          ref={headingRef}
          data-testid="step-heading"
        >
          第 {step + 1} 步：{STEPS[step].title}
        </h2>

        {submitted ? (
          <SubmittedView state={appState} id={initial.id} />
        ) : (
          <>
            {step === 0 ? (
              <>
                <TextField
                  id="contactName"
                  label="姓名"
                  required
                  value={fields.contactName}
                  onChange={(v) => setField("contactName", v)}
                  error={errors.contactName}
                  hint="请填写真实姓名"
                />
                <TextField
                  id="contactPhone"
                  label="联系电话"
                  type="tel"
                  required
                  value={fields.contactPhone}
                  onChange={(v) => setField("contactPhone", v)}
                  error={errors.contactPhone}
                  hint="手机号码或带区号的座机号码"
                />
                <TextField
                  id="address"
                  label="联系地址"
                  required
                  value={fields.address}
                  onChange={(v) => setField("address", v)}
                  error={errors.address}
                />
              </>
            ) : null}

            {step === 1 ? (
              <>
                <div className="field" data-field="matterType">
                  <label htmlFor="matterType">事项类型（必填）</label>
                  <select
                    id="matterType"
                    value={fields.matterType}
                    onChange={(e) => setField("matterType", e.target.value)}
                    aria-invalid={errors.matterType ? true : undefined}
                    aria-describedby={
                      errors.matterType ? "matterType-error" : undefined
                    }
                  >
                    <option value="">请选择…</option>
                    {MATTER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {MATTER_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  {errors.matterType ? (
                    <p className="error" id="matterType-error" role="alert">
                      {errors.matterType}
                    </p>
                  ) : null}
                </div>
                <TextField
                  id="matterDescription"
                  label="案情简述"
                  required
                  multiline
                  value={fields.matterDescription}
                  onChange={(v) => setField("matterDescription", v)}
                  error={errors.matterDescription}
                  hint="至少 10 个字符，说明事实与诉求"
                />
              </>
            ) : null}

            {step === 2 ? (
              <Fieldset
                id="exemptionReason"
                legend="经济状况情形（必填）"
                error={errors.exemptionReason}
                hint="无固定收入或通知辩护刑事案件免交经济困难证明"
              >
                <ul className="check-list">
                  {EXEMPTION_REASONS.map((r) => (
                    <li key={r}>
                      <label htmlFor={`exemption-${r}`}>
                        <input
                          id={`exemption-${r}`}
                          type="radio"
                          name="exemptionReason"
                          value={r}
                          checked={fields.exemptionReason === r}
                          onChange={() => setField("exemptionReason", r)}
                        />
                        {EXEMPTION_LABELS[r]}
                      </label>
                    </li>
                  ))}
                </ul>
              </Fieldset>
            ) : null}

            {step === 3 ? (
              <MaterialsStep
                materials={materials}
                economicProofExempt={economicProofExempt}
                exemptionReason={exemption}
                errors={errors}
                onAdd={addMaterial}
                onRemove={removeMaterial}
                onReplace={replaceMaterial}
              />
            ) : null}

            {step === 4 ? (
              <Fieldset
                id="accommodations"
                legend="合理便利需求（可多选）"
                error={errors.accommodations}
                hint="工作人员接续办理时会看到您的需求；旧草稿不会覆盖此处已保存的选择"
              >
                <ul className="check-list">
                  {ACCOMMODATIONS.map((a) => (
                    <li key={a}>
                      <label htmlFor={`acc-${a}`}>
                        <input
                          id={`acc-${a}`}
                          type="checkbox"
                          checked={fields.accommodations.includes(a)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...fields.accommodations, a]
                              : fields.accommodations.filter((x) => x !== a);
                            setField("accommodations", next as Accommodation[]);
                          }}
                        />
                        {ACCOMMODATION_LABELS[a]}
                      </label>
                    </li>
                  ))}
                </ul>
              </Fieldset>
            ) : null}

            {step === 5 ? (
              <ConfirmStep
                fields={fields}
                materials={materials}
                economicProofExempt={economicProofExempt}
              />
            ) : null}

            <div className="btn-row">
              {step > 0 ? (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={prevStep}
                >
                  上一步
                </button>
              ) : null}
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn" onClick={nextStep}>
                  下一步
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleSubmit()}
                  disabled={submitting}
                >
                  {appState === "NEEDS_CORRECTION"
                    ? "补正后重新提交"
                    : "提交申请"}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function SubmittedView({ state, id }: { state: AppState; id: string }) {
  return (
    <div className="notice" role="status" data-testid="submitted-view">
      <p>
        申请 {id} 当前状态：{STATE_LABELS[state]}。
        {state === "ACCEPTED" ? "工作人员已受理，请保持联系方式畅通。" : null}
        {state === "DECLINED"
          ? "本次申请未予受理，如有疑问请联系法律援助机构。"
          : null}
        {state === "SUBMITTED" || state === "RESUBMITTED"
          ? "工作人员正在处理，请耐心等待。"
          : null}
      </p>
    </div>
  );
}

function ConfirmStep({
  fields,
  materials,
  economicProofExempt,
}: {
  fields: Fields;
  materials: ApplicantView["materials"];
  economicProofExempt: boolean;
}) {
  return (
    <div data-testid="confirm-step">
      <table className="plain">
        <caption className="sr-only">提交前信息确认</caption>
        <tbody>
          <tr>
            <th scope="row">姓名</th>
            <td>{fields.contactName || "（未填写）"}</td>
          </tr>
          <tr>
            <th scope="row">联系电话</th>
            <td>{fields.contactPhone || "（未填写）"}</td>
          </tr>
          <tr>
            <th scope="row">事项类型</th>
            <td>
              {fields.matterType
                ? MATTER_TYPE_LABELS[
                    fields.matterType as keyof typeof MATTER_TYPE_LABELS
                  ]
                : "（未填写）"}
            </td>
          </tr>
          <tr>
            <th scope="row">经济状况情形</th>
            <td>
              {EXEMPTION_LABELS[fields.exemptionReason as ExemptionReason] ??
                "（未填写）"}
            </td>
          </tr>
          <tr>
            <th scope="row">经济困难证明</th>
            <td>{economicProofExempt ? "免交（符合免交情形）" : "需提交"}</td>
          </tr>
          <tr>
            <th scope="row">已登记材料</th>
            <td>
              {materials.length
                ? materials
                    .map(
                      (m) =>
                        `${MATERIAL_KIND_LABELS[m.kind as MaterialKind]}：${m.label}`,
                    )
                    .join("；")
                : "（无）"}
            </td>
          </tr>
          <tr>
            <th scope="row">合理便利</th>
            <td>
              {fields.accommodations.length
                ? fields.accommodations
                    .map((a) => ACCOMMODATION_LABELS[a as Accommodation])
                    .join("、")
                : "无"}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="hint">提交后如需修改，需等待工作人员退回补正。</p>
    </div>
  );
}

function MaterialsStep({
  materials,
  economicProofExempt,
  exemptionReason,
  errors,
  onAdd,
  onRemove,
  onReplace,
}: {
  materials: ApplicantView["materials"];
  economicProofExempt: boolean;
  exemptionReason: ExemptionReason;
  errors: Record<string, string>;
  onAdd: (
    kind: MaterialKind,
    label: string,
    meta: Record<string, unknown>,
  ) => Promise<void>;
  onRemove: (id: string, label: string) => Promise<void>;
  onReplace: (
    id: string,
    label: string,
    meta: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [kind, setKind] = useState<MaterialKind>("IDENTITY");
  const [label, setLabel] = useState("");
  const [meta, setMeta] = useState<Record<string, unknown>>({});

  return (
    <div>
      {economicProofExempt ? (
        <p className="notice" role="note" data-testid="exempt-notice">
          您选择的情形（{EXEMPTION_LABELS[exemptionReason]}
          ）免交经济困难证明；身份证明等其他必要材料仍需提交。
        </p>
      ) : (
        <p
          className="notice warn"
          role="note"
          data-testid="economic-proof-required"
        >
          当前情形需提交经济困难证明；如无固定收入，请返回上一步选择对应免交情形。
        </p>
      )}

      {errors.identity ? (
        <p className="error" id="identity-error" role="alert">
          {errors.identity}
        </p>
      ) : null}
      {errors.economicProof ? (
        <p className="error" id="economicProof-error" role="alert">
          {errors.economicProof}
        </p>
      ) : null}

      <ul className="materials-list" aria-label="已登记材料">
        {materials.map((m) => (
          <li key={m.id} data-material-kind={m.kind} data-material-id={m.id}>
            <span>
              <strong>{MATERIAL_KIND_LABELS[m.kind as MaterialKind]}</strong>：
              {m.label}
              {typeof m.metadata.fileName === "string"
                ? `（${m.metadata.fileName}）`
                : ""}
            </span>
            <span className="btn-row" style={{ margin: 0 }}>
              <label
                className="btn secondary"
                style={{ cursor: "pointer" }}
                htmlFor={`replace-${m.id}`}
              >
                替换文件
              </label>
              <input
                id={`replace-${m.id}`}
                type="file"
                className="sr-only"
                aria-label={`替换材料 ${m.label} 的文件`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void onReplace(m.id, m.label, {
                      fileName: f.name,
                      size: f.size,
                      mimeType: f.type || "application/octet-stream",
                      uploadedAt: new Date().toISOString(),
                    });
                    e.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                className="btn danger"
                aria-label={`删除材料 ${m.label}`}
                onClick={() => void onRemove(m.id, m.label)}
              >
                删除
              </button>
            </span>
          </li>
        ))}
        {materials.length === 0 ? <li>尚未登记材料</li> : null}
      </ul>

      <Fieldset id="materials" legend="登记新材料（仅记录材料元数据）">
        <div className="field">
          <label htmlFor="material-kind">材料种类</label>
          <select
            id="material-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as MaterialKind)}
          >
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {MATERIAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="material-label">材料名称</label>
          <input
            id="material-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="material-file">
            选择文件（只读取文件名、大小、类型等元数据）
          </label>
          <input
            id="material-file"
            type="file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setMeta({
                  fileName: f.name,
                  size: f.size,
                  mimeType: f.type || "application/octet-stream",
                  uploadedAt: new Date().toISOString(),
                });
                if (!label) setLabel(f.name);
              }
            }}
          />
        </div>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            if (!label.trim()) return;
            void onAdd(kind, label.trim(), meta);
            setLabel("");
            setMeta({});
          }}
        >
          添加材料
        </button>
      </Fieldset>
    </div>
  );
}
