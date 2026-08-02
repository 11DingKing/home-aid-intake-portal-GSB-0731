"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge, LiveRegion } from "@/components/FormFields";
import { CORRECTION_REASON_CODES } from "@/domain/types";

interface Correction {
  id: number;
  fields: string[];
  reasonCode: string;
  resolved: boolean;
  createdAt: string;
}

interface ApplicationDetail {
  id: string;
  state: string;
  exemptionReason: string;
  fullName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  caseDescription: string | null;
  legalIssueType: string | null;
  accommodations: string[];
  economicProofMeta: { fileName: string; materialId: string } | null;
  idDocumentMeta: { fileName: string; materialId: string } | null;
  otherMaterialMeta: { fileName: string; materialId: string } | null;
  version: number;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: "姓名",
  contactPhone: "联系电话",
  contactEmail: "电子邮箱",
  caseDescription: "案件描述",
  legalIssueType: "案件类型",
  economicProofMeta: "经济困难证明",
  idDocumentMeta: "身份证明",
  otherMaterialMeta: "其他材料",
  accommodations: "合理便利",
  exemptionReason: "豁免原因",
};

const ALL_CORRECTABLE_FIELDS = [
  "fullName",
  "contactPhone",
  "contactEmail",
  "caseDescription",
  "legalIssueType",
  "economicProofMeta",
  "idDocumentMeta",
  "otherMaterialMeta",
];

export default function StaffDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [reasonCode, setReasonCode] = useState<string>("INCOMPLETE_INFORMATION");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [appRes, corrRes] = await Promise.all([
        fetch(`/api/applications/${params.id}`, { cache: "no-store" }),
        fetch(`/api/applications/${params.id}/corrections`, { cache: "no-store" }),
      ]);
      if (appRes.ok) {
        const appJson = await appRes.json();
        setApp(appJson.data);
      }
      if (corrRes.ok) {
        const corrJson = await corrRes.json();
        setCorrections(corrJson.data);
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDecision = async (action: "ACCEPTED" | "DECLINED") => {
    setError("");
    const res = await fetch(`/api/applications/${params.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setAnnouncement(`申请已${action === "ACCEPTED" ? "受理" : "拒绝"}`);
      await loadData();
      router.refresh();
    } else {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "操作失败");
    }
  };

  const handleCorrection = async () => {
    setError("");
    if (selectedFields.length === 0) {
      setError("请至少选择一个需要补正的字段");
      return;
    }
    const res = await fetch(`/api/applications/${params.id}/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: selectedFields, reasonCode }),
    });
    if (res.ok) {
      setAnnouncement("补正请求已发送，申请人将被通知");
      setShowCorrectionForm(false);
      setSelectedFields([]);
      await loadData();
      router.refresh();
    } else {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "操作失败");
    }
  };

  const toggleField = (field: string) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  };

  if (loading) return <main id="main-content" className="container"><p>加载中...</p></main>;
  if (!app) return <main id="main-content" className="container"><p>申请不存在</p></main>;

  const isCorrectionView = app.state === "NEEDS_CORRECTION";
  const activeCorrections = corrections.filter((c) => !c.resolved);
  const canDecide = app.state === "SUBMITTED" || app.state === "RESUBMITTED";
  const canRequestCorrection = canDecide;

  return (
    <main id="main-content" className="container">
      <LiveRegion message={announcement} politeness="assertive" />

      <div className="page-header">
        <h1>申请审核：{app.id}</h1>
        <p>
          <Link href="/staff">← 返回工作台</Link>
        </p>
      </div>

      <div className="staff-disclosure-note">
        <strong>披露视图：</strong>
        {isCorrectionView
          ? "补正审核视图 — 显示补正相关的完整字段信息"
          : "收件审核视图 — 仅显示审核所需的最少信息（不含申请人联系方式和案件详情）"}
        <br />
        <span>版本号：v{app.version}</span>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ margin: 0 }}>{app.id}</h2>
          </div>
          <StatusBadge state={app.state} />
        </div>
      </div>

      {activeCorrections.length > 0 && (
        <div className="alert alert-warning">
          <strong>待处理补正请求：</strong>
          <ul>
            {activeCorrections.map((c) => (
              <li key={c.id}>
                需补正字段：{c.fields.map((f) => FIELD_LABELS[f] || f).join("、")}
                <br />
                原因代码：{c.reasonCode}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>审核信息</h2>
        <dl>
          <DetailRow label="豁免原因" value={FIELD_LABELS[app.exemptionReason] || app.exemptionReason} />
          <DetailRow
            label="案件类型"
            value={app.legalIssueType ? FIELD_LABELS[app.legalIssueType] || app.legalIssueType : "—"}
          />

          {isCorrectionView && (
            <>
              <DetailRow label="姓名" value={app.fullName || "—"} />
              <DetailRow label="联系电话" value={app.contactPhone || "—"} />
              <DetailRow label="电子邮箱" value={app.contactEmail || "—"} />
              <DetailRow label="案件描述" value={app.caseDescription || "—"} />
            </>
          )}

          <DetailRow
            label="合理便利"
            value={
              app.accommodations.length > 0
                ? app.accommodations.map((a) => FIELD_LABELS[a] || a).join("、")
                : "无"
            }
          />

          <DetailRow
            label="身份证明"
            value={app.idDocumentMeta ? `✓ ${app.idDocumentMeta.fileName}` : "未上传"}
          />
          <DetailRow
            label="经济困难证明"
            value={
              app.exemptionReason === "NO_FIXED_INCOME"
                ? "已豁免（无固定收入）"
                : app.economicProofMeta
                ? `✓ ${app.economicProofMeta.fileName}`
                : "未上传"
            }
          />
          <DetailRow
            label="其他材料"
            value={app.otherMaterialMeta ? `✓ ${app.otherMaterialMeta.fileName}` : "未上传"}
          />
        </dl>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {canDecide && (
        <div className="card">
          <h2>审核决定</h2>
          <p>请仔细核对材料后作出决定。</p>
          <div className="button-row">
            {canRequestCorrection && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCorrectionForm(!showCorrectionForm)}
                name="requestCorrection"
              >
                {showCorrectionForm ? "取消" : "要求补正"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleDecision("ACCEPTED")}
              name="acceptApplication"
            >
              ✓ 受理
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => handleDecision("DECLINED")}
              name="declineApplication"
            >
              ✗ 拒绝
            </button>
          </div>

          {showCorrectionForm && (
            <div style={{ marginTop: "16px", padding: "16px", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
              <h3>选择需要补正的字段</h3>
              <fieldset>
                <legend>补正字段</legend>
                <div className="checkbox-group">
                  {ALL_CORRECTABLE_FIELDS.map((field) => (
                    <div className="checkbox-item" key={field}>
                      <input
                        type="checkbox"
                        id={`corr-${field}`}
                        checked={selectedFields.includes(field)}
                        onChange={() => toggleField(field)}
                      />
                      <label htmlFor={`corr-${field}`}>{FIELD_LABELS[field]}</label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="form-group">
                <label htmlFor="reasonCode">补正原因</label>
                <select
                  id="reasonCode"
                  name="reasonCode"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                >
                  {CORRECTION_REASON_CODES.map((code) => (
                    <option key={code} value={code}>
                      {{
                        ECONOMIC_PROOF_REQUIRED: "需要经济困难证明",
                        ID_DOCUMENT_REQUIRED: "需要身份证明",
                        INCOMPLETE_INFORMATION: "信息不完整",
                        CLARIFICATION_NEEDED: "需要补充说明",
                      }[code] || code}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-primary" onClick={handleCorrection}>
                发送补正请求
              </button>
            </div>
          )}
        </div>
      )}

      {corrections.length > 0 && (
        <div className="card">
          <h2>补正历史</h2>
          <ul>
            {corrections.map((c) => (
              <li key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--color-border)" }}>
                <strong>{c.resolved ? "✓ 已解决" : "⏳ 待处理"}</strong>
                <br />
                字段：{c.fields.map((f) => FIELD_LABELS[f] || f).join("、")}
                <br />
                原因：{c.reasonCode}
                <br />
                <small>{new Date(c.createdAt).toLocaleString("zh-CN")}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "8px", padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
      <dt style={{ fontWeight: 600, minWidth: "120px", flexShrink: 0 }}>{label}：</dt>
      <dd style={{ margin: 0, wordBreak: "break-word" }}>{value}</dd>
    </div>
  );
}
