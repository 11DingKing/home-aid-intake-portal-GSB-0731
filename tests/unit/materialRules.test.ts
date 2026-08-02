import { describe, it, expect } from "vitest";
import {
  economicProofRequired,
  materialRequirements,
  missingRequiredMaterials,
} from "@/domain/materialRules";

describe("material rules — economic proof exemption", () => {
  it("waives economic proof for NO_FIXED_INCOME (core accessibility rule)", () => {
    expect(economicProofRequired("NO_FIXED_INCOME")).toBe(false);
    const reqs = materialRequirements("NO_FIXED_INCOME");
    const economic = reqs.find((r) => r.kind === "ECONOMIC_PROOF");
    expect(economic?.required).toBe(false);
    expect(economic?.waivedReason).toBe("EXEMPT_NO_FIXED_INCOME");
  });

  it("waives economic proof for NOTIFIED_CRIMINAL_DEFENSE", () => {
    expect(economicProofRequired("NOTIFIED_CRIMINAL_DEFENSE")).toBe(false);
  });

  it("requires economic proof for NONE", () => {
    expect(economicProofRequired("NONE")).toBe(true);
    const economic = materialRequirements("NONE").find((r) => r.kind === "ECONOMIC_PROOF");
    expect(economic?.required).toBe(true);
    expect(economic?.waivedReason).toBeUndefined();
  });

  it("always requires identity proof regardless of exemption", () => {
    for (const reason of ["NO_FIXED_INCOME", "NOTIFIED_CRIMINAL_DEFENSE", "NONE"] as const) {
      const id = materialRequirements(reason).find((r) => r.kind === "IDENTITY");
      expect(id?.required).toBe(true);
    }
  });

  it("does NOT list economic proof as missing for NO_FIXED_INCOME even when absent", () => {
    // Applicant has identity but no economic proof.
    const has = (key: string) => key === "identityProof";
    const missing = missingRequiredMaterials("NO_FIXED_INCOME", has);
    expect(missing.map((m) => m.kind)).not.toContain("ECONOMIC_PROOF");
    expect(missing).toHaveLength(0);
  });

  it("lists economic proof as missing for NONE when absent", () => {
    const has = (key: string) => key === "identityProof";
    const missing = missingRequiredMaterials("NONE", has);
    expect(missing.map((m) => m.kind)).toContain("ECONOMIC_PROOF");
  });

  it("lists identity as missing when absent for any reason", () => {
    const has = () => false;
    const missing = missingRequiredMaterials("NO_FIXED_INCOME", has);
    expect(missing.map((m) => m.kind)).toEqual(["IDENTITY"]);
  });
});
