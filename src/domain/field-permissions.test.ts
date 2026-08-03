import { describe, it, expect } from "vitest";
import {
  getFieldsForApplicantStep,
  getStaffVisibleFields,
  getStaffViewForState,
  getApplicantAccessibleSteps,
  validateClientMutation,
  validateStaffMutation,
  getStaleLinkState,
  projectDataForRole,
} from "@/domain/field-permissions";

describe("field permissions - applicant step access", () => {
  it("DRAFT state allows access to all steps up to current", () => {
    const steps = getApplicantAccessibleSteps("DRAFT");
    expect(steps[0].accessible).toBe(true);
    expect(steps[5].stepId).toBe("review");
  });

  it("NEEDS_CORRECTION allows editing", () => {
    const steps = getApplicantAccessibleSteps("NEEDS_CORRECTION");
    expect(steps[0].accessible).toBe(true);
  });

  it("SUBMITTED allows viewing but not editing", () => {
    const access = getFieldsForApplicantStep("SUBMITTED", "personal");
    expect(access.editable).toHaveLength(0);
    expect(access.allReadable).toContain("fullName");
  });

  it("ACCEPTED is terminal and not editable", () => {
    const access = getFieldsForApplicantStep("ACCEPTED", "personal");
    expect(access.editable).toHaveLength(0);
  });
});

describe("field permissions - applicant step fields", () => {
  it("personal step only exposes personal fields", () => {
    const access = getFieldsForApplicantStep("DRAFT", "personal");
    expect(access.fields).toEqual(["fullName", "contactPhone", "contactEmail"]);
    expect(access.editable).toContain("fullName");
    expect(access.allReadable).toContain("fullName");
    expect(access.allReadable).not.toContain("caseDescription");
  });

  it("materials step exposes material fields", () => {
    const access = getFieldsForApplicantStep("DRAFT", "materials");
    expect(access.fields).toContain("economicProofMeta");
    expect(access.fields).toContain("idDocumentMeta");
    expect(access.fields).toContain("otherMaterialMeta");
  });

  it("past step fields are readable but current step fields are editable", () => {
    const access = getFieldsForApplicantStep("DRAFT", "case");
    expect(access.allReadable).toContain("fullName");
    expect(access.editable).toContain("legalIssueType");
    expect(access.editable).toContain("caseDescription");
  });

  it("SUBMITTED state has no editable fields", () => {
    const access = getFieldsForApplicantStep("SUBMITTED", "personal");
    expect(access.editable).toHaveLength(0);
  });
});

describe("field permissions - staff views", () => {
  it("SUBMITTED uses INTAKE_REVIEW with minimal fields", () => {
    expect(getStaffViewForState("SUBMITTED")).toBe("INTAKE_REVIEW");
    const fields = getStaffVisibleFields("SUBMITTED");
    expect(fields).toContain("id");
    expect(fields).toContain("state");
    expect(fields).toContain("accommodations");
    expect(fields).not.toContain("fullName");
    expect(fields).not.toContain("contactPhone");
    expect(fields).not.toContain("contactEmail");
    expect(fields).not.toContain("caseDescription");
  });

  it("NEEDS_CORRECTION uses CORRECTION_REVIEW with more fields", () => {
    expect(getStaffViewForState("NEEDS_CORRECTION")).toBe("CORRECTION_REVIEW");
    const fields = getStaffVisibleFields("NEEDS_CORRECTION");
    expect(fields).toContain("fullName");
    expect(fields).toContain("contactPhone");
    expect(fields).toContain("caseDescription");
    expect(fields).toContain("economicProofMeta");
  });

  it("RESUBMITTED uses INTAKE_REVIEW (minimal)", () => {
    expect(getStaffViewForState("RESUBMITTED")).toBe("INTAKE_REVIEW");
    const fields = getStaffVisibleFields("RESUBMITTED");
    expect(fields).not.toContain("fullName");
    expect(fields).not.toContain("contactPhone");
  });

  it("DRAFT has no staff view", () => {
    expect(getStaffViewForState("DRAFT")).toBe("NONE");
    expect(getStaffVisibleFields("DRAFT")).toHaveLength(0);
  });

  it("ACCEPTED has no staff view", () => {
    expect(getStaffViewForState("ACCEPTED")).toBe("NONE");
  });
});

describe("field permissions - client mutation validation", () => {
  it("accepts valid client fields in DRAFT state", () => {
    const result = validateClientMutation(
      { fullName: "Test", contactPhone: "13800138000", version: 1 },
      "DRAFT"
    );
    expect(result.allowed).toBe(true);
    expect(result.rejectedFields).toHaveLength(0);
  });

  it("rejects state field manipulation", () => {
    const result = validateClientMutation(
      { fullName: "Test", state: "ACCEPTED", version: 1 },
      "DRAFT"
    );
    expect(result.allowed).toBe(false);
    expect(result.rejectedFields).toContain("state");
    expect(result.reasons.state).toContain("系统字段");
  });

  it("rejects idempotencyKey injection", () => {
    const result = validateClientMutation(
      { fullName: "Test", idempotencyKey: "fake", version: 1 },
      "DRAFT"
    );
    expect(result.allowed).toBe(false);
    expect(result.rejectedFields).toContain("idempotencyKey");
  });

  it("rejects version field as data (version is allowed separately)", () => {
    const result = validateClientMutation(
      { fullName: "Test", version: 1 },
      "DRAFT"
    );
    expect(result.allowed).toBe(true);
  });

  it("rejects all edits in SUBMITTED state", () => {
    const result = validateClientMutation(
      { fullName: "Test", version: 1 },
      "SUBMITTED"
    );
    expect(result.allowed).toBe(false);
    expect(result.rejectedFields).toContain("fullName");
  });

  it("rejects unknown fields not in whitelist", () => {
    const result = validateClientMutation(
      { fullName: "Test", isAdmin: true, version: 1 },
      "DRAFT"
    );
    expect(result.allowed).toBe(false);
    expect(result.rejectedFields).toContain("isAdmin");
  });

  it("rejects createdAt/updatedAt manipulation", () => {
    const result = validateClientMutation(
      { fullName: "Test", createdAt: new Date().toISOString(), version: 1 },
      "DRAFT"
    );
    expect(result.rejectedFields).toContain("createdAt");
  });
});

describe("field permissions - staff mutation validation", () => {
  it("accepts valid correction fields", () => {
    const result = validateStaffMutation(
      { fields: ["economicProofMeta"], reasonCode: "ECONOMIC_PROOF_REQUIRED", version: 1 },
      "SUBMITTED",
      "correction"
    );
    expect(result.allowed).toBe(true);
  });

  it("rejects correction with extra fields like fullName", () => {
    const result = validateStaffMutation(
      { fields: ["economicProofMeta"], reasonCode: "ECONOMIC_PROOF_REQUIRED", fullName: "Hack", version: 1 },
      "SUBMITTED",
      "correction"
    );
    expect(result.allowed).toBe(false);
    expect(result.rejectedFields).toContain("fullName");
  });

  it("accepts correction fields regardless of state (state enforced by route)", () => {
    const result = validateStaffMutation(
      { fields: ["economicProofMeta"], reasonCode: "ECONOMIC_PROOF_REQUIRED" },
      "DRAFT",
      "correction"
    );
    expect(result.allowed).toBe(true);
  });

  it("accepts valid decision", () => {
    const result = validateStaffMutation(
      { action: "ACCEPTED" },
      "SUBMITTED",
      "decision"
    );
    expect(result.allowed).toBe(true);
  });

  it("rejects decision with extra fields", () => {
    const result = validateStaffMutation(
      { action: "ACCEPTED", fullName: "Hack" },
      "SUBMITTED",
      "decision"
    );
    expect(result.allowed).toBe(false);
    expect(result.rejectedFields).toContain("fullName");
  });

  it("accepts decision field regardless of state (state enforced by route)", () => {
    const result = validateStaffMutation(
      { action: "ACCEPTED" },
      "DRAFT",
      "decision"
    );
    expect(result.allowed).toBe(true);
  });
});

describe("stale link detection", () => {
  it("returns not stale when states match", () => {
    const result = getStaleLinkState("SUBMITTED", "SUBMITTED");
    expect(result.isStale).toBe(false);
  });

  it("returns stale when expected state differs from actual", () => {
    const result = getStaleLinkState("SUBMITTED", "NEEDS_CORRECTION");
    expect(result.isStale).toBe(true);
    expect(result.message).toContain("已从");
    expect(result.message).toContain("变更为");
  });

  it("returns not stale when no expected state provided", () => {
    const result = getStaleLinkState(undefined, "SUBMITTED");
    expect(result.isStale).toBe(false);
  });
});

describe("data projection", () => {
  const fullData = {
    id: "APP-1",
    state: "SUBMITTED",
    version: 1,
    fullName: "Secret Name",
    contactPhone: "13800138000",
    contactEmail: "secret@example.com",
    caseDescription: "Secret case",
    legalIssueType: "HOUSING",
    exemptionReason: "NONE",
    accommodations: ["HOME_VISIT_NEEDED"],
    economicProofMeta: { fileName: "econ.pdf" },
    idDocumentMeta: { fileName: "id.pdf" },
    otherMaterialMeta: { fileName: "other.pdf" },
    idempotencyKey: "secret-key",
  };

  it("staff INTAKE_REVIEW projection hides sensitive fields", () => {
    const projected = projectDataForRole(fullData, "STAFF", "SUBMITTED");
    expect(projected.id).toBe("APP-1");
    expect(projected.state).toBe("SUBMITTED");
    expect(projected.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
    expect(projected.fullName).toBeUndefined();
    expect(projected.contactPhone).toBeUndefined();
    expect(projected.contactEmail).toBeUndefined();
    expect(projected.caseDescription).toBeUndefined();
    expect(projected.idempotencyKey).toBeUndefined();
  });

  it("staff CORRECTION_REVIEW projection includes sensitive fields", () => {
    const projected = projectDataForRole(fullData, "STAFF", "NEEDS_CORRECTION");
    expect(projected.fullName).toBe("Secret Name");
    expect(projected.contactPhone).toBe("13800138000");
    expect(projected.caseDescription).toBe("Secret case");
    expect(projected.idempotencyKey).toBeUndefined();
  });

  it("applicant personal step projection only shows relevant fields", () => {
    const projected = projectDataForRole(fullData, "APPLICANT", "DRAFT", "personal");
    expect(projected.fullName).toBe("Secret Name");
    expect(projected.contactPhone).toBe("13800138000");
    expect(projected.caseDescription).toBeUndefined();
    expect(projected.idempotencyKey).toBeUndefined();
  });

  it("never exposes idempotencyKey in any projection", () => {
    const staffView = projectDataForRole(fullData, "STAFF", "NEEDS_CORRECTION");
    const applicantView = projectDataForRole(fullData, "APPLICANT", "DRAFT", "review");
    expect(staffView.idempotencyKey).toBeUndefined();
    expect(applicantView.idempotencyKey).toBeUndefined();
  });
});
