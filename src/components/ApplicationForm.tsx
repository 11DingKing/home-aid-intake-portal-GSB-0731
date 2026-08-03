"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDraft, fromApplicationData } from "@/hooks/useDraft";
import {
  TextField,
  TextArea,
  SelectField,
  CheckboxGroup,
  RadioGroup,
  MaterialUpload,
  LiveRegion,
  StatusBadge,
} from "@/components/FormFields";
import type { MaterialMeta } from "@/components/FormFields";
import {
  FORM_STEPS,
  LEGAL_ISSUE_TYPES,
  EXEMPTION_REASONS,
  ACCOMMODATIONS,
  type FormStepId,
  type LegalIssueType,
  type ExemptionReason,
  type Accommodation,
} from "@/domain/types";
import { validateStepFields, isEconomicProofRequired } from "@/domain/validation";

const LEGAL_OPTIONS = LEGAL_ISSUE_TYPES.map((v) => ({
  value: v,
  label: {
    FAMILY_LAW: "婚姻家事",
    HOUSING: "住房纠纷",
    EMPLOYMENT: "劳动争议",
    IMMIGRATION: "移民事务",
    CRIMINAL_DEFENSE: "刑事辩护",
    CONSUMER_RIGHTS: "消费者权益",
    PUBLIC_BENEFITS: "公共福利",
    OTHER: "其他",
  }[v] || v,
}));

const EXEMPTION_OPTIONS = EXEMPTION_REASONS.map((v) => ({
  value: v,
  label: {
    NO_FIXED_INCOME: "无固定收入（豁免经济困难证明）",
    NOTIFIED_CRIMINAL_DEFENSE: "已获通知的刑事辩护",
    NONE: "不适用豁免",
  }[v] || v,
}));

const ACCOMMODATION_OPTIONS = ACCOMMODATIONS.map((v) => ({
  value: v,
  label: {
    HOME_VISIT_NEEDED: "需要上门访问",
    SIGN_INTERPRETER: "需要手语翻译",
    TEXT_ONLY: "仅需文字沟通",
    BRAILLE_MATERIAL: "需要盲文材料",
  }[v] || v,
}));

interface ApplicationFormProps {
  applicationId: string;
}

export function ApplicationForm({ applicationId }: ApplicationFormProps) {
  const {
    draft,
    setField,
    saveDraft,
    submitApplication,
    isOnline,
    isSaving,
    saveMessage,
    conflictMessage,
    conflictFields,
    loadApplication,
  } = useDraft(applicationId);

  const [currentStep, setCurrentStep] = useState<number>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitErrors, setSubmitErrors] = useState<{ field: string; message: string }[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [stepAnnouncement, setStepAnnouncement] = useState("");
  const stepRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void loadApplication(applicationId);
  }, [applicationId, loadApplication]);

  useEffect(() => {
    if (draft.state === "SUBMITTED" || draft.state === "RESUBMITTED" || draft.state === "ACCEPTED" || draft.state === "DECLINED") {
      setIsSubmitted(true);
    }
  }, [draft.state]);

  const focusFirstFieldOrError = useCallback((stepErrors: Record<string, string>) => {
    setTimeout(() => {
      const errorFields = Object.keys(stepErrors);
      if (errorFields.length > 0) {
        const el = document.getElementById(errorFields[0]);
        el?.focus();
      } else {
        const panel = document.getElementById("form-panel");
        const firstInput = panel?.querySelector<HTMLElement>(
          "input:not([type=hidden]), select, textarea, button:not([type=button])"
        );
        firstInput?.focus();
      }
    }, 50);
  }, []);

  const goToStep = useCallback((stepIndex: number) => {
    setErrors({});
    setSubmitErrors([]);
    setCurrentStep(stepIndex);
    const step = FORM_STEPS[stepIndex];
    setStepAnnouncement(`当前步骤：${stepIndex + 1} / ${FORM_STEPS.length}，${step.title}`);
    focusFirstFieldOrError({});
  }, [focusFirstFieldOrError]);

  const validateCurrentStep = useCallback((): boolean => {
    const step = FORM_STEPS[currentStep];
    if (!step) return true;

    const data: Record<string, unknown> = {
      fullName: draft.fullName,
      contactPhone: draft.contactPhone,
      contactEmail: draft.contactEmail,
      caseDescription: draft.caseDescription,
      legalIssueType: draft.legalIssueType,
      exemptionReason: draft.exemptionReason,
      economicProofMeta: draft.economicProofMeta,
      idDocumentMeta: draft.idDocumentMeta,
      otherMaterialMeta: draft.otherMaterialMeta,
    };

    const stepErrors = validateStepFields(step.id, data, draft.exemptionReason);
    const errorMap: Record<string, string> = {};
    for (const e of stepErrors) {
      errorMap[e.field] = e.message;
    }
    setErrors(errorMap);

    if (stepErrors.length > 0) {
      setStepAnnouncement(`表单有 ${stepErrors.length} 个错误需要修正`);
      focusFirstFieldOrError(errorMap);
      return false;
    }
    return true;
  }, [currentStep, draft, focusFirstFieldOrError]);

  const handleNext = useCallback(async () => {
    if (!validateCurrentStep()) return;
    await saveDraft(true);
    if (currentStep < FORM_STEPS.length - 1) {
      goToStep(currentStep + 1);
    }
  }, [validateCurrentStep, saveDraft, currentStep, goToStep]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }, [currentStep, goToStep]);

  const handleSubmit = useCallback(async () => {
    const result = await submitApplication();
    if (result.success) {
      setIsSubmitted(true);
      setStepAnnouncement("申请已成功提交");
    } else if (result.errors) {
      setSubmitErrors(result.errors);
      const firstField = result.errors[0]?.field;
      if (firstField && firstField !== "form") {
        const stepIndex = FORM_STEPS.findIndex((s) => s.fields.includes(firstField as never));
        if (stepIndex >= 0) {
          goToStep(stepIndex);
          setTimeout(() => {
            const el = document.getElementById(firstField);
            el?.focus();
          }, 100);
        }
      }
      setStepAnnouncement(`提交失败，有 ${result.errors.length} 个问题需要处理`);
    }
  }, [submitApplication, goToStep]);

  const setAccommodations = useCallback(
    (vals: Accommodation[]) => {
      setField("accommodations", vals);
    },
    [setField]
  );

  if (isSubmitted) {
    return (
      <div className="card">
        <StatusBadge state={draft.state} />
        <h2>申请编号：{draft.id}</h2>
        <p>
          {draft.state === "ACCEPTED"
            ? "您的法援申请已被受理。工作人员将尽快与您联系。"
            : draft.state === "DECLINED"
            ? "您的申请未能通过初审。如有疑问请联系法援中心。"
            : "您的申请已提交。工作人员审核后将通过您提供的联系方式与您联系。"}
        </p>
        {draft.accommodations.length > 0 && (
          <div className="alert alert-info">
            <strong>已记录的合理便利需求：</strong>
            <ul>
              {draft.accommodations.map((a) => (
                <li key={a}>
                  {ACCOMMODATION_OPTIONS.find((o) => o.value === a)?.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p>
          <a href={`/apply/${draft.id}`}>返回查看申请</a>
        </p>
      </div>
    );
  }

  const step = FORM_STEPS[currentStep];

  return (
    <div>
      {!isOnline && (
        <div className="offline-banner" role="status">
          <span aria-hidden="true">📡</span> 当前处于离线状态，草稿已保存在本地，联网后将自动同步。
        </div>
      )}

      <LiveRegion message={stepAnnouncement} politeness="assertive" />
      <LiveRegion message={saveMessage} politeness="polite" />
      {conflictMessage && <LiveRegion message={conflictMessage} politeness="assertive" />}

      {conflictMessage && (
        <div className="alert alert-warning" role="alert">
          <span aria-hidden="true">⚠️</span> {conflictMessage}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <strong>申请编号：</strong>
            <span id="application-id">{draft.id}</span>
          </div>
          <StatusBadge state={draft.state} />
        </div>
        {draft.state === "NEEDS_CORRECTION" && (
          <div className="alert alert-warning" style={{ marginTop: "12px" }} role="alert">
            <strong>工作人员要求您补正材料。</strong>
            {draft.activeCorrections.length > 0 && (
              <ul style={{ marginTop: "8px", marginBottom: 0 }}>
                {draft.activeCorrections.map((c, i) => (
                  <li key={i}>
                    需补正字段：{c.fields.join("、")}（原因：{c.reasonCode}）
                  </li>
                ))}
              </ul>
            )}
            <p style={{ marginBottom: 0, marginTop: "8px" }}>请检查各步骤后重新提交。</p>
          </div>
        )}
        {conflictFields.length > 0 && (
          <div className="alert alert-info" style={{ marginTop: "12px" }} role="status">
            <strong>冲突字段：</strong>
            {conflictFields.map((f) => (
              <span
                key={f}
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  margin: "2px",
                  background: "var(--color-bg)",
                  borderRadius: "3px",
                  fontSize: "0.8125rem",
                }}
              >
                {f}
              </span>
            ))}
          </div>
        )}
        {saveMessage && (
          <div style={{ marginTop: "8px", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
            {isSaving ? "保存中..." : saveMessage}
          </div>
        )}
      </div>

      <nav aria-label="申请表单步骤">
        <ol className="step-indicator">
          {FORM_STEPS.map((s, i) => {
            const isComplete = i < currentStep;
            const isCurrent = i === currentStep;
            return (
              <li
                key={s.id}
                className={isCurrent ? "current" : isComplete ? "complete" : ""}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className="step-num" aria-hidden="true">
                  {isComplete ? "✓" : i + 1}
                </span>
                <span>{s.title}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      <div
        id="form-panel"
        className="card"
        ref={stepRef}
        role="region"
        aria-label={`${step.title} - 第 ${currentStep + 1} 步，共 ${FORM_STEPS.length} 步`}
      >
        <h2 id="step-heading" tabIndex={-1}>
          {step.title}
        </h2>

        {step.id === "personal" && (
          <>
            <TextField
              id="fullName"
              name="fullName"
              label="姓名"
              value={draft.fullName}
              onChange={(v) => setField("fullName", v)}
              required
              error={errors.fullName}
              autoComplete="name"
            />
            <TextField
              id="contactPhone"
              name="contactPhone"
              label="联系电话"
              value={draft.contactPhone}
              onChange={(v) => setField("contactPhone", v)}
              type="tel"
              required
              error={errors.contactPhone}
              autoComplete="tel"
            />
            <TextField
              id="contactEmail"
              name="contactEmail"
              label="电子邮箱（选填）"
              value={draft.contactEmail}
              onChange={(v) => setField("contactEmail", v)}
              type="email"
              hint="用于接收申请进度通知"
              error={errors.contactEmail}
              autoComplete="email"
            />
          </>
        )}

        {step.id === "case" && (
          <>
            <SelectField<LegalIssueType>
              id="legalIssueType"
              name="legalIssueType"
              label="案件类型"
              value={draft.legalIssueType}
              onChange={(v) => setField("legalIssueType", v)}
              options={LEGAL_OPTIONS}
              required
              error={errors.legalIssueType}
            />
            <TextArea
              id="caseDescription"
              name="caseDescription"
              label="案件情况简述"
              value={draft.caseDescription}
              onChange={(v) => setField("caseDescription", v)}
              required
              hint="请简要描述您遇到的法律问题（至少10个字）"
              error={errors.caseDescription}
            />
          </>
        )}

        {step.id === "eligibility" && (
          <RadioGroup<ExemptionReason>
            id="exemptionReason"
            name="exemptionReason"
            legend="豁免原因"
            value={draft.exemptionReason}
            onChange={(v) => setField("exemptionReason", v)}
            options={EXEMPTION_OPTIONS}
            required
            error={errors.exemptionReason}
            hint={'选择"无固定收入"后无需上传经济困难证明，但身份证明等其他材料仍需提供。'}
          />
        )}

        {step.id === "accommodations" && (
          <CheckboxGroup<Accommodation>
            id="accommodations"
            name="accommodations"
            legend="合理便利需求"
            value={draft.accommodations}
            onChange={setAccommodations}
            options={ACCOMMODATION_OPTIONS}
            hint="如果您有行动不便或沟通障碍，请选择需要的便利安排。这些信息将被安全保存，不会因草稿覆盖而丢失。"
            error={errors.accommodations}
          />
        )}

        {step.id === "materials" && (
          <>
            <MaterialUpload
              id="idDocumentMeta"
              name="idDocumentMeta"
              label="身份证明材料"
              value={draft.idDocumentMeta as MaterialMeta | null}
              onChange={(v) => setField("idDocumentMeta", v)}
              required
              error={errors.idDocumentMeta}
              hint="身份证、护照或其他政府签发的身份证件"
            />
            <MaterialUpload
              id="economicProofMeta"
              name="economicProofMeta"
              label="经济困难证明"
              value={draft.economicProofMeta as MaterialMeta | null}
              onChange={(v) => setField("economicProofMeta", v)}
              required={isEconomicProofRequired(draft.exemptionReason)}
              error={errors.economicProofMeta}
              disabled={!isEconomicProofRequired(draft.exemptionReason)}
              hint={
                isEconomicProofRequired(draft.exemptionReason)
                  ? "低收入证明、低保领取证明或其他经济困难证明"
                  : '您选择了"无固定收入"豁免，无需上传此材料'
              }
            />
            <MaterialUpload
              id="otherMaterialMeta"
              name="otherMaterialMeta"
              label="其他相关材料"
              value={draft.otherMaterialMeta as MaterialMeta | null}
              onChange={(v) => setField("otherMaterialMeta", v)}
              required
              error={errors.otherMaterialMeta}
              hint="与案件相关的合同、通知书、判决书等"
            />
          </>
        )}

        {step.id === "review" && (
          <div>
            <h3>请确认以下信息</h3>
            <dl>
              <ReviewItem label="姓名" value={draft.fullName || "—"} />
              <ReviewItem label="联系电话" value={draft.contactPhone || "—"} />
              <ReviewItem label="电子邮箱" value={draft.contactEmail || "—"} />
              <ReviewItem
                label="案件类型"
                value={LEGAL_OPTIONS.find((o) => o.value === draft.legalIssueType)?.label || "—"}
              />
              <ReviewItem label="案件简述" value={draft.caseDescription || "—"} />
              <ReviewItem
                label="豁免原因"
                value={EXEMPTION_OPTIONS.find((o) => o.value === draft.exemptionReason)?.label || "—"}
              />
              <ReviewItem
                label="合理便利"
                value={
                  draft.accommodations.length > 0
                    ? draft.accommodations
                        .map((a) => ACCOMMODATION_OPTIONS.find((o) => o.value === a)?.label)
                        .join("、")
                    : "无"
                }
              />
              <ReviewItem
                label="身份证明"
                value={draft.idDocumentMeta ? draft.idDocumentMeta.fileName : "未上传"}
              />
              <ReviewItem
                label="经济困难证明"
                value={
                  isEconomicProofRequired(draft.exemptionReason)
                    ? draft.economicProofMeta
                      ? draft.economicProofMeta.fileName
                      : "未上传"
                    : "已豁免"
                }
              />
              <ReviewItem
                label="其他材料"
                value={draft.otherMaterialMeta ? draft.otherMaterialMeta.fileName : "未上传"}
              />
            </dl>
            {submitErrors.length > 0 && (
              <div className="alert alert-error" role="alert">
                <strong>提交失败：</strong>
                <ul>
                  {submitErrors.map((e, i) => (
                    <li key={i}>
                      {e.field !== "form" && <strong>{e.field}: </strong>}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="button-row">
          {currentStep > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePrev}
              name="prevStep"
            >
              ← 上一步
            </button>
          )}
          {currentStep < FORM_STEPS.length - 1 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleNext}
              name="nextStep"
            >
              下一步 →
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              name="submitApplication"
              disabled={isSaving}
            >
              {isSaving ? "提交中..." : "确认提交"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => saveDraft(true)}
            name="saveDraft"
            disabled={isSaving}
          >
            {isSaving ? "保存中..." : "保存草稿"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "8px", padding: "4px 0", borderBottom: "1px solid var(--color-border)" }}>
      <dt style={{ fontWeight: 600, minWidth: "120px", flexShrink: 0 }}>{label}：</dt>
      <dd style={{ margin: 0, wordBreak: "break-word" }}>{value}</dd>
    </div>
  );
}
