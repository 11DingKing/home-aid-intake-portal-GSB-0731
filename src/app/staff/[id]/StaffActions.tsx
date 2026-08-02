"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAnnouncer } from "@/components/Announcer";
import { STATE_LABELS, type AppState } from "@/lib/constants";
import type { StaffView } from "@/lib/disclosure";

const CORRECTION_FIELD_OPTIONS = [
  { value: "economicProof", label: "经济困难证明" },
  { value: "identity", label: "身份证明" },
  { value: "contactPhone", label: "联系电话" },
  { value: "address", label: "联系地址" },
  { value: "matterDescription", label: "案情简述" },
];

export function StaffActions({
  id,
  state,
  view,
  actionable,
}: {
  id: string;
  state: AppState;
  view: StaffView;
  actionable: boolean;
}) {
  const router = useRouter();
  const { announce } = useAnnouncer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<string[]>(["economicProof"]);
  const [reasonCode, setReasonCode] = useState("ECONOMIC_PROOF_REQUIRED");
  const [note, setNote] = useState("");

  async function act(action: "REQUEST_CORRECTION" | "ACCEPT" | "DECLINE") {
    setBusy(true);
    setMessage("");
    try {
      const payload: Record<string, unknown> =
        action === "REQUEST_CORRECTION" ? { action, fields, reasonCode, note } : { action, note };
      const res = await fetch(`/api/staff/applications/${id}/transition?view=${view}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { state?: AppState; error?: { message: string } };
      if (res.ok && body.state) {
        const msg = `操作成功，申请 ${id} 已流转为：${STATE_LABELS[body.state]}`;
        setMessage(msg);
        announce(msg);
        router.refresh();
      } else {
        const msg = body.error?.message ?? "操作失败";
        setMessage(msg);
        announce(msg);
      }
    } catch {
      setMessage("网络异常，操作未完成");
    } finally {
      setBusy(false);
    }
  }

  if (!actionable) {
    return (
      <section className="card" aria-labelledby="actions-heading">
        <h2 id="actions-heading">状态操作</h2>
        <p role="status" data-testid="no-action">
          当前状态为「{STATE_LABELS[state]}」，无可用的接续操作。
        </p>
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="actions-heading">
      <h2 id="actions-heading">状态操作</h2>

      <fieldset className="field">
        <legend>请求补正</legend>
        <ul className="check-list">
          {CORRECTION_FIELD_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <label htmlFor={`corr-${opt.value}`}>
                <input
                  id={`corr-${opt.value}`}
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
        <div className="field">
          <label htmlFor="reason-code">补正原因代码</label>
          <input
            id="reason-code"
            type="text"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="staff-note">备注（申请人与本环节工作人员可见）</label>
          <input id="staff-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || fields.length === 0}
          onClick={() => void act("REQUEST_CORRECTION")}
        >
          退回补正
        </button>
      </fieldset>

      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={() => void act("ACCEPT")}>
          受理
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => void act("DECLINE")}
        >
          不予受理
        </button>
      </div>

      {message ? (
        <p className="notice" role="status" data-testid="action-result">
          {message}
        </p>
      ) : null}
    </section>
  );
}
