"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAnnouncer } from "@/components/Announcer";
import { FIELD_LABELS } from "@/lib/constants";

const CORRECTION_FIELD_OPTIONS = [
  { value: "economicProof", label: "经济困难证明" },
  { value: "identity", label: "身份证明" },
  { value: "contactPhone", label: "联系电话" },
  { value: "address", label: "联系地址" },
  { value: "matterDescription", label: "案情简述" },
];

interface ConflictInfo {
  field: string;
  serverValue: unknown;
  clientValue: unknown;
}

interface CorrectionData {
  fields: string[];
  reasonCode: string;
  note: string;
}

/**
 * 工作人员补正编辑器：携带 baseVersion 参与与申请人草稿共用的
 * 字段级三方合并；冲突字段（如另一工作人员会话改过同一 reason code）
 * 由服务端返回并回显为服务端版本。
 */
export function StaffCorrectionEditor({
  id,
  initialVersion,
  initial,
}: {
  id: string;
  initialVersion: number;
  initial: CorrectionData;
}) {
  const router = useRouter();
  const { announce } = useAnnouncer();
  const [version, setVersion] = useState(initialVersion);
  const [fields, setFields] = useState<string[]>(initial.fields);
  const [reasonCode, setReasonCode] = useState(initial.reasonCode);
  const [note, setNote] = useState(initial.note);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/staff/applications/${id}/correction`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseVersion: version, fields, reasonCode, note }),
      });
      const body = (await res.json()) as {
        version?: number;
        correction?: CorrectionData;
        conflicts?: ConflictInfo[];
        error?: { message: string };
      };
      if (res.ok && body.correction && body.version !== undefined) {
        setVersion(body.version);
        if (body.conflicts && body.conflicts.length > 0) {
          // 冲突字段以服务端版本为准，回显到表单
          setConflicts(body.conflicts);
          setFields(body.correction.fields);
          setReasonCode(body.correction.reasonCode);
          setNote(body.correction.note);
          const names = body.conflicts
            .map((c) => FIELD_LABELS[c.field] ?? c.field)
            .join("、");
          setMessage(`以下补正内容与其他工作人员会话冲突，已保留服务器版本：${names}`);
          announce(`补正保存发生冲突，已保留服务器版本：${names}`);
        } else {
          setConflicts([]);
          setMessage("补正要求已保存");
          announce("补正要求已保存");
        }
        router.refresh();
      } else {
        setMessage(body.error?.message ?? "保存失败");
      }
    } catch {
      setMessage("网络异常，保存未完成");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="correction-editor-heading">
      <h2 id="correction-editor-heading">编辑补正要求</h2>
      <p className="hint">
        与申请人草稿共用乐观版本（当前 v{version}）：申请人补材料与您写补正可并发合并；
        若其他工作人员同时修改了同一条补正，冲突字段将保留服务器版本。
      </p>

      {conflicts.length > 0 ? (
        <div className="notice warn" role="alert" data-testid="staff-conflict-notice">
          冲突字段（已回显为服务器版本）：
          <ul>
            {conflicts.map((c) => (
              <li key={c.field} data-conflict-field={c.field}>
                {FIELD_LABELS[c.field] ?? c.field}：服务器值「{String(c.serverValue)}」，
                您的修改「{String(c.clientValue)}」未生效
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset className="field">
        <legend>需要补正的内容</legend>
        <ul className="check-list">
          {CORRECTION_FIELD_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <label htmlFor={`edit-corr-${opt.value}`}>
                <input
                  id={`edit-corr-${opt.value}`}
                  type="checkbox"
                  checked={fields.includes(opt.value)}
                  onChange={(e) =>
                    setFields((prev) =>
                      e.target.checked
                        ? [...prev, opt.value]
                        : prev.filter((f) => f !== opt.value),
                    )
                  }
                />
                {opt.label}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className="field">
        <label htmlFor="edit-reason-code">补正原因代码</label>
        <input
          id="edit-reason-code"
          type="text"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="edit-note">补正备注</label>
        <input id="edit-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button
        type="button"
        className="btn"
        disabled={busy || fields.length === 0 || !reasonCode.trim()}
        onClick={() => void save()}
      >
        保存补正要求
      </button>
      {message ? (
        <p className="notice" role="status" data-testid="correction-save-result">
          {message}
        </p>
      ) : null}
    </section>
  );
}
