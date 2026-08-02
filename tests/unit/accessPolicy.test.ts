import { describe, it, expect } from "vitest";
import {
  applicantFieldPolicy,
  staffFieldPolicy,
  staffStepForState,
  coerceApplicantStep,
  evaluateWrites,
  fieldPolicy,
  isStaffOverPrivileged,
  alwaysForbiddenForStaff,
  APPLICANT_PII_FIELDS,
} from "@/domain/accessPolicy";
import type { ApplicationState } from "@/domain/constants";

describe("accessPolicy — applicant field policy (least privilege per step)", () => {
  it("exposes only the current step's fields as readable/writable in DRAFT", () => {
    const contact = applicantFieldPolicy("DRAFT", "contact");
    expect(contact.readable).toEqual(["fullName", "contactPhone", "contactEmail"]);
    expect(contact.writable).toEqual(["fullName", "contactPhone", "contactEmail"]);

    const materials = applicantFieldPolicy("DRAFT", "materials");
    expect(materials.readable).toEqual(["economicProof", "identityProof"]);
    // Contact PII is NOT part of the materials step surface.
    expect(materials.readable).not.toContain("fullName");
    expect(materials.writable).not.toContain("fullName");
  });

  it("keeps accommodation fields on their own step", () => {
    const acc = applicantFieldPolicy("NEEDS_CORRECTION", "accommodations");
    expect(acc.readable).toEqual(["accommodations", "accommodationNote"]);
    expect(acc.writable).toEqual(["accommodations", "accommodationNote"]);
  });

  it("review step can read every field for final confirmation", () => {
    const review = applicantFieldPolicy("DRAFT", "review");
    expect(review.readable).toEqual([
      "fullName",
      "contactPhone",
      "contactEmail",
      "exemptionReason",
      "economicProof",
      "identityProof",
      "accommodations",
      "accommodationNote",
    ]);
  });

  it.each<ApplicationState>(["SUBMITTED", "RESUBMITTED", "ACCEPTED", "DECLINED"])(
    "makes fields read-only (empty writable) in non-editable state %s",
    (state) => {
      const p = applicantFieldPolicy(state, "review");
      expect(p.writable).toEqual([]);
      // Still readable so the applicant can view the submitted values.
      expect(p.readable.length).toBeGreaterThan(0);
    },
  );

  it("allows writes only in DRAFT and NEEDS_CORRECTION", () => {
    expect(applicantFieldPolicy("DRAFT", "contact").writable.length).toBeGreaterThan(0);
    expect(applicantFieldPolicy("NEEDS_CORRECTION", "contact").writable.length).toBeGreaterThan(0);
    expect(applicantFieldPolicy("SUBMITTED", "contact").writable).toEqual([]);
  });
});

describe("accessPolicy — staff field policy never exposes PII and never writes", () => {
  it.each<ApplicationState>(["SUBMITTED", "NEEDS_CORRECTION", "RESUBMITTED"])(
    "excludes applicant PII from staff readable set in state %s",
    (state) => {
      const p = staffFieldPolicy(state, staffStepForState(state));
      for (const pii of APPLICANT_PII_FIELDS) {
        expect(p.readable).not.toContain(pii);
      }
      // Staff never write applicant fields via the field path.
      expect(p.writable).toEqual([]);
    },
  );

  it("staff can read accommodations (to honor them) but never write them", () => {
    const p = staffFieldPolicy("NEEDS_CORRECTION", "correction");
    expect(p.readable).toContain("accommodations");
    expect(p.writable).toEqual([]);
  });
});

describe("accessPolicy — staff step is chosen from state (stale link cannot widen)", () => {
  it("maps correction states to the correction step, others to intake", () => {
    expect(staffStepForState("NEEDS_CORRECTION")).toBe("correction");
    expect(staffStepForState("RESUBMITTED")).toBe("correction");
    expect(staffStepForState("SUBMITTED")).toBe("intake");
    expect(staffStepForState("DRAFT")).toBe("intake");
    expect(staffStepForState("ACCEPTED")).toBe("intake");
  });
});

describe("accessPolicy — coerceApplicantStep normalizes untrusted input", () => {
  it("defaults unknown/blank/crafted steps to review", () => {
    expect(coerceApplicantStep(undefined)).toBe("review");
    expect(coerceApplicantStep(null)).toBe("review");
    expect(coerceApplicantStep("")).toBe("review");
    expect(coerceApplicantStep("__proto__")).toBe("review");
    expect(coerceApplicantStep("contact")).toBe("contact");
  });
});

describe("accessPolicy — evaluateWrites classifies every requested key with a reason", () => {
  it("allows only in-step writable fields", () => {
    const policy = applicantFieldPolicy("DRAFT", "contact");
    const { allowedKeys, denied } = evaluateWrites(policy, ["fullName", "contactEmail"]);
    expect(allowedKeys).toEqual(["fullName", "contactEmail"]);
    expect(denied).toEqual([]);
  });

  it("rejects an unknown/crafted key as UNKNOWN_FIELD", () => {
    const policy = applicantFieldPolicy("DRAFT", "contact");
    const { allowedKeys, denied } = evaluateWrites(policy, ["isAdmin", "fullName"]);
    expect(allowedKeys).toEqual(["fullName"]);
    expect(denied).toContainEqual({ key: "isAdmin", allowed: false, reasonCode: "UNKNOWN_FIELD" });
  });

  it("rejects a known but out-of-step field as NOT_IN_STEP_WHITELIST", () => {
    // On the contact step, exemptionReason is a known field but not writable here.
    const policy = applicantFieldPolicy("DRAFT", "contact");
    const { allowedKeys, denied } = evaluateWrites(policy, ["exemptionReason"]);
    expect(allowedKeys).toEqual([]);
    expect(denied).toContainEqual({
      key: "exemptionReason",
      allowed: false,
      reasonCode: "NOT_IN_STEP_WHITELIST",
    });
  });

  it("rejects all writes as NOT_WRITABLE_IN_STATE in a non-editable state", () => {
    const policy = applicantFieldPolicy("SUBMITTED", "review");
    const { allowedKeys, denied } = evaluateWrites(policy, ["fullName", "accommodations"]);
    expect(allowedKeys).toEqual([]);
    expect(denied.map((d) => d.reasonCode)).toEqual([
      "NOT_WRITABLE_IN_STATE",
      "NOT_WRITABLE_IN_STATE",
    ]);
  });

  it("rejects any applicant-field write for a staff policy as ROLE_NOT_PERMITTED", () => {
    const policy = staffFieldPolicy("NEEDS_CORRECTION", "correction");
    const { allowedKeys, denied } = evaluateWrites(policy, ["accommodations", "exemptionReason"]);
    expect(allowedKeys).toEqual([]);
    expect(denied.map((d) => d.reasonCode)).toEqual([
      "ROLE_NOT_PERMITTED",
      "ROLE_NOT_PERMITTED",
    ]);
  });
});

describe("accessPolicy — read-time over-privilege helpers", () => {
  it("flags PII and non-readable fields as over-privileged for staff", () => {
    expect(isStaffOverPrivileged("SUBMITTED", "fullName")).toBe(true);
    expect(isStaffOverPrivileged("SUBMITTED", "contactEmail")).toBe(true);
    // exemptionReason is readable in intake, so not over-privileged there.
    expect(isStaffOverPrivileged("SUBMITTED", "exemptionReason")).toBe(false);
  });

  it("lists PII as always forbidden for staff", () => {
    expect(alwaysForbiddenForStaff()).toEqual(["fullName", "contactPhone", "contactEmail"]);
  });
});

describe("accessPolicy — fieldPolicy dispatch by role", () => {
  it("routes staff through the state-derived step regardless of requested step", () => {
    const p = fieldPolicy("staff", "NEEDS_CORRECTION", "anything");
    expect(p.role).toBe("staff");
    expect(p.writable).toEqual([]);
    for (const pii of APPLICANT_PII_FIELDS) expect(p.readable).not.toContain(pii);
  });

  it("routes applicant through the coerced step", () => {
    const p = fieldPolicy("applicant", "DRAFT", "materials");
    expect(p.role).toBe("applicant");
    expect(p.readable).toEqual(["economicProof", "identityProof"]);
  });
});
