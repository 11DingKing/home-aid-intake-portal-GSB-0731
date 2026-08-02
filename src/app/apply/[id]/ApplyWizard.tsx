"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationView } from "@/server/applicationService";
import type {
  ApplicationDTO,
  ApiError,
  DraftPatchResponse,
  FieldMergeSummary,
  SubmitResponse,
} from "@/lib/types";
import {
  ACCOMMODATIONS,
  EXEMPTION_REASONS,
  type Accommodation,
  type ApplicantFieldKey,
  type ExemptionReason,
} from "@/domain/constants";
import { economicProofRequired } from "@/domain/materialRules";
import { validateForSubmission, type FieldError } from "@/domain/validation";
import type { StoredValue } from "@/domain/merge";
import {
  loadDraft,
  saveDraft,
  clearDraft,
  type CachedDraft,
} from "@/lib/draftStore";
import StatusBadge from "@/components/StatusBadge";

// ---------------------------------------------------------------------------
// Local form model
// ---------------------------------------------------------------------------

type FormValues = {
  fullName: string;
  contactPhone: string;
  contactEmail: string;
  exemptionReason: string;
  economicProof: string;
  identityProof: string;
  accommodations: Accommodation[];
  accommodationNote: string;
};

const STEPS = [
  { id: "contact", label: "Your details" },
  { id: "eligibility", label: "Eligibility" },
  { id: "materials", label: "Documents" },
  { id: "accommodations", label: "Accommodations" },
  { id: "review", label: "Review & submit" },
] as const;

// Which step each field lives on, so error links / conflict links can switch to
// the right step before moving focus.
const FIELD_STEP: Record<string, number> = {
  fullName: 0,
  contactPhone: 0,
  contactEmail: 0,
  exemptionReason: 1,
  identityProof: 2,
  economicProof: 2,
  accommodations: 3,
  accommodationNote: 3,
};

const REASON_LABELS: Record<ExemptionReason, string> = {
  NO_FIXED_INCOME: "No fixed income",
  NOTIFIED_CRIMINAL_DEFENSE: "Notified criminal-defense case",
  NONE: "None of these (standard means test)",
};

const ACCOMMODATION_LABELS: Record<Accommodation, string> = {
  HOME_VISIT_NEEDED: "Home visit needed",
  SIGN_INTERPRETER: "Sign-language interpreter",
  TEXT_ONLY: "Text-only communication",
  BRAILLE_MATERIAL: "Braille materials",
};

function toFormValues(dto: ApplicationView | ApplicationDTO): FormValues {
  const v = dto.values;
  return {
    fullName: v.fullName ?? "",
    contactPhone: v.contactPhone ?? "",
    contactEmail: v.contactEmail ?? "",
    exemptionReason: v.exemptionReason ?? "",
    economicProof: v.economicProof ?? "",
    identityProof: v.identityProof ?? "",
    accommodations: (v.accommodations ?? []).filter((a): a is Accommodation =>
      (ACCOMMODATIONS as readonly string[]).includes(a),
    ),
    accommodationNote: v.accommodationNote ?? "",
  };
}

function fieldToStoredValue(key: ApplicantFieldKey, values: FormValues): StoredValue {
  switch (key) {
    case "accommodations":
      return values.accommodations;
    default:
      return values[key];
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApplyWizard({ initial }: { initial: ApplicationView }) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(initial));
  const [serverVersion, setServerVersion] = useState<number>(initial.version);
  const [state, setState] = useState(initial.state);
  const [openCorrection, setOpenCorrection] = useState(initial.openCorrection);
  // Per-field base version = the server version the user is editing from.
  const [fieldBase, setFieldBase] = useState<Record<ApplicantFieldKey, number>>(() => {
    const base = {} as Record<ApplicantFieldKey, number>;
    for (const key of Object.keys(initial.fields) as ApplicantFieldKey[]) {
      base[key] = initial.fields[key].updatedAtVersion;
    }
    return base;
  });
  // Per-field base VALUE = the common ancestor the user started editing from.
  // Sent to the server for three-way merge so a stale edit only conflicts when
  // BOTH the applicant and the server actually changed the same field.
  const [fieldBaseValue, setFieldBaseValue] = useState<Record<string, StoredValue>>(() => {
    const bv: Record<string, StoredValue> = {};
    for (const key of Object.keys(initial.fields) as ApplicantFieldKey[]) {
      bv[key] = initial.fields[key].value;
    }
    return bv;
  });
  // Which fields have local unsaved edits.
  const [dirty, setDirty] = useState<Set<ApplicantFieldKey>>(new Set());
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [conflicts, setConflicts] = useState<FieldMergeSummary[]>([]);
  const [announce, setAnnounce] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [restored, setRestored] = useState(false);
  const [offline, setOffline] = useState(false);

  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});
  // Stable idempotency key per submit attempt so retries/duplicates converge.
  const idempotencyKeyRef = useRef<string | null>(null);

  const id = initial.id;
  const editable = state === "DRAFT" || state === "NEEDS_CORRECTION";

  // ---- Offline draft restore on mount -------------------------------------
  useEffect(() => {
    const cached = loadDraft(id);
    // Do not auto-steal focus on first load: leaving natural document order lets
    // keyboard users reach the skip link first.
    if (!cached) return;
    // Overlay cached pending edits (source: this device) onto server truth.
    setValues((prev) => {
      const next = { ...prev };
      const newBase = { ...fieldBase };
      const newBaseValue = { ...fieldBaseValue };
      const newDirty = new Set<ApplicantFieldKey>();
      for (const [k, cachedField] of Object.entries(cached.fields)) {
        if (!cachedField) continue;
        const key = k as ApplicantFieldKey;
        applyStoredValue(next, key, cachedField.value);
        newBase[key] = cachedField.baseVersion;
        newBaseValue[key] = cachedField.baseValue;
        newDirty.add(key);
      }
      setFieldBase(newBase);
      setFieldBaseValue(newBaseValue);
      setDirty(newDirty);
      return next;
    });
    if (cached.fields && Object.keys(cached.fields).length > 0) {
      setRestored(true);
      setStep(Math.min(cached.step, STEPS.length - 1));
      setAnnounce("Unsaved changes from this device were restored. Review and save when ready.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---- Focus restoration when returning to a restored step ----------------
  useEffect(() => {
    if (restored) {
      // Move focus into the restored step region for keyboard/SR users.
      const region = document.getElementById("step-region");
      region?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored]);

  // ---- Track connectivity for the offline banner --------------------------
  useEffect(() => {
    function update() {
      setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    }
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // ---- Persist to the offline cache on every edit -------------------------
  const persistCache = useCallback(
    (
      nextValues: FormValues,
      nextBase: Record<ApplicantFieldKey, number>,
      nextBaseValue: Record<string, StoredValue>,
      dirtySet: Set<ApplicantFieldKey>,
      stepIdx: number,
    ) => {
      const fields: CachedDraft["fields"] = {};
      for (const key of dirtySet) {
        fields[key] = {
          value: fieldToStoredValue(key, nextValues),
          baseVersion: nextBase[key] ?? 0,
          baseValue: nextBaseValue[key] ?? null,
        };
      }
      saveDraft({
        applicationId: id,
        baseVersion: serverVersion,
        fields,
        step: stepIdx,
        updatedAt: Date.now(),
      });
    },
    [id, serverVersion],
  );

  const setField = useCallback(
    <K extends ApplicantFieldKey>(key: K, value: FormValues[K] | StoredValue) => {
      setValues((prev) => {
        // The value the field held before this edit is its common ancestor the
        // first time it goes dirty (i.e., the last server-synced value).
        const priorStored = fieldToStoredValue(key, prev);
        const next = { ...prev };
        applyStoredValue(next, key, value as StoredValue);
        setDirty((prevDirty) => {
          const nd = new Set(prevDirty);
          nd.add(key);
          setFieldBaseValue((prevBV) => {
            const bv = { ...prevBV };
            // Only stamp the base value the first time this field goes dirty.
            if (!prevDirty.has(key)) bv[key] = priorStored;
            setFieldBase((prevBase) => {
              const base = { ...prevBase };
              if (!prevDirty.has(key)) base[key] = base[key] ?? serverVersion;
              persistCache(next, base, bv, nd, step);
              return base;
            });
            return bv;
          });
          return nd;
        });
        return next;
      });
    },
    [persistCache, serverVersion, step],
  );

  // ---- Save draft to the server (field-level merge) -----------------------
  // Returns the server version after the save (or null if nothing was sent /
  // the save failed) so callers like submit() can chain on the fresh version
  // rather than a stale closure value.
  const saveToServer = useCallback(async (): Promise<number | null> => {
    if (dirty.size === 0) {
      setAnnounce("No changes to save.");
      return null;
    }
    setSaving(true);
    setConflicts([]);
    try {
      const edits = Array.from(dirty).map((key) => ({
        key,
        value: fieldToStoredValue(key, values),
        baseVersion: fieldBase[key] ?? 0,
        // Include the common-ancestor value for true three-way merge.
        baseValue: fieldBaseValue[key] ?? null,
      }));
      const res = await fetch(`/api/applications/${id}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseVersion: serverVersion, edits }),
      });
      if (!res.ok) {
        const body = (await res.json()) as ApiError;
        setAnnounce(`Could not save: ${body.error?.message ?? "server error"}`);
        return null;
      }
      const data = (await res.json()) as DraftPatchResponse;
      // Reconcile local state with server truth (converge by id + version).
      reconcile(data);
      return data.application.version;
    } catch {
      setOffline(true);
      setAnnounce("You appear to be offline. Your changes are saved on this device and will sync when you reconnect.");
      return null;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, values, fieldBase, fieldBaseValue, serverVersion, id]);

  const reconcile = useCallback(
    (data: DraftPatchResponse) => {
      const app = data.application;
      setServerVersion(app.version);
      setState(app.state);
      setOpenCorrection(app.openCorrection);
      // Update base versions and base values to the server's per-field truth so
      // the next edit is compared against the freshly-synced common ancestor.
      setFieldBase(() => {
        const base = {} as Record<ApplicantFieldKey, number>;
        for (const key of Object.keys(app.fields) as ApplicantFieldKey[]) {
          base[key] = app.fields[key].updatedAtVersion;
        }
        return base;
      });
      setFieldBaseValue(() => {
        const bv: Record<string, StoredValue> = {};
        for (const key of Object.keys(app.fields) as ApplicantFieldKey[]) {
          bv[key] = app.fields[key].value;
        }
        return bv;
      });

      const conflictKeys = new Set(data.conflicts.map((c) => c.key));
      // For conflicting fields, adopt the server value so we never silently keep
      // stale local data — the user is shown both and can re-edit.
      setValues((prev) => {
        const next = { ...prev };
        for (const c of data.conflicts) {
          applyStoredValue(next, c.key, c.serverValue);
        }
        return next;
      });
      // Applied + noop fields are now clean; conflicts remain dirty=false but
      // surfaced for the user to reconcile explicitly.
      setDirty((prev) => {
        const nd = new Set<ApplicantFieldKey>();
        for (const key of prev) {
          if (conflictKeys.has(key)) continue; // resolved to server value
          const applied = data.applied.find((a) => a.key === key);
          if (!applied) nd.add(key); // not yet sent / still pending
        }
        return nd;
      });
      setConflicts(data.conflicts);
      clearDraft(id);
      setRestored(false);

      if (data.conflicts.length > 0) {
        const protectedCount = data.conflicts.filter(
          (c) => c.conflictReason === "PROTECTED_ACCOMMODATION",
        ).length;
        const base = `Saved ${data.applied.length} change(s). ${data.conflicts.length} field(s) had conflicting edits and now show the server's value.`;
        setAnnounce(
          protectedCount > 0
            ? `${base} An accommodation request was protected from being cleared by an older draft.`
            : base,
        );
      } else {
        setAnnounce(`Saved ${data.applied.length} change(s). Everything is up to date.`);
      }
    },
    [id],
  );

  // ---- Client-side validation (server re-validates authoritatively) -------
  const runValidation = useCallback((): FieldError[] => {
    const errs = validateForSubmission({
      fullName: values.fullName,
      contactPhone: values.contactPhone,
      contactEmail: values.contactEmail,
      exemptionReason: values.exemptionReason,
      economicProof: values.economicProof,
      identityProof: values.identityProof,
      accommodations: values.accommodations,
      accommodationNote: values.accommodationNote,
    });
    return errs;
  }, [values]);

  // ---- Submit (idempotent) ------------------------------------------------
  const submit = useCallback(async () => {
    const errs = runValidation();
    setErrors(errs);
    if (errs.length > 0) {
      // Move focus to the error summary for screen-reader users.
      setAnnounce(`There are ${errs.length} problem(s) to fix before submitting.`);
      requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    // First save any pending edits so the server has final values. Use the
    // freshly-returned version (state updates are async) to avoid a spurious
    // VERSION_CONFLICT on the submit that immediately follows.
    let submitVersion = serverVersion;
    if (dirty.size > 0) {
      const saved = await saveToServer();
      if (saved !== null) submitVersion = saved;
    }
    setSubmitting(true);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = makeIdempotencyKey();
    }
    try {
      const res = await fetch(`/api/applications/${id}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({ baseVersion: submitVersion }),
      });
      if (!res.ok) {
        const body = (await res.json()) as ApiError;
        if (body.error?.code === "VALIDATION_FAILED") {
          const details = body.error.details as { fieldErrors?: FieldError[] } | undefined;
          const serverErrs = details?.fieldErrors ?? [];
          setErrors(serverErrs);
          setAnnounce(`Submission blocked: ${serverErrs.length} field(s) need attention.`);
          requestAnimationFrame(() => errorSummaryRef.current?.focus());
        } else if (body.error?.code === "VERSION_CONFLICT") {
          setAnnounce("This application changed elsewhere. Reloading the latest version — please review before resubmitting.");
          await refetch();
        } else {
          setAnnounce(`Could not submit: ${body.error?.message ?? "server error"}`);
        }
        return;
      }
      const data = (await res.json()) as SubmitResponse;
      setServerVersion(data.application.version);
      setState(data.application.state);
      setOpenCorrection(data.application.openCorrection);
      setDirty(new Set());
      clearDraft(id);
      // Reset the idempotency key for any future (post-correction) submission.
      idempotencyKeyRef.current = null;
      setAnnounce(
        data.replayed
          ? "This submission was already received; showing the confirmed status."
          : "Application submitted. Intake staff will review it.",
      );
    } catch {
      setOffline(true);
      setAnnounce("You appear to be offline. Your application is saved on this device; submit again when you reconnect.");
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runValidation, dirty, saveToServer, id, serverVersion]);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/applications/${id}`);
    if (!res.ok) return;
    const app = (await res.json()) as ApplicationDTO;
    setServerVersion(app.version);
    setState(app.state);
    setOpenCorrection(app.openCorrection);
    setValues(toFormValues(app));
    setFieldBase(() => {
      const base = {} as Record<ApplicantFieldKey, number>;
      for (const key of Object.keys(app.fields) as ApplicantFieldKey[]) {
        base[key] = app.fields[key].updatedAtVersion;
      }
      return base;
    });
    setFieldBaseValue(() => {
      const bv: Record<string, StoredValue> = {};
      for (const key of Object.keys(app.fields) as ApplicantFieldKey[]) {
        bv[key] = app.fields[key].value;
      }
      return bv;
    });
    setDirty(new Set());
  }, [id]);

  const goToField = useCallback((field: string) => {
    const targetStep = FIELD_STEP[field];
    // Switch to the step that owns the field first, then focus it once mounted.
    if (targetStep !== undefined) setStep(targetStep);
    const focusNow = () => {
      const el = fieldRefs.current[field];
      if (el) {
        el.focus();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      }
      return false;
    };
    // The field may not be mounted until after the step re-renders.
    requestAnimationFrame(() => {
      if (!focusNow()) requestAnimationFrame(focusNow);
    });
  }, []);

  const economicNeeded =
    values.exemptionReason !== "" &&
    (EXEMPTION_REASONS as readonly string[]).includes(values.exemptionReason) &&
    economicProofRequired(values.exemptionReason as ExemptionReason);

  // Change step and persist it so an offline reload returns to the same place.
  const changeStep = useCallback(
    (updater: (s: number) => number) => {
      setStep((prev) => {
        const next = Math.max(0, Math.min(STEPS.length - 1, updater(prev)));
        const cached = loadDraft(id);
        if (cached) saveDraft({ ...cached, step: next });
        return next;
      });
    },
    [id],
  );

  const registerRef = (key: string) => (el: HTMLElement | null) => {
    fieldRefs.current[key] = el;
  };
  const errorFor = (field: string) => errors.find((e) => e.field === field);
  const conflictFor = (key: ApplicantFieldKey) => conflicts.find((c) => c.key === key);

  return (
    <section aria-labelledby="wizard-heading">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <h1 id="wizard-heading">Application {id}</h1>
        <StatusBadge state={state} />
      </div>

      {/* Polite live region for status; assertive region for errors. */}
      <div aria-live="polite" className="sr-only" data-testid="live-polite">
        {announce}
      </div>

      {offline ? (
        <div className="banner" data-tone="warn" role="status" data-testid="offline-banner">
          <span className="banner-title">Offline: </span>
          You are not connected. Your progress is saved on this device and will
          sync when you reconnect.
        </div>
      ) : null}

      {restored ? (
        <div className="banner" data-tone="info" role="status" data-testid="restored-banner">
          <span className="banner-title">Draft restored: </span>
          We restored unsaved changes from this device. Review them, then choose
          “Save progress” to sync.
        </div>
      ) : null}

      {state === "NEEDS_CORRECTION" && openCorrection ? (
        <div className="banner" data-tone="warn" role="status" data-testid="correction-banner">
          <span className="banner-title">Correction requested: </span>
          Please update {formatFieldList(openCorrection.fields)} ({openCorrection.reasonCode})
          {openCorrection.note ? ` — ${openCorrection.note}` : ""}, then resubmit.
        </div>
      ) : null}

      {(state === "SUBMITTED" || state === "RESUBMITTED" || state === "ACCEPTED" || state === "DECLINED") ? (
        <div className="banner" data-tone={state === "DECLINED" ? "error" : state === "ACCEPTED" ? "success" : "info"} role="status" data-testid="terminal-banner">
          <span className="banner-title">Status: </span>
          {statusMessage(state)}
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <ConflictList conflicts={conflicts} onGo={goToField} onDismiss={() => setConflicts([])} />
      ) : null}

      <Stepper current={step} values={values} />

      {errors.length > 0 ? (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={errorSummaryRef}
          data-testid="error-summary"
        >
          <h2>There are {errors.length} problem(s) to fix</h2>
          <ul>
            {errors.map((e) => (
              <li key={`${e.field}-${e.code}`}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => goToField(e.field)}
                  style={{ border: "none", background: "none", color: "var(--error)", textDecoration: "underline", padding: 0, cursor: "pointer", font: "inherit" }}
                >
                  {e.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div id="step-region" tabIndex={-1} aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]!.label}`}>
        {step === 0 ? renderContact() : null}
        {step === 1 ? renderEligibility() : null}
        {step === 2 ? renderMaterials() : null}
        {step === 3 ? renderAccommodations() : null}
        {step === 4 ? renderReview() : null}
      </div>

      <div className="button-row">
        {step > 0 ? (
          <button type="button" className="secondary" onClick={() => changeStep((s) => s - 1)}>
            ← Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => changeStep((s) => s + 1)}>
            Next →
          </button>
        ) : null}
        {editable ? (
          <button type="button" className="secondary" onClick={saveToServer} disabled={saving} aria-busy={saving} data-testid="save-draft">
            {saving ? "Saving…" : "Save progress"}
          </button>
        ) : null}
        {step === STEPS.length - 1 && editable ? (
          <button type="button" onClick={submit} disabled={submitting} aria-busy={submitting} data-testid="submit">
            {submitting ? "Submitting…" : state === "NEEDS_CORRECTION" ? "Resubmit application" : "Submit application"}
          </button>
        ) : null}
      </div>
    </section>
  );

  // ------- Step renderers --------------------------------------------------

  function renderContact() {
    return (
      <fieldset>
        <legend className="fieldset-legend">Your details</legend>
        <TextField
          id="fullName"
          label="Full name"
          value={values.fullName}
          onChange={(v) => setField("fullName", v)}
          required
          autoComplete="name"
          inputRef={registerRef("fullName")}
          error={errorFor("fullName")}
          conflict={conflictFor("fullName")}
        />
        <TextField
          id="contactPhone"
          label="Phone number"
          type="tel"
          value={values.contactPhone}
          onChange={(v) => setField("contactPhone", v)}
          autoComplete="tel"
          hint="Provide a phone number or an email so staff can reach you."
          inputRef={registerRef("contactPhone")}
          error={errorFor("contactPhone")}
          conflict={conflictFor("contactPhone")}
        />
        <TextField
          id="contactEmail"
          label="Email address"
          type="email"
          value={values.contactEmail}
          onChange={(v) => setField("contactEmail", v)}
          autoComplete="email"
          inputRef={registerRef("contactEmail")}
          error={errorFor("contactEmail")}
          conflict={conflictFor("contactEmail")}
        />
      </fieldset>
    );
  }

  function renderEligibility() {
    const err = errorFor("exemptionReason");
    const errId = err ? "exemptionReason-error" : undefined;
    return (
      <fieldset
        aria-describedby={errId}
        aria-invalid={err ? true : undefined}
        ref={registerRef("exemptionReason") as unknown as React.Ref<HTMLFieldSetElement>}
        tabIndex={-1}
      >
        <legend className="fieldset-legend">
          Economic-eligibility basis <span aria-hidden="true">*</span>
          <span className="sr-only">(required)</span>
        </legend>
        <p className="hint">
          Choose the basis for your legal-aid means assessment. Some options waive
          the economic-hardship document.
        </p>
        {EXEMPTION_REASONS.map((reason) => (
          <div className="radio-row" key={reason}>
            <input
              type="radio"
              id={`reason-${reason}`}
              name="exemptionReason"
              value={reason}
              checked={values.exemptionReason === reason}
              onChange={() => setField("exemptionReason", reason)}
            />
            <label htmlFor={`reason-${reason}`}>
              {REASON_LABELS[reason]}
              {!economicProofRequired(reason) ? (
                <span className="waived-note"> economic proof not required</span>
              ) : null}
            </label>
          </div>
        ))}
        {err ? (
          <p className="field-error" id={errId} role="alert">
            {err.message}
          </p>
        ) : null}
        <ConflictNote conflict={conflictFor("exemptionReason")} />
      </fieldset>
    );
  }

  function renderMaterials() {
    return (
      <fieldset>
        <legend className="fieldset-legend">Supporting documents</legend>
        <p className="hint">
          Enter the reference of an uploaded document. Identity proof is always
          required.
        </p>
        <TextField
          id="identityProof"
          label="Identity document reference"
          value={values.identityProof}
          onChange={(v) => setField("identityProof", v)}
          required
          hint="For example, an uploaded ID metadata reference such as ID-META-1."
          inputRef={registerRef("identityProof")}
          error={errorFor("identityProof")}
          conflict={conflictFor("identityProof")}
        />
        {economicNeeded ? (
          <TextField
            id="economicProof"
            label="Economic-hardship document reference"
            value={values.economicProof}
            onChange={(v) => setField("economicProof", v)}
            required
            hint="Required for your selected eligibility basis."
            inputRef={registerRef("economicProof")}
            error={errorFor("economicProof")}
            conflict={conflictFor("economicProof")}
          />
        ) : (
          <div className="banner" data-tone="success" role="status" data-testid="economic-waived">
            <span className="banner-title">Not required: </span>
            Based on your selected eligibility basis
            {values.exemptionReason ? ` (${REASON_LABELS[values.exemptionReason as ExemptionReason]})` : ""},
            you do not need to upload proof of economic hardship.
          </div>
        )}
      </fieldset>
    );
  }

  function renderAccommodations() {
    return (
      <fieldset>
        <legend className="fieldset-legend">Reasonable accommodations</legend>
        <p className="hint">
          Tell us how we can make this process accessible for you. These requests
          are preserved even if you continue an older draft.
        </p>
        {ACCOMMODATIONS.map((acc) => {
          const checked = values.accommodations.includes(acc);
          return (
            <div className="checkbox-row" key={acc}>
              <input
                type="checkbox"
                id={`acc-${acc}`}
                name="accommodations"
                value={acc}
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...values.accommodations, acc]
                    : values.accommodations.filter((a) => a !== acc);
                  setField("accommodations", next);
                }}
              />
              <label htmlFor={`acc-${acc}`}>{ACCOMMODATION_LABELS[acc]}</label>
            </div>
          );
        })}
        <ConflictNote conflict={conflictFor("accommodations")} />
        <div className="field" style={{ marginTop: "1rem" }}>
          <label htmlFor="accommodationNote">Anything else we should know?</label>
          <textarea
            id="accommodationNote"
            name="accommodationNote"
            rows={3}
            value={values.accommodationNote}
            onChange={(e) => setField("accommodationNote", e.target.value)}
            ref={registerRef("accommodationNote") as React.Ref<HTMLTextAreaElement>}
          />
          <ConflictNote conflict={conflictFor("accommodationNote")} />
        </div>
      </fieldset>
    );
  }

  function renderReview() {
    return (
      <fieldset>
        <legend className="fieldset-legend">Review &amp; submit</legend>
        <dl className="meta">
          <dt>Full name</dt>
          <dd>{values.fullName || <em>Not provided</em>}</dd>
          <dt>Phone</dt>
          <dd>{values.contactPhone || <em>—</em>}</dd>
          <dt>Email</dt>
          <dd>{values.contactEmail || <em>—</em>}</dd>
          <dt>Eligibility basis</dt>
          <dd>
            {values.exemptionReason
              ? REASON_LABELS[values.exemptionReason as ExemptionReason]
              : <em>Not selected</em>}
          </dd>
          <dt>Identity document</dt>
          <dd>{values.identityProof || <em>Not provided</em>}</dd>
          <dt>Economic-hardship document</dt>
          <dd>
            {economicNeeded
              ? values.economicProof || <em>Not provided</em>
              : <span className="waived-note">Not required for this basis</span>}
          </dd>
          <dt>Accommodations</dt>
          <dd>
            {values.accommodations.length > 0
              ? values.accommodations.map((a) => ACCOMMODATION_LABELS[a]).join(", ")
              : <em>None requested</em>}
          </dd>
        </dl>
        <p className="hint">
          Submitting sends your application to intake staff. You can resubmit if a
          correction is requested.
        </p>
      </fieldset>
    );
  }
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "tel" | "email";
  required?: boolean;
  autoComplete?: string;
  hint?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  error?: FieldError;
  conflict?: FieldMergeSummary;
}) {
  const { id, label, value, onChange, type = "text", required, autoComplete, hint, inputRef, error, conflict } = props;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const conflictId = conflict ? `${id}-conflict` : undefined;
  const describedBy = [hintId, errorId, conflictId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? (
          <>
            {" "}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </label>
      {hint ? (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        ref={inputRef}
      />
      {error ? (
        <p className="field-error" id={errorId} role="alert" data-testid={`error-${id}`}>
          {error.message}
        </p>
      ) : null}
      <ConflictNote conflict={conflict} id={conflictId} />
    </div>
  );
}

function ConflictNote({ conflict, id }: { conflict?: FieldMergeSummary; id?: string }) {
  if (!conflict) return null;
  const isProtected = conflict.conflictReason === "PROTECTED_ACCOMMODATION";
  return (
    <p className="field-error" id={id} role="status" data-testid={`conflict-${conflict.key}`}>
      {isProtected
        ? "Conflict: your older draft would have removed this accommodation request, so we kept the current value."
        : "Conflict: this field was changed elsewhere. We kept the server value; re-enter your change if needed."}
    </p>
  );
}

function ConflictList({
  conflicts,
  onGo,
  onDismiss,
}: {
  conflicts: FieldMergeSummary[];
  onGo: (field: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="banner" data-tone="warn" role="alert" data-testid="conflict-summary">
      <span className="banner-title">
        {conflicts.length} field conflict(s) were resolved to the server value.
      </span>
      <ul>
        {conflicts.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              className="secondary"
              style={{ border: "none", background: "none", textDecoration: "underline", padding: 0, cursor: "pointer", font: "inherit" }}
              onClick={() => onGo(c.key)}
            >
              Review {c.key}
              {c.conflictReason === "PROTECTED_ACCOMMODATION" ? " (accommodation protected)" : ""}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="secondary" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function Stepper({ current, values }: { current: number; values: FormValues }) {
  return (
    <nav aria-label="Application steps">
      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === current ? "step" : undefined}
            data-complete={i < current ? "true" : "false"}
          >
            <span className="sr-only">
              {i < current ? "Completed step: " : i === current ? "Current step: " : "Upcoming step: "}
            </span>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function applyStoredValue(target: FormValues, key: ApplicantFieldKey, value: StoredValue) {
  if (key === "accommodations") {
    const list = Array.isArray(value) ? value : value ? [String(value)] : [];
    target.accommodations = list.filter((a): a is Accommodation =>
      (ACCOMMODATIONS as readonly string[]).includes(a),
    );
    return;
  }
  const scalar = value === null ? "" : Array.isArray(value) ? value.join(",") : value;
  (target as Record<string, unknown>)[key] = scalar;
}

function formatFieldList(fields: string[]): string {
  if (fields.length === 0) return "the flagged fields";
  return fields.join(", ");
}

function statusMessage(state: string): string {
  switch (state) {
    case "SUBMITTED":
      return "Your application has been submitted and is awaiting review.";
    case "RESUBMITTED":
      return "Your corrected application has been resubmitted and is awaiting review.";
    case "ACCEPTED":
      return "Your application has been accepted.";
    case "DECLINED":
      return "Your application was declined. Contact the office for next steps.";
    default:
      return "";
  }
}

function makeIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
