import { prisma } from "./db";
import { AppError, notFound } from "./errors";
import { newApplicationId, requestHash } from "./ids";
import {
  deserializeFieldValue,
  serializeFieldValue,
  parseAccommodations,
} from "./fieldSerialization";
import {
  APPLICANT_FIELD_KEYS,
  STAFF_VIEWS,
  type ApplicantFieldKey,
  type ApplicationState,
  type MaterialKind,
  type StaffViewName,
  isApplicationState,
} from "@/domain/constants";
import {
  assertTransition,
  canEditFields,
  nextState,
  ACTOR_BY_ACTION,
  type ApplicationAction,
} from "@/domain/stateMachine";
import {
  mergeFields,
  fieldsChangedSince,
  type FieldMergeResult,
  type IncomingEdit,
  type StoredField,
  type StoredValue,
} from "@/domain/merge";
import { validateForSubmission, type ApplicationValues, type FieldError } from "@/domain/validation";
import {
  projectForStaff,
  type FullApplicationProjection,
  type MaterialMetadataView,
} from "@/domain/disclosure";
import {
  applicantFieldPolicy,
  staffStepForState,
  coerceApplicantStep,
  evaluateWrites,
  APPLICANT_PII_FIELDS,
  type ActorRole,
  type ApplicantStep,
  type WriteDecision,
} from "@/domain/accessPolicy";

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------

export interface ApplicationView {
  id: string;
  state: ApplicationState;
  version: number;
  fields: Record<ApplicantFieldKey, { value: StoredValue; updatedAtVersion: number }>;
  values: ApplicationValues;
  materials: MaterialMetadataView[];
  openCorrection: { fields: string[]; reasonCode: string; note: string | null } | null;
  updatedAt: string;
}

type FieldRow = { key: string; value: string | null; updatedAtVersion: number };

// ---------------------------------------------------------------------------
// Loading + view assembly
// ---------------------------------------------------------------------------

function toFieldMap(rows: FieldRow[]): Map<ApplicantFieldKey, StoredField> {
  const map = new Map<ApplicantFieldKey, StoredField>();
  for (const row of rows) {
    if (!(APPLICANT_FIELD_KEYS as readonly string[]).includes(row.key)) continue;
    const key = row.key as ApplicantFieldKey;
    map.set(key, {
      key,
      value: deserializeFieldValue(key, row.value),
      updatedAtVersion: row.updatedAtVersion,
    });
  }
  return map;
}

function buildValues(fieldMap: Map<ApplicantFieldKey, StoredField>): ApplicationValues {
  const get = (k: ApplicantFieldKey): StoredValue => fieldMap.get(k)?.value ?? null;
  const asString = (v: StoredValue): string | null =>
    v === null ? null : Array.isArray(v) ? v.join(",") : v;
  return {
    fullName: asString(get("fullName")),
    contactPhone: asString(get("contactPhone")),
    contactEmail: asString(get("contactEmail")),
    exemptionReason: asString(get("exemptionReason")),
    economicProof: asString(get("economicProof")),
    identityProof: asString(get("identityProof")),
    accommodations: parseAccommodations(get("accommodations")),
    accommodationNote: asString(get("accommodationNote")),
  };
}

async function loadApplicationOrThrow(id: string): Promise<ApplicationView> {
  const app = await prisma.application.findUnique({
    where: { id },
    include: {
      fields: true,
      materials: true,
      corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) throw notFound();
  return assembleView(app);
}

// Reload within an open transaction so callers see their own uncommitted writes
// (the global client would read the pre-transaction snapshot on SQLite).
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function reloadWithinTx(tx: TxClient, id: string): Promise<ApplicationView> {
  const app = await tx.application.findUniqueOrThrow({
    where: { id },
    include: {
      fields: true,
      materials: true,
      corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  return assembleView(app);
}

// ---------------------------------------------------------------------------
// Audit trail — every field-level access decision (read + write) is recorded so
// an over-privileged read or a crafted hidden-field submit is always explainable.
// ---------------------------------------------------------------------------

export type AuditDecision = "ALLOW" | "DENY" | "PARTIAL";

interface AuditInput {
  applicationId: string;
  actorRole: ActorRole | "system";
  action: string;
  decision: AuditDecision;
  state: ApplicationState;
  atVersion: number;
  allowedFields: string[];
  deniedFields: string[];
  reasonCode?: string | null;
  note?: string | null;
}

async function writeAudit(
  db: TxClient | typeof prisma,
  input: AuditInput,
): Promise<void> {
  await db.auditLog.create({
    data: {
      applicationId: input.applicationId,
      actorRole: input.actorRole,
      action: input.action,
      decision: input.decision,
      state: input.state,
      atVersion: input.atVersion,
      allowedFields: JSON.stringify(input.allowedFields),
      deniedFields: JSON.stringify(input.deniedFields),
      reasonCode: input.reasonCode ?? null,
      note: input.note ?? null,
    },
  });
}

export interface AuditEntry {
  id: string;
  actorRole: string;
  action: string;
  decision: string;
  state: string;
  atVersion: number;
  allowedFields: string[];
  deniedFields: string[];
  reasonCode: string | null;
  note: string | null;
  createdAt: string;
}

export async function getAuditTrail(id: string): Promise<AuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { applicationId: id },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    actorRole: r.actorRole,
    action: r.action,
    decision: r.decision,
    state: r.state,
    atVersion: r.atVersion,
    allowedFields: safeParseStringArray(r.allowedFields),
    deniedFields: safeParseStringArray(r.deniedFields),
    reasonCode: r.reasonCode,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

type LoadedApp = {
  id: string;
  state: string;
  version: number;
  updatedAt: Date;
  fields: FieldRow[];
  materials: Array<{
    id: string;
    kind: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: Date;
  }>;
  corrections: Array<{ fields: string; reasonCode: string; note: string | null }>;
};

function assembleView(app: LoadedApp): ApplicationView {
  const fieldMap = toFieldMap(app.fields);
  const fields = {} as ApplicationView["fields"];
  for (const key of APPLICANT_FIELD_KEYS) {
    const f = fieldMap.get(key);
    fields[key] = {
      value: f?.value ?? (deserializeFieldValue(key, null)),
      updatedAtVersion: f?.updatedAtVersion ?? 0,
    };
  }
  const state = isApplicationState(app.state) ? app.state : "DRAFT";
  const open = app.corrections[0];
  return {
    id: app.id,
    state,
    version: app.version,
    fields,
    values: buildValues(fieldMap),
    materials: app.materials.map((m) => ({
      id: m.id,
      kind: m.kind,
      filename: m.filename,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      uploadedAt: m.uploadedAt.toISOString(),
    })),
    openCorrection: open
      ? { fields: safeParseStringArray(open.fields), reasonCode: open.reasonCode, note: open.note }
      : null,
    updatedAt: app.updatedAt.toISOString(),
  };
}

function safeParseStringArray(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createApplication(): Promise<ApplicationView> {
  // Retry a few times on the astronomically unlikely ID collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newApplicationId();
    const exists = await prisma.application.findUnique({ where: { id }, select: { id: true } });
    if (exists) continue;
    const created = await prisma.application.create({
      data: {
        id,
        state: "DRAFT",
        version: 0,
        events: { create: { toState: "DRAFT", actor: "applicant", note: "created" } },
      },
    });
    return loadApplicationOrThrow(created.id);
  }
  throw new AppError("BAD_REQUEST", "Could not allocate application id.", 500);
}

export async function getApplication(id: string): Promise<ApplicationView> {
  return loadApplicationOrThrow(id);
}

// ------- Draft patch (field-level merge) -----------------------------------

export interface DeniedField {
  key: string;
  reasonCode: string;
}

export interface DraftPatchResult {
  application: ApplicationView;
  applied: FieldMergeResult[];
  conflicts: FieldMergeResult[];
  // Fields the server refused to write (unknown / over-privileged / not in the
  // step whitelist). Each carries an auditable reason. These are dropped BEFORE
  // the merge, so a crafted hidden field can never reach persistence.
  denied: DeniedField[];
}

export async function patchDraft(
  id: string,
  baseVersion: number,
  edits: IncomingEdit[],
  step: ApplicantStep = "review",
): Promise<DraftPatchResult> {
  // Pre-check editability OUTSIDE the transaction so the deny audit is not rolled
  // back together with the rejected write. A crafted write against a locked state
  // must still leave an auditable record.
  const pre = await prisma.application.findUnique({
    where: { id },
    select: { state: true, version: true },
  });
  if (!pre) throw notFound();
  const preState = isApplicationState(pre.state) ? pre.state : "DRAFT";
  if (!canEditFields(preState)) {
    await writeAudit(prisma, {
      applicationId: id,
      actorRole: "applicant",
      action: "draft.write",
      decision: "DENY",
      state: preState,
      atVersion: pre.version,
      allowedFields: [],
      deniedFields: edits.map((e) => String(e.key)),
      reasonCode: "NOT_WRITABLE_IN_STATE",
      note: `Draft not editable in state ${preState}.`,
    });
    throw new AppError("NOT_EDITABLE", `Draft is not editable in state ${preState}.`, 409, {
      state: preState,
    });
  }

  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({
      where: { id },
      include: { fields: true },
    });
    if (!app) throw notFound();
    const state = isApplicationState(app.state) ? app.state : "DRAFT";
    if (!canEditFields(state)) {
      // State flipped between the pre-check and the transaction (race). Audit is
      // written on its own connection so it survives the rollback.
      await writeAudit(prisma, {
        applicationId: id,
        actorRole: "applicant",
        action: "draft.write",
        decision: "DENY",
        state,
        atVersion: app.version,
        allowedFields: [],
        deniedFields: edits.map((e) => String(e.key)),
        reasonCode: "NOT_WRITABLE_IN_STATE",
        note: `Draft not editable in state ${state}.`,
      });
      throw new AppError("NOT_EDITABLE", `Draft is not editable in state ${state}.`, 409, {
        state,
      });
    }

    // Server-authoritative write policy: recompute the writable whitelist from
    // (role, state, step) and classify every requested key. Never trust the
    // client to have sent only permitted fields.
    const policy = applicantFieldPolicy(state, step);
    const evaluation = evaluateWrites(policy, edits.map((e) => String(e.key)));
    const allowedSet = new Set<string>(evaluation.allowedKeys);
    const permittedEdits = edits.filter((e) => allowedSet.has(String(e.key)));
    const denied: DeniedField[] = evaluation.denied.map((d: WriteDecision) => ({
      key: d.key,
      reasonCode: d.reasonCode ?? "DENIED",
    }));

    const storedMap = toFieldMap(app.fields);
    const outcome = mergeFields(storedMap, permittedEdits);

    // Only bump the version + persist if at least one field actually changed.
    const toApply = outcome.applied;
    let newVersion = app.version;
    if (toApply.length > 0) {
      newVersion = app.version + 1;
      for (const res of toApply) {
        const serialized = serializeFieldValue(res.key, res.resolvedValue);
        await tx.applicationField.upsert({
          where: { applicationId_key: { applicationId: id, key: res.key } },
          create: {
            applicationId: id,
            key: res.key,
            value: serialized,
            updatedAtVersion: newVersion,
          },
          update: { value: serialized, updatedAtVersion: newVersion },
        });
      }
      await tx.application.update({
        where: { id },
        data: { version: newVersion },
      });
    }

    // Record the field-level access decision for this write.
    await writeAudit(tx, {
      applicationId: id,
      actorRole: "applicant",
      action: "draft.write",
      decision: denied.length === 0 ? "ALLOW" : toApply.length > 0 ? "PARTIAL" : "DENY",
      state,
      atVersion: newVersion,
      allowedFields: toApply.map((r) => r.key),
      deniedFields: denied.map((d) => d.key),
      reasonCode: denied[0]?.reasonCode ?? null,
      note:
        denied.length > 0
          ? `Rejected ${denied.length} over-privileged/unknown field(s) on step '${step}'.`
          : null,
    });

    const reloaded = await tx.application.findUniqueOrThrow({
      where: { id },
      include: {
        fields: true,
        materials: true,
        corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
      },
    });
    return {
      application: assembleView(reloaded),
      applied: outcome.applied,
      conflicts: outcome.conflicts,
      denied,
    };
  });
}

// ------- Submission / resubmission (idempotent) ----------------------------

export interface SubmitResult {
  application: ApplicationView;
  replayed: boolean;
}

async function transitionWithIdempotency(
  id: string,
  action: Extract<ApplicationAction, "submit" | "resubmit">,
  idempotencyKey: string,
  baseVersion: number,
): Promise<SubmitResult> {
  const scope = action;
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({
      where: { id },
      include: {
        fields: true,
        corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!app) throw notFound();

    const rHash = requestHash({ id, action, baseVersion });

    // Idempotency replay: same key returns the original outcome, no 2nd write.
    const existing = await tx.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
    if (existing) {
      if (existing.applicationId !== id || existing.scope !== scope) {
        throw new AppError(
          "IDEMPOTENCY_MISMATCH",
          "Idempotency key already used for a different request.",
          409,
        );
      }
      const reloaded = await tx.application.findUniqueOrThrow({
        where: { id },
        include: {
          fields: true,
          materials: true,
          corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
        },
      });
      return { application: assembleView(reloaded), replayed: true };
    }

    const state = isApplicationState(app.state) ? app.state : "DRAFT";

    // Optimistic concurrency: the client must submit from the current version.
    if (baseVersion !== app.version) {
      throw new AppError("VERSION_CONFLICT", "Application changed since you last loaded it.", 409, {
        expected: app.version,
        received: baseVersion,
      });
    }

    // Validate the whole application (economic-proof rule enforced here).
    const fieldMap = toFieldMap(app.fields);
    const values = buildValues(fieldMap);
    const errors = validateForSubmission(values);
    if (errors.length > 0) {
      throw new AppError("VALIDATION_FAILED", "Application is not ready to submit.", 422, {
        fieldErrors: errors satisfies FieldError[],
      });
    }

    // State transition.
    const toState = assertTransition(state, action);
    const newVersion = app.version + 1;
    await tx.application.update({
      where: { id },
      data: {
        state: toState,
        version: newVersion,
        events: {
          create: {
            fromState: state,
            toState,
            actor: ACTOR_BY_ACTION[action],
            note: action,
          },
        },
      },
    });

    // Resolve open corrections when resubmitting.
    if (action === "resubmit") {
      await tx.correction.updateMany({
        where: { applicationId: id, resolvedAt: null },
        data: { resolvedAt: new Date() },
      });
    }

    await tx.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        applicationId: id,
        scope,
        requestHash: rHash,
        resultState: toState,
        resultVersion: newVersion,
      },
    });

    const reloaded = await tx.application.findUniqueOrThrow({
      where: { id },
      include: {
        fields: true,
        materials: true,
        corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
      },
    });
    return { application: assembleView(reloaded), replayed: false };
  });
}

export async function submitApplication(
  id: string,
  idempotencyKey: string,
  baseVersion: number,
): Promise<SubmitResult> {
  const app = await prisma.application.findUnique({ where: { id }, select: { state: true } });
  if (!app) throw notFound();
  // Choose submit vs resubmit based on the current state so a single endpoint
  // handles both first submit and post-correction resubmit.
  const action: "submit" | "resubmit" = app.state === "NEEDS_CORRECTION" ? "resubmit" : "submit";
  return transitionWithIdempotency(id, action, idempotencyKey, baseVersion);
}

// ------- Staff actions -----------------------------------------------------

export async function staffDecision(
  id: string,
  action: Extract<ApplicationAction, "accept" | "decline">,
  note?: string,
): Promise<ApplicationView> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({ where: { id } });
    if (!app) throw notFound();
    const state = isApplicationState(app.state) ? app.state : "DRAFT";
    const toState = assertTransition(state, action);
    await tx.application.update({
      where: { id },
      data: {
        state: toState,
        version: app.version + 1,
        events: {
          create: { fromState: state, toState, actor: "staff", note: note ?? action },
        },
      },
    });
    return reloadWithinTx(tx, id);
  });
}

export interface CorrectionResult {
  application: ApplicationView;
  // Applicant fields that changed on the server after the staff member's
  // baseVersion — i.e., the applicant supplemented materials concurrently while
  // staff was writing the correction. Returned to the STAFF session so it can
  // reconcile its view. Empty when the staff acted on the latest version.
  concurrentFields: string[];
  // Whether this created a new correction or amended within NEEDS_CORRECTION.
  amended: boolean;
}

/**
 * Staff writes (or amends) a correction reason code. This performs a field-level
 * three-way reconciliation across the concurrent applicant edit:
 *  - The correction path never writes applicant field VALUES, so a concurrent
 *    applicant material supplement is preserved untouched (accommodations
 *    included).
 *  - If the applicant changed fields after the staff member's `baseVersion`,
 *    those keys are returned as `concurrentFields` so the staff session sees the
 *    conflict rather than silently overwriting its mental model.
 *  - From SUBMITTED/RESUBMITTED it transitions to NEEDS_CORRECTION; from
 *    NEEDS_CORRECTION it self-loops (amendCorrection) so it is not an illegal
 *    backward transition while the applicant is still editing.
 */
export async function requestCorrection(
  id: string,
  fields: string[],
  reasonCode: string,
  note?: string,
  baseVersion?: number,
): Promise<CorrectionResult> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({ where: { id }, include: { fields: true } });
    if (!app) throw notFound();
    const state = isApplicationState(app.state) ? app.state : "DRAFT";

    // Choose the legal action for the current state: fresh request vs amend.
    const action: ApplicationAction =
      state === "NEEDS_CORRECTION" ? "amendCorrection" : "requestCorrection";
    const toState = assertTransition(state, action);

    // Detect the applicant's concurrent edits relative to the staff base version.
    const storedFields = toFieldMap(app.fields);
    const concurrentFields =
      baseVersion === undefined
        ? []
        : fieldsChangedSince(storedFields.values(), baseVersion);

    const newVersion = app.version + 1;
    await tx.application.update({
      where: { id },
      data: {
        state: toState,
        version: newVersion,
        // NOTE: no field writes here — applicant values (incl. accommodations)
        // are deliberately left intact.
        events: {
          create: { fromState: state, toState, actor: "staff", note: reasonCode },
        },
      },
    });

    if (action === "amendCorrection") {
      // Merge into the existing open correction: union the flagged fields and
      // update the reason code, rather than stacking duplicate corrections.
      const open = await tx.correction.findFirst({
        where: { applicationId: id, resolvedAt: null },
        orderBy: { createdAt: "desc" },
      });
      if (open) {
        const merged = Array.from(new Set([...safeParseStringArray(open.fields), ...fields]));
        await tx.correction.update({
          where: { id: open.id },
          data: { fields: JSON.stringify(merged), reasonCode, note: note ?? open.note },
        });
      } else {
        await tx.correction.create({
          data: { applicationId: id, fields: JSON.stringify(fields), reasonCode, note: note ?? null },
        });
      }
    } else {
      await tx.correction.create({
        data: { applicationId: id, fields: JSON.stringify(fields), reasonCode, note: note ?? null },
      });
    }

    return {
      application: await reloadWithinTx(tx, id),
      concurrentFields,
      amended: action === "amendCorrection",
    };
  });
}

// ------- Staff disclosure-limited projections ------------------------------

export async function getStaffView(id: string, view: StaffViewName) {
  const app = await prisma.application.findUnique({
    where: { id },
    include: {
      fields: true,
      materials: true,
      corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) throw notFound();

  const fieldMap = toFieldMap(app.fields);
  const values = buildValues(fieldMap);
  const state = isApplicationState(app.state) ? app.state : "DRAFT";

  const full: FullApplicationProjection = {
    id: app.id,
    state,
    exemptionReason: values.exemptionReason ?? null,
    accommodations: parseAccommodations(fieldMap.get("accommodations")?.value ?? []),
    accommodationNote: values.accommodationNote ?? null,
    correctionFields: app.corrections[0] ? safeParseStringArray(app.corrections[0].fields) : [],
    materialMetadata: app.materials.map((m) => ({
      id: m.id,
      kind: m.kind,
      filename: m.filename,
      mimeType: m.mimeType,
      sizeBytes: m.sizeBytes,
      uploadedAt: m.uploadedAt.toISOString(),
    })),
    submittedFieldMetadata: APPLICANT_FIELD_KEYS.map((key) => {
      const f = fieldMap.get(key);
      const present = f !== undefined && f.value !== null &&
        !(Array.isArray(f.value) && f.value.length === 0) &&
        !(typeof f.value === "string" && f.value.trim() === "");
      return { key, present, updatedAtVersion: f?.updatedAtVersion ?? 0 };
    }),
    fullName: values.fullName ?? null,
    contactPhone: values.contactPhone ?? null,
    contactEmail: values.contactEmail ?? null,
  };

  return projectForStaff(view, full);
}

// Map the policy staff step to the disclosure view name from the source material.
const STAFF_STEP_TO_VIEW: Record<"intake" | "correction", StaffViewName> = {
  intake: "INTAKE_REVIEW",
  correction: "CORRECTION_REVIEW",
};

export interface StaffContinuation {
  disclosed: Record<string, unknown>;
  // The view the server ACTUALLY served, recomputed from current state.
  enforcedView: StaffViewName;
  // What the (possibly stale) link requested, for transparency.
  requestedView: StaffViewName | null;
  // True when a stale/broader link was downgraded to the state-appropriate view.
  downgraded: boolean;
  state: ApplicationState;
  version: number;
}

/**
 * Server-authoritative staff continuation read. The disclosure view is
 * recomputed from the CURRENT state — a stale link (e.g. opened at the
 * NEEDS_CORRECTION <-> RESUBMITTED boundary) can never widen disclosure beyond
 * what the current state permits. Every read is audited; a downgrade records the
 * over-privileged fields that were refused with a reason code. PII is stripped
 * defensively as a second line of defense.
 */
export async function getStaffContinuation(
  id: string,
  requestedView?: string | null,
): Promise<StaffContinuation> {
  const app = await prisma.application.findUnique({ where: { id }, select: { state: true, version: true } });
  if (!app) throw notFound();
  const state = isApplicationState(app.state) ? app.state : "DRAFT";

  const enforcedView = STAFF_STEP_TO_VIEW[staffStepForState(state)];
  // Normalize the (possibly stale/crafted) requested view to a known name or null.
  const normalizedRequested: StaffViewName | null =
    requestedView === "INTAKE_REVIEW" || requestedView === "CORRECTION_REVIEW"
      ? requestedView
      : null;
  const downgraded = normalizedRequested !== null && normalizedRequested !== enforcedView;

  // Project using the ENFORCED view only (never the requested one).
  const disclosed = (await getStaffView(id, enforcedView)) as Record<string, unknown>;

  // Defensive PII strip: guarantee no applicant PII ever appears, regardless of
  // how the projection was configured.
  for (const pii of APPLICANT_PII_FIELDS) {
    if (pii in disclosed) delete disclosed[pii];
  }

  // Audit the read decision. A downgrade is a PARTIAL/deny of the fields the
  // broader requested view would have exposed.
  if (downgraded && normalizedRequested) {
    const requestedFields = (STAFF_VIEWS[normalizedRequested] as readonly string[]).slice();
    const enforcedFields = new Set(STAFF_VIEWS[enforcedView] as readonly string[]);
    const refused = requestedFields.filter((f) => !enforcedFields.has(f));
    await writeAudit(prisma, {
      applicationId: id,
      actorRole: "staff",
      action: "continuation.read",
      decision: "PARTIAL",
      state,
      atVersion: app.version,
      allowedFields: [...enforcedFields],
      deniedFields: refused,
      reasonCode: "STALE_VIEW_DOWNGRADED",
      note: `Stale link requested ${normalizedRequested}; served ${enforcedView} for state ${state}.`,
    });
  } else {
    await writeAudit(prisma, {
      applicationId: id,
      actorRole: "staff",
      action: "continuation.read",
      decision: "ALLOW",
      state,
      atVersion: app.version,
      allowedFields: STAFF_VIEWS[enforcedView] as unknown as string[],
      deniedFields: [],
      reasonCode: null,
      note: null,
    });
  }

  return {
    disclosed,
    enforcedView,
    requestedView: normalizedRequested,
    downgraded,
    state,
    version: app.version,
  };
}

// ------- Applicant step-scoped continuation (server-recomputed) ------------

export interface ApplicantContinuation {
  id: string;
  state: ApplicationState;
  version: number;
  step: ApplicantStep;
  // Only the values the current step is allowed to READ (recomputed server-side).
  fields: Record<string, { value: StoredValue; updatedAtVersion: number }>;
  // Field keys the current step may WRITE (recomputed server-side).
  writable: string[];
  openCorrection: { fields: string[]; reasonCode: string; note: string | null } | null;
}

/**
 * Applicant continuation read scoped to a single step. The readable field set is
 * recomputed from (state, step) on every load; fields the step does not own are
 * never included in the payload (not merely hidden). Accommodation values are
 * always returned on their step so the applicant can see/keep their request.
 */
export async function getApplicantContinuation(
  id: string,
  step: string,
): Promise<ApplicantContinuation> {
  const app = await prisma.application.findUnique({
    where: { id },
    include: {
      fields: true,
      corrections: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) throw notFound();
  const state = isApplicationState(app.state) ? app.state : "DRAFT";
  const resolvedStep = coerceApplicantStep(step);
  const policy = applicantFieldPolicy(state, resolvedStep);

  const fieldMap = toFieldMap(app.fields);
  const readable = new Set<string>(policy.readable);
  const fields: ApplicantContinuation["fields"] = {};
  for (const key of policy.readable) {
    const f = fieldMap.get(key);
    fields[key] = {
      value: f?.value ?? deserializeFieldValue(key, null),
      updatedAtVersion: f?.updatedAtVersion ?? 0,
    };
  }

  const open = app.corrections[0];
  await writeAudit(prisma, {
    applicationId: id,
    actorRole: "applicant",
    action: "continuation.read",
    decision: "ALLOW",
    state,
    atVersion: app.version,
    allowedFields: [...readable],
    deniedFields: [],
    reasonCode: null,
    note: `step=${resolvedStep}`,
  });

  return {
    id: app.id,
    state,
    version: app.version,
    step: resolvedStep,
    fields,
    writable: policy.writable,
    openCorrection: open
      ? { fields: safeParseStringArray(open.fields), reasonCode: open.reasonCode, note: open.note }
      : null,
  };
}

export interface StaffListItem {
  id: string;
  state: ApplicationState;
  version: number;
  accommodations: string[];
  updatedAt: string;
}

export async function listApplicationsForStaff(): Promise<StaffListItem[]> {
  const apps = await prisma.application.findMany({
    orderBy: { updatedAt: "desc" },
    include: { fields: { where: { key: "accommodations" } } },
  });
  return apps.map((a) => {
    const accField = a.fields[0];
    const state = isApplicationState(a.state) ? a.state : "DRAFT";
    return {
      id: a.id,
      state,
      version: a.version,
      accommodations: parseAccommodations(
        accField ? deserializeFieldValue("accommodations", accField.value) : [],
      ),
      updatedAt: a.updatedAt.toISOString(),
    };
  });
}

export function availableActions(state: ApplicationState): ApplicationAction[] {
  return (
    ["submit", "resubmit", "requestCorrection", "amendCorrection", "accept", "decline"] as ApplicationAction[]
  ).filter((a) => nextState(state, a) !== null);
}

// ------- Attachment metadata replacement -----------------------------------

export interface ReplaceMaterialInput {
  fieldKey: "identityProof" | "economicProof";
  kind: MaterialKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksum?: string | null;
  // Optional explicit metadata id; generated when omitted.
  materialId?: string;
}

export interface ReplaceMaterialResult {
  application: ApplicationView;
  material: MaterialMetadataView;
  replacedMaterialId: string | null;
}

/**
 * Replace the attachment metadata bound to a material field (identityProof or
 * economicProof). This writes ONLY metadata (never bytes): it creates a new
 * MaterialMetadata row, points the field at it via the field-merge path, and
 * detaches the previously referenced metadata. It never touches accommodation
 * fields, so a reasonable-accommodation need is preserved across a document swap.
 * Editable only in DRAFT / NEEDS_CORRECTION.
 */
export async function replaceMaterial(
  id: string,
  input: ReplaceMaterialInput,
): Promise<ReplaceMaterialResult> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({ where: { id }, include: { fields: true } });
    if (!app) throw notFound();
    const state = isApplicationState(app.state) ? app.state : "DRAFT";
    if (!canEditFields(state)) {
      throw new AppError("NOT_EDITABLE", `Materials cannot be replaced in state ${state}.`, 409, {
        state,
      });
    }

    const fieldMap = toFieldMap(app.fields);
    const previousRef = fieldMap.get(input.fieldKey)?.value ?? null;
    const previousId = typeof previousRef === "string" && previousRef.trim() !== "" ? previousRef : null;

    const newVersion = app.version + 1;
    const materialId = input.materialId ?? `MAT-${newApplicationId().slice(4)}-${Date.now().toString(36)}`;

    // Create the new metadata row (metadata only).
    const created = await tx.materialMetadata.create({
      data: {
        id: materialId,
        applicationId: id,
        kind: input.kind,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum ?? null,
      },
    });

    // Point the field at the new metadata id, bumping the field's version so a
    // concurrent stale edit to this field would three-way-conflict.
    await tx.applicationField.upsert({
      where: { applicationId_key: { applicationId: id, key: input.fieldKey } },
      create: {
        applicationId: id,
        key: input.fieldKey,
        value: materialId,
        updatedAtVersion: newVersion,
      },
      update: { value: materialId, updatedAtVersion: newVersion },
    });

    // Detach the previously referenced metadata (if any and now unreferenced).
    if (previousId && previousId !== materialId) {
      await tx.materialMetadata.updateMany({
        where: { id: previousId, applicationId: id },
        data: { applicationId: null },
      });
    }

    await tx.application.update({
      where: { id },
      data: {
        version: newVersion,
        events: {
          create: {
            fromState: state,
            toState: state,
            actor: "applicant",
            note: `material:replace:${input.fieldKey}`,
          },
        },
      },
    });

    return {
      application: await reloadWithinTx(tx, id),
      material: {
        id: created.id,
        kind: created.kind,
        filename: created.filename,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        uploadedAt: created.uploadedAt.toISOString(),
      },
      replacedMaterialId: previousId,
    };
  });
}
