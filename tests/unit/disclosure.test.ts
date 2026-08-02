import { describe, it, expect } from "vitest";
import {
  projectForStaff,
  disallowedKeysForView,
  type FullApplicationProjection,
} from "@/domain/disclosure";
import { STAFF_VIEWS } from "@/domain/constants";

const full: FullApplicationProjection = {
  id: "APP-201",
  state: "SUBMITTED",
  exemptionReason: "NO_FIXED_INCOME",
  accommodations: ["HOME_VISIT_NEEDED"],
  accommodationNote: "Third floor, no lift",
  correctionFields: ["economicProof"],
  materialMetadata: [
    { id: "ID-META-1", kind: "IDENTITY", filename: "id.pdf", mimeType: "application/pdf", sizeBytes: 100, uploadedAt: "2026-01-01T00:00:00.000Z" },
  ],
  submittedFieldMetadata: [{ key: "fullName", present: true, updatedAtVersion: 1 }],
  fullName: "Sensitive Name",
  contactPhone: "555-0100",
  contactEmail: "secret@example.org",
};

describe("staff disclosure projection (least privilege)", () => {
  it("INTAKE_REVIEW exposes only its whitelisted keys", () => {
    const view = projectForStaff("INTAKE_REVIEW", full);
    const keys = Object.keys(view).filter((k) => k !== "__view");
    expect(keys.sort()).toEqual([...STAFF_VIEWS.INTAKE_REVIEW].sort());
  });

  it("CORRECTION_REVIEW exposes only its whitelisted keys", () => {
    const view = projectForStaff("CORRECTION_REVIEW", full);
    const keys = Object.keys(view).filter((k) => k !== "__view");
    expect(keys.sort()).toEqual([...STAFF_VIEWS.CORRECTION_REVIEW].sort());
  });

  it("never leaks applicant PII into either view", () => {
    for (const viewName of ["INTAKE_REVIEW", "CORRECTION_REVIEW"] as const) {
      const view = projectForStaff(viewName, full) as Record<string, unknown>;
      for (const forbidden of disallowedKeysForView(viewName)) {
        expect(view).not.toHaveProperty(forbidden);
      }
      // Concretely: sensitive values must be absent.
      expect(Object.values(view)).not.toContain("Sensitive Name");
      expect(Object.values(view)).not.toContain("secret@example.org");
      expect(Object.values(view)).not.toContain("555-0100");
    }
  });

  it("INTAKE_REVIEW does not expose correction-only fields", () => {
    const view = projectForStaff("INTAKE_REVIEW", full);
    expect(view).not.toHaveProperty("correctionFields");
    expect(view).not.toHaveProperty("submittedFieldMetadata");
  });

  it("CORRECTION_REVIEW does not expose intake-only material metadata", () => {
    const view = projectForStaff("CORRECTION_REVIEW", full);
    expect(view).not.toHaveProperty("materialMetadata");
    expect(view).not.toHaveProperty("accommodations");
  });
});
