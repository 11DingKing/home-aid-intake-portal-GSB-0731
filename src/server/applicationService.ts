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
  type ApplicantFieldKey,
  type ApplicationState,
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

export interface DraftPatchResult {
  application: ApplicationView;
  applied: FieldMergeResult[];
  conflicts: FieldMergeResult[];
}

export async function patchDraft(
  id: string,
  baseVersion: number,
  edits: IncomingEdit[],
): Promise<DraftPatchResult> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({
      where: { id },
      include: { fields: true },
    });
    if (!app) throw notFound();
    const state = isApplicationState(app.state) ? app.state : "DRAFT";
    if (!canEditFields(state)) {
      throw new AppError("NOT_EDITABLE", `Draft is not editable in state ${state}.`, 409, {
        state,
      });
    }

    const storedMap = toFieldMap(app.fields);
    const outcome = mergeFields(storedMap, edits);

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

export async function requestCorrection(
  id: string,
  fields: string[],
  reasonCode: string,
  note?: string,
): Promise<ApplicationView> {
  return prisma.$transaction(async (tx) => {
    const app = await tx.application.findUnique({ where: { id } });
    if (!app) throw notFound();
    const state = isApplicationState(app.state) ? app.state : "DRAFT";
    const toState = assertTransition(state, "requestCorrection");
    await tx.application.update({
      where: { id },
      data: {
        state: toState,
        version: app.version + 1,
        events: {
          create: { fromState: state, toState, actor: "staff", note: reasonCode },
        },
      },
    });
    await tx.correction.create({
      data: {
        applicationId: id,
        fields: JSON.stringify(fields),
        reasonCode,
        note: note ?? null,
      },
    });
    return reloadWithinTx(tx, id);
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
  return (["submit", "resubmit", "requestCorrection", "accept", "decline"] as ApplicationAction[]).filter(
    (a) => nextState(state, a) !== null,
  );
}
