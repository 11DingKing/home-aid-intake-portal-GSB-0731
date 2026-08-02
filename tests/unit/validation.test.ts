import { describe, it, expect } from "vitest";
import { validateForSubmission } from "@/domain/validation";

describe("validateForSubmission", () => {
  const base = {
    fullName: "Jamie Rivera",
    contactEmail: "jamie@example.org",
    identityProof: "ID-META-1",
  };

  it("passes a NO_FIXED_INCOME application without economic proof", () => {
    const errs = validateForSubmission({
      ...base,
      exemptionReason: "NO_FIXED_INCOME",
      economicProof: "",
    });
    expect(errs).toHaveLength(0);
  });

  it("blocks a NONE application missing economic proof", () => {
    const errs = validateForSubmission({
      ...base,
      exemptionReason: "NONE",
      economicProof: "",
    });
    const economic = errs.find((e) => e.field === "economicProof");
    expect(economic?.code).toBe("MATERIAL_REQUIRED");
  });

  it("requires a name", () => {
    const errs = validateForSubmission({
      exemptionReason: "NO_FIXED_INCOME",
      identityProof: "ID-META-1",
      contactEmail: "a@b.org",
    });
    expect(errs.some((e) => e.field === "fullName" && e.code === "REQUIRED")).toBe(true);
  });

  it("requires a contact channel", () => {
    const errs = validateForSubmission({
      fullName: "No Contact",
      exemptionReason: "NO_FIXED_INCOME",
      identityProof: "ID-META-1",
      contactEmail: "",
      contactPhone: "",
    });
    expect(errs.some((e) => e.code === "CONTACT_REQUIRED")).toBe(true);
  });

  it("always requires identity proof", () => {
    const errs = validateForSubmission({
      fullName: "No Id",
      exemptionReason: "NO_FIXED_INCOME",
      contactEmail: "a@b.org",
      identityProof: "",
    });
    expect(errs.some((e) => e.field === "identityProof" && e.code === "MATERIAL_REQUIRED")).toBe(true);
  });

  it("rejects a malformed email", () => {
    const errs = validateForSubmission({
      ...base,
      exemptionReason: "NO_FIXED_INCOME",
      contactEmail: "not-an-email",
    });
    expect(errs.some((e) => e.field === "contactEmail" && e.code === "INVALID")).toBe(true);
  });

  it("every error carries a machine-readable code and message", () => {
    const errs = validateForSubmission({ exemptionReason: "NONE" });
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) {
      expect(e.code).toBeTruthy();
      expect(e.message).toBeTruthy();
      expect(e.field).toBeTruthy();
    }
  });
});
