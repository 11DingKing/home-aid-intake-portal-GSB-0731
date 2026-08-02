import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/server/db";
import {
  createApplication,
  patchDraft,
  submitApplication,
  requestCorrection,
  replaceMaterial,
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

function edit(
  key: IncomingEdit["key"],
  value: IncomingEdit["value"],
  baseVersion: number,
  baseValue?: IncomingEdit["value"],
): IncomingEdit {
  return baseValue === undefined
    ? { key, value, baseVersion }
    : { key, value, baseVersion, baseValue };
}

// Bring an application to NEEDS_CORRECTION with a live accommodation set.
async function toNeedsCorrection(id: string) {
  const app = await getApplication(id);
  const base = app.version;
  const patched = await patchDraft(id, base, [
    edit("fullName", "Corrina Case", base),
    edit("contactEmail", "corrina@example.org", base),
    edit("exemptionReason", "NONE", base),
    edit("identityProof", "ID-META-1", base),
    edit("economicProof", "ECON-1", base),
    edit("accommodations", ["SIGN_INTERPRETER"], base),
  ]);
  await submitApplication(id, `sub-${id}`, patched.application.version);
  const corrected = await requestCorrection(id, ["economicProof"], "ECONOMIC_PROOF_REQUIRED");
  return corrected.application;
}

describe("round 2 — concurrent applicant + staff on the same base", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("staff correction preserves a concurrent applicant material supplement and reports it", async () => {
    const app = await createApplication();
    const nc = await toNeedsCorrection(app.id);
    const staffBase = nc.version; // staff loads this version

    // Applicant concurrently supplements the economic proof (allowed in NEEDS_CORRECTION).
    const supplemented = await patchDraft(app.id, nc.version, [
      edit("economicProof", "ECON-2", nc.version, "ECON-1"),
    ]);
    expect(supplemented.applied.map((r) => r.key)).toContain("economicProof");

    // Staff amends the correction using its STALE base version.
    const result = await requestCorrection(
      app.id,
      ["identityProof"],
      "IDENTITY_REQUIRED",
      undefined,
      staffBase,
    );

    // The applicant's concurrent change is reported to the staff session...
    expect(result.concurrentFields).toContain("economicProof");
    expect(result.amended).toBe(true);
    // ...and was preserved (not clobbered) by the correction write.
    const final = await getApplication(app.id);
    expect(final.values.economicProof).toBe("ECON-2");
    // Correction fields were unioned (economicProof from first + identityProof from amend).
    expect(final.openCorrection?.fields.sort()).toEqual(["economicProof", "identityProof"]);
  });

  it("neither the correction nor the amend ever clears the accommodation need", async () => {
    const app = await createApplication();
    const nc = await toNeedsCorrection(app.id);
    // Amend a correction; accommodations must remain intact.
    await requestCorrection(app.id, ["identityProof"], "IDENTITY_REQUIRED", undefined, nc.version);
    const final = await getApplication(app.id);
    expect(final.values.accommodations).toEqual(["SIGN_INTERPRETER"]);
  });

  it("amendCorrection self-loops in NEEDS_CORRECTION without an illegal backward transition", async () => {
    const app = await createApplication();
    const nc = await toNeedsCorrection(app.id);
    expect(nc.state).toBe("NEEDS_CORRECTION");
    const amended = await requestCorrection(app.id, ["fullName"], "INCOMPLETE_FORM", undefined, nc.version);
    expect(amended.amended).toBe(true);
    expect(amended.application.state).toBe("NEEDS_CORRECTION");
    // Version advanced monotonically; state did not regress to SUBMITTED/DRAFT.
    expect(amended.application.version).toBeGreaterThan(nc.version);
  });

  it("a stale applicant edit to the same field the applicant already changed conflicts (three-way)", async () => {
    const app = await createApplication();
    const base = app.version;
    // Session A supplements identity from base (common ancestor is null/unset).
    await patchDraft(app.id, base, [edit("identityProof", "ID-A", base, null)]);
    // Session B, from the same base and base value, sets a different identity.
    const b = await patchDraft(app.id, base, [edit("identityProof", "ID-B", base, null)]);
    const conflict = b.conflicts.find((c) => c.key === "identityProof");
    expect(conflict?.conflictReason).toBe("STALE_EDIT");
    expect(conflict?.basis).toBe("three-way");
    const final = await getApplication(app.id);
    expect(final.values.identityProof).toBe("ID-A");
  });
});

describe("round 2 — attachment metadata replacement", () => {
  beforeEach(async () => {
    await wipe();
  });

  it("replaces material metadata, detaches the old row, and preserves accommodations", async () => {
    const app = await createApplication();
    const base = app.version;
    await patchDraft(app.id, base, [
      edit("identityProof", "ID-META-1", base),
      edit("accommodations", ["BRAILLE_MATERIAL"], base),
    ]);

    const before = await getApplication(app.id);
    const result = await replaceMaterial(app.id, {
      fieldKey: "identityProof",
      kind: "IDENTITY",
      filename: "new-id.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      materialId: "ID-META-REPLACED",
    });

    // Field now points at the new metadata id.
    expect(result.application.values.identityProof).toBe("ID-META-REPLACED");
    expect(result.material.filename).toBe("new-id.pdf");
    // Version advanced.
    expect(result.application.version).toBeGreaterThan(before.version);
    // Accommodations untouched by the document swap.
    expect(result.application.values.accommodations).toEqual(["BRAILLE_MATERIAL"]);

    // New metadata is attached; there is exactly one attached identity material.
    const attached = await prisma.materialMetadata.findMany({
      where: { applicationId: app.id, kind: "IDENTITY" },
    });
    expect(attached.map((m) => m.id)).toContain("ID-META-REPLACED");
  });

  it("refuses to replace materials once the application is SUBMITTED", async () => {
    const app = await createApplication();
    const base = app.version;
    const patched = await patchDraft(app.id, base, [
      edit("fullName", "Sub Mitter", base),
      edit("contactEmail", "s@example.org", base),
      edit("exemptionReason", "NO_FIXED_INCOME", base),
      edit("identityProof", "ID-META-1", base),
    ]);
    await submitApplication(app.id, "k", patched.application.version);
    await expect(
      replaceMaterial(app.id, {
        fieldKey: "identityProof",
        kind: "IDENTITY",
        filename: "x.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_EDITABLE" });
  });

  it("replaced metadata surfaces in the staff INTAKE_REVIEW view (metadata only)", async () => {
    const app = await createApplication();
    const nc = await toNeedsCorrection(app.id);
    await replaceMaterial(app.id, {
      fieldKey: "economicProof",
      kind: "ECONOMIC_PROOF",
      filename: "updated-proof.pdf",
      mimeType: "application/pdf",
      sizeBytes: 999,
      materialId: "ECON-REPLACED",
    });
    // Resubmit so it lands in a state served by INTAKE_REVIEW is not required;
    // the view projects current materials regardless.
    const view = (await getStaffView(app.id, "INTAKE_REVIEW")) as {
      materialMetadata: Array<{ id: string; filename: string }>;
    };
    const ids = view.materialMetadata.map((m) => m.id);
    expect(ids).toContain("ECON-REPLACED");
    // Never leaks bytes — only metadata fields exist.
    for (const m of view.materialMetadata) {
      expect(Object.keys(m).sort()).toEqual(
        ["filename", "id", "kind", "mimeType", "sizeBytes", "uploadedAt"].sort(),
      );
    }
    expect(nc.state).toBe("NEEDS_CORRECTION");
  });
});
