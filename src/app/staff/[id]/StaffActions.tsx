"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  APPLICANT_FIELD_KEYS,
  CORRECTION_REASON_CODES,
  type ApplicationState,
} from "@/domain/constants";
import { allowedActions, type ApplicationAction } from "@/domain/stateMachine";
import type { ApiError } from "@/lib/types";

// Staff continuation actions. Only actions valid for the current state are
// rendered (state machine is the source of truth). Correction requests capture
// the specific fields the applicant must fix.
export default function StaffActions({
  id,
  state,
  version,
}: {
  id: string;
  state: ApplicationState;
  version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionFields, setCorrectionFields] = useState<string[]>([]);
  const [reasonCode, setReasonCode] = useState<string>(CORRECTION_REASON_CODES[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const actions = allowedActions(state);
  const can = (a: ApplicationAction) => actions.includes(a);

  async function post(url: string, body: unknown, successMsg: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json()) as ApiError;
        setError(b.error?.message ?? "Action failed.");
        setAnnounce(`Action failed: ${b.error?.message ?? "server error"}`);
        return;
      }
      setAnnounce(successMsg);
      router.refresh();
    } catch {
      setError("Network error.");
      setAnnounce("Network error while performing the action.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "accept" | "decline") {
    await post(
      `/api/staff/applications/${id}/decision`,
      { action },
      action === "accept" ? "Application accepted." : "Application declined.",
    );
  }

  async function submitCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (correctionFields.length === 0) {
      setError("Select at least one field to correct.");
      return;
    }
    await post(
      `/api/staff/applications/${id}/request-correction`,
      { fields: correctionFields, reasonCode, note: note || undefined },
      "Correction requested. The applicant can now resubmit.",
    );
    setShowCorrection(false);
    setCorrectionFields([]);
    setNote("");
  }

  if (actions.length === 0) {
    return (
      <div className="card">
        <h2>Actions</h2>
        <div className="banner" data-tone="info" role="status">
          <span className="banner-title">No actions: </span>
          This application is in a terminal state ({state}) and requires no further action.
        </div>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Actions</h2>
      <p className="hint">Version {version}. Only actions valid for the current state are shown.</p>
      <div aria-live="polite" className="sr-only" data-testid="staff-live">
        {announce}
      </div>
      {error ? (
        <div className="banner" data-tone="error" role="alert">
          <span className="banner-title">Error: </span>
          {error}
        </div>
      ) : null}

      <div className="button-row">
        {can("accept") ? (
          <button type="button" onClick={() => decide("accept")} disabled={busy} data-testid="accept">
            Accept
          </button>
        ) : null}
        {can("decline") ? (
          <button type="button" className="secondary" onClick={() => decide("decline")} disabled={busy} data-testid="decline">
            Decline
          </button>
        ) : null}
        {can("requestCorrection") ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setShowCorrection((s) => !s)}
            aria-expanded={showCorrection}
            aria-controls="correction-form"
            data-testid="toggle-correction"
          >
            {showCorrection ? "Cancel correction" : "Request correction"}
          </button>
        ) : null}
      </div>

      {showCorrection && can("requestCorrection") ? (
        <form id="correction-form" onSubmit={submitCorrection} style={{ marginTop: "1rem" }}>
          <fieldset>
            <legend className="fieldset-legend">Fields the applicant must correct</legend>
            {APPLICANT_FIELD_KEYS.map((key) => (
              <div className="checkbox-row" key={key}>
                <input
                  type="checkbox"
                  id={`corr-${key}`}
                  name="correctionFields"
                  value={key}
                  checked={correctionFields.includes(key)}
                  onChange={(e) => {
                    setCorrectionFields((prev) =>
                      e.target.checked ? [...prev, key] : prev.filter((k) => k !== key),
                    );
                  }}
                />
                <label htmlFor={`corr-${key}`}>{key}</label>
              </div>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="reasonCode">Reason code</label>
            <select
              id="reasonCode"
              name="reasonCode"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {CORRECTION_REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="correction-note">Note to applicant (optional)</label>
            <textarea
              id="correction-note"
              name="note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} data-testid="submit-correction">
            Send correction request
          </button>
        </form>
      ) : null}
    </div>
  );
}
