import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/server/db";
import {
  createApplication,
  patchDraft,
  submitApplication,
  requestCorrection,
  staffDecision,
  getApplication,
  getStaffView,
} from "@/server/applicationService";
import type { IncomingEdit } from "@/domain/merge";

async function wipe() {
  await prisma.idempotencyKey.deleteMany();
  await prisma.applicationEvent.deleteMany();
  await prisma.correction.deleteMany();
  await prisma.applicationField.deleteMany();
  await prisma.materialMetadata.deleteMany();
  await prisma.application.deleteMany();
}

function edit(key: IncomingEdit["key"], value: IncomingEdit["value"], baseVersion: number): IncomingEdit {
  return { key, value, baseVersion };
}

async function fillValid(id: string, reason: string, opts: { economicProof?: string } = {}) {
  // Load current version, then patch all required fields.
  const app = await getApplication(id);
  const edits: IncomingEdit[] = [
    edit("fullName", "Jamie Rivera", app.version),
    edit("contactEmail", "jamie@example.org", app.version),
    edit("exemptionReason", reason, app.version),
    edit("identityProof", "ID-META-1", app.version),
    edit("accommodations", ["HOME_VISIT_NEEDED"], app.version),
  ];
  if (opts.economicProof) edits.push(edit("economicProof", opts.economicProof, app.version));
  return patchDraft(id, app.version, edits);
}

describe("application service lifecycle", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("creates a DRAFT application at version 0", async () => {
    const app = await createApplication();
    expect(app.state).toBe("DRAFT");
    expect(app.version).toBe(0);
    expect(app.id).toMatch(/^APP-\d{6}$/);
  });

  it("submits a NO_FIXED_INCOME application with no economic proof", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    const result = await submitApplication(app.id, "key-1", patched.application.version);
    expect(result.replayed).toBe(false);
    expect(result.application.state).toBe("SUBMITTED");
  });

  it("blocks submission of a NONE application without economic proof", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE");
    await expect(
      submitApplication(app.id, "key-2", patched.application.version),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("is idempotent: a duplicate final submit replays, not re-transitions", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    const v = patched.application.version;
    const first = await submitApplication(app.id, "dupe-key", v);
    const second = await submitApplication(app.id, "dupe-key", v);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    // Same resulting version; no second state bump.
    expect(second.application.version).toBe(first.application.version);
    expect(second.application.state).toBe("SUBMITTED");
    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: app.id, toState: "SUBMITTED" },
    });
    expect(events).toHaveLength(1);
  });

  it("rejects a stale-version submit with VERSION_CONFLICT", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    const stale = patched.application.version - 1;
    await expect(submitApplication(app.id, "key-3", stale)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });

  it("runs the correction -> resubmit loop and converges by id + version", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE", { economicProof: "" });
    // Missing economic proof: staff requests correction after we force a submit
    // path by first supplying economic proof, submitting, then flagging it.
    const withProof = await patchDraft(app.id, patched.application.version, [
      edit("economicProof", "ECON-1", patched.application.version),
    ]);
    const submitted = await submitApplication(app.id, "sub-1", withProof.application.version);
    expect(submitted.application.state).toBe("SUBMITTED");

    const corrected = await requestCorrection(
      app.id,
      ["economicProof"],
      "ECONOMIC_PROOF_REQUIRED",
      "Please re-upload",
    );
    expect(corrected.application.state).toBe("NEEDS_CORRECTION");
    expect(corrected.application.openCorrection?.fields).toEqual(["economicProof"]);

    // Applicant edits the flagged field then resubmits.
    const fixed = await patchDraft(app.id, corrected.application.version, [
      edit("economicProof", "ECON-2", corrected.application.version),
    ]);
    const resubmitted = await submitApplication(app.id, "resub-1", fixed.application.version);
    expect(resubmitted.application.state).toBe("RESUBMITTED");
    // Open correction resolved.
    expect(resubmitted.application.openCorrection).toBeNull();
  });

  it("field-level merge: concurrent edits to different fields both apply", async () => {
    const app = await createApplication();
    const base = app.version;
    // Session A edits fullName from base.
    const a = await patchDraft(app.id, base, [edit("fullName", "Session A", base)]);
    expect(a.applied.map((x) => x.key)).toContain("fullName");
    // Session B edits contactPhone from the SAME original base (stale overall
    // version, but a different field) — should still apply.
    const b = await patchDraft(app.id, base, [edit("contactPhone", "555-0100", base)]);
    expect(b.applied.map((x) => x.key)).toContain("contactPhone");
    const final = await getApplication(app.id);
    expect(final.values.fullName).toBe("Session A");
    expect(final.values.contactPhone).toBe("555-0100");
  });

  it("field-level merge: same-field divergent edits produce a conflict", async () => {
    const app = await createApplication();
    const base = app.version;
    await patchDraft(app.id, base, [edit("fullName", "Server Wins", base)]);
    // Stale session edits the same field from the old base.
    const stale = await patchDraft(app.id, base, [edit("fullName", "Client Loses", base)]);
    expect(stale.conflicts.map((c) => c.key)).toContain("fullName");
    const final = await getApplication(app.id);
    expect(final.values.fullName).toBe("Server Wins");
  });

  it("stale draft cannot clear a live accommodation request", async () => {
    const app = await createApplication();
    const base = app.version;
    const set = await patchDraft(app.id, base, [
      edit("accommodations", ["HOME_VISIT_NEEDED"], base),
    ]);
    const afterVersion = set.application.version;
    // Stale session (still at base) tries to clear accommodations.
    const stale = await patchDraft(app.id, base, [edit("accommodations", [], base)]);
    const conflict = stale.conflicts.find((c) => c.key === "accommodations");
    expect(conflict?.conflictReason).toBe("PROTECTED_ACCOMMODATION");
    const final = await getApplication(app.id);
    expect(final.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
    expect(afterVersion).toBeGreaterThan(base);
  });

  it("does not allow editing fields once SUBMITTED", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    await submitApplication(app.id, "k", patched.application.version);
    await expect(
      patchDraft(app.id, patched.application.version + 1, [edit("fullName", "X", 0)]),
    ).rejects.toMatchObject({ code: "NOT_EDITABLE" });
  });

  it("staff decision accept/decline enforces the state machine", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    await submitApplication(app.id, "k", patched.application.version);
    const accepted = await staffDecision(app.id, "accept");
    expect(accepted.state).toBe("ACCEPTED");
    // Terminal: cannot decline afterward.
    await expect(staffDecision(app.id, "decline")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

describe("staff disclosure via service", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("INTAKE_REVIEW omits PII and correction-only fields", async () => {
    const app = await createApplication();
    await fillValid(app.id, "NO_FIXED_INCOME");
    const view = (await getStaffView(app.id, "INTAKE_REVIEW")) as Record<string, unknown>;
    expect(view).toHaveProperty("exemptionReason", "NO_FIXED_INCOME");
    expect(view).toHaveProperty("accommodations");
    expect(view).not.toHaveProperty("fullName");
    expect(view).not.toHaveProperty("contactEmail");
    expect(view).not.toHaveProperty("correctionFields");
  });

  it("CORRECTION_REVIEW exposes correction fields but not raw PII", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE", { economicProof: "ECON-1" });
    await submitApplication(app.id, "k", patched.application.version);
    await requestCorrection(app.id, ["economicProof"], "ECONOMIC_PROOF_REQUIRED");
    const view = (await getStaffView(app.id, "CORRECTION_REVIEW")) as Record<string, unknown>;
    expect(view).toHaveProperty("correctionFields", ["economicProof"]);
    expect(view).toHaveProperty("submittedFieldMetadata");
    expect(view).not.toHaveProperty("fullName");
    expect(view).not.toHaveProperty("contactEmail");
    expect(view).not.toHaveProperty("materialMetadata");
  });
});
