import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/server/db";
import {
  createApplication,
  patchDraft,
  submitApplication,
  requestCorrection,
  getApplication,
  getStaffContinuation,
  getApplicantContinuation,
  getAuditTrail,
} from "@/server/applicationService";
import type { IncomingEdit } from "@/domain/merge";

async function wipe() {
  await prisma.auditLog.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.applicationEvent.deleteMany();
  await prisma.correction.deleteMany();
  await prisma.applicationField.deleteMany();
  await prisma.materialMetadata.deleteMany();
  await prisma.application.deleteMany();
}

function edit(key: string, value: IncomingEdit["value"], baseVersion: number): IncomingEdit {
  return { key: key as IncomingEdit["key"], value, baseVersion };
}

async function fillValid(id: string, reason: string, opts: { economicProof?: string } = {}) {
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

describe("write policy enforcement + audit", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("drops an out-of-step edit before persistence and audits the reason", async () => {
    const app = await createApplication();
    const base = app.version;
    // On the 'contact' step, exemptionReason is not writable.
    const result = await patchDraft(
      app.id,
      base,
      [edit("fullName", "Robin", base), edit("exemptionReason", "NONE", base)],
      "contact",
    );
    // Only the in-step field is applied.
    expect(result.applied.map((r) => r.key)).toEqual(["fullName"]);
    expect(result.denied).toContainEqual({
      key: "exemptionReason",
      reasonCode: "NOT_IN_STEP_WHITELIST",
    });
    // The rejected value never reached persistence.
    const final = await getApplication(app.id);
    expect(final.values.exemptionReason ?? "").toBe("");
    expect(final.values.fullName).toBe("Robin");

    // Audit trail records the PARTIAL decision with the denied field + reason.
    const trail = await getAuditTrail(app.id);
    const writeEntry = trail.find((e) => e.action === "draft.write");
    expect(writeEntry?.decision).toBe("PARTIAL");
    expect(writeEntry?.deniedFields).toContain("exemptionReason");
    expect(writeEntry?.reasonCode).toBe("NOT_IN_STEP_WHITELIST");
  });

  it("rejects a maliciously crafted hidden/unknown field and audits it", async () => {
    const app = await createApplication();
    const base = app.version;
    const result = await patchDraft(
      app.id,
      base,
      [edit("isAdmin", "true", base), edit("fullName", "Legit", base)],
      "contact",
    );
    expect(result.applied.map((r) => r.key)).toEqual(["fullName"]);
    expect(result.denied).toContainEqual({ key: "isAdmin", reasonCode: "UNKNOWN_FIELD" });

    // The crafted key must not exist as a persisted field.
    const rows = await prisma.applicationField.findMany({ where: { applicationId: app.id } });
    expect(rows.map((r) => r.key)).not.toContain("isAdmin");

    const trail = await getAuditTrail(app.id);
    expect(trail.some((e) => e.deniedFields.includes("isAdmin"))).toBe(true);
  });

  it("audits a fully-denied write against a non-editable state and never persists", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    await submitApplication(app.id, "k1", patched.application.version);

    await expect(
      patchDraft(app.id, patched.application.version + 1, [edit("fullName", "X", 0)], "contact"),
    ).rejects.toMatchObject({ code: "NOT_EDITABLE" });

    const trail = await getAuditTrail(app.id);
    const deny = trail.find((e) => e.action === "draft.write" && e.decision === "DENY");
    expect(deny?.reasonCode).toBe("NOT_WRITABLE_IN_STATE");
    expect(deny?.deniedFields).toContain("fullName");
  });

  it("a full ALLOW write records the applied fields and no denials", async () => {
    const app = await createApplication();
    const base = app.version;
    const result = await patchDraft(app.id, base, [edit("fullName", "Ok", base)], "contact");
    expect(result.denied).toEqual([]);
    const trail = await getAuditTrail(app.id);
    const entry = trail.find((e) => e.action === "draft.write");
    expect(entry?.decision).toBe("ALLOW");
    expect(entry?.allowedFields).toContain("fullName");
  });
});

describe("staff continuation — server recomputes disclosure from current state", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("never discloses PII, in any state/view combination", async () => {
    const app = await createApplication();
    await fillValid(app.id, "NO_FIXED_INCOME");
    for (const requested of ["INTAKE_REVIEW", "CORRECTION_REVIEW", "bogus", null]) {
      const c = await getStaffContinuation(app.id, requested);
      expect(c.disclosed).not.toHaveProperty("fullName");
      expect(c.disclosed).not.toHaveProperty("contactPhone");
      expect(c.disclosed).not.toHaveProperty("contactEmail");
    }
  });

  it("downgrades a stale CORRECTION_REVIEW link when the app is back to a non-correction state", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE", { economicProof: "ECON-1" });
    await submitApplication(app.id, "s1", patched.application.version);
    // App is SUBMITTED -> enforced view is INTAKE_REVIEW. A stale link asks for
    // the broader CORRECTION_REVIEW; it must be downgraded and audited.
    const c = await getStaffContinuation(app.id, "CORRECTION_REVIEW");
    expect(c.enforcedView).toBe("INTAKE_REVIEW");
    expect(c.requestedView).toBe("CORRECTION_REVIEW");
    expect(c.downgraded).toBe(true);
    // Body only carries intake-view fields.
    expect(c.disclosed).not.toHaveProperty("correctionFields");

    const trail = await getAuditTrail(app.id);
    const read = trail.find(
      (e) => e.action === "continuation.read" && e.reasonCode === "STALE_VIEW_DOWNGRADED",
    );
    expect(read?.decision).toBe("PARTIAL");
    // The fields the broader view would have exposed are recorded as denied.
    expect(read?.deniedFields.length).toBeGreaterThan(0);
  });

  it("serves the correction view (no downgrade) once the app is in NEEDS_CORRECTION", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE", { economicProof: "ECON-1" });
    await submitApplication(app.id, "s1", patched.application.version);
    await requestCorrection(app.id, ["economicProof"], "ECONOMIC_PROOF_REQUIRED");
    const c = await getStaffContinuation(app.id, "CORRECTION_REVIEW");
    expect(c.enforcedView).toBe("CORRECTION_REVIEW");
    expect(c.downgraded).toBe(false);
    expect(c.disclosed).toHaveProperty("correctionFields");
  });

  it("resubmission returns to intake enforcement, downgrading a lingering correction link", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE", { economicProof: "ECON-1" });
    await submitApplication(app.id, "s1", patched.application.version);
    await requestCorrection(app.id, ["economicProof"], "ECONOMIC_PROOF_REQUIRED");
    const corrected = await getApplication(app.id);
    const fixed = await patchDraft(
      app.id,
      corrected.version,
      [edit("economicProof", "ECON-2", corrected.version)],
      "materials",
    );
    const resubmitted = await submitApplication(app.id, "rs1", fixed.application.version);
    expect(resubmitted.application.state).toBe("RESUBMITTED");
    // RESUBMITTED still maps to the correction step (staffStepForState), so a
    // correction link is honored, but an intake link is the "narrow" one.
    const c = await getStaffContinuation(app.id, "CORRECTION_REVIEW");
    expect(c.enforcedView).toBe("CORRECTION_REVIEW");
    expect(c.downgraded).toBe(false);
  });
});

describe("applicant continuation — step-scoped minimal fields", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("returns only the requested step's fields (never other steps)", async () => {
    const app = await createApplication();
    await fillValid(app.id, "NO_FIXED_INCOME");
    const materials = await getApplicantContinuation(app.id, "materials");
    expect(Object.keys(materials.fields).sort()).toEqual(["economicProof", "identityProof"]);
    // PII from the contact step is not in the materials payload at all.
    expect(materials.fields).not.toHaveProperty("fullName");
    expect(materials.writable).toEqual(["economicProof", "identityProof"]);
  });

  it("coerces an unknown/crafted step to review and audits the read", async () => {
    const app = await createApplication();
    await fillValid(app.id, "NO_FIXED_INCOME");
    const c = await getApplicantContinuation(app.id, "__proto__");
    expect(c.step).toBe("review");
    const trail = await getAuditTrail(app.id);
    const read = trail.find((e) => e.actorRole === "applicant" && e.action === "continuation.read");
    expect(read?.decision).toBe("ALLOW");
    expect(read?.note).toBe("step=review");
  });

  it("marks fields read-only (empty writable) once submitted", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NO_FIXED_INCOME");
    await submitApplication(app.id, "k", patched.application.version);
    const c = await getApplicantContinuation(app.id, "accommodations");
    expect(c.writable).toEqual([]);
    // Accommodation values are still readable so the applicant sees their request.
    expect(c.fields).toHaveProperty("accommodations");
  });
});

describe("accommodation preservation under correction (never overwritten)", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("staff correction leaves the applicant's accommodation intact", async () => {
    const app = await createApplication();
    const patched = await fillValid(app.id, "NONE", { economicProof: "ECON-1" });
    await submitApplication(app.id, "s1", patched.application.version);
    await requestCorrection(app.id, ["economicProof"], "ECONOMIC_PROOF_REQUIRED", "reupload");
    const after = await getApplication(app.id);
    expect(after.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
  });
});
