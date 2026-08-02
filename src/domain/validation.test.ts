import { describe, it, expect } from "vitest";
import {
  isEconomicProofRequired,
  validateForSubmission,
  validateStepFields,
  draftUpdateSchema,
} from "@/domain/validation";

const validData = {
  fullName: "张三",
  contactPhone: "13800138000",
  contactEmail: "zhangsan@example.com",
  caseDescription: "这是一个测试案件描述，至少十个字",
  legalIssueType: "HOUSING",
  exemptionReason: "NONE" as const,
  economicProofMeta: { materialId: "M1", fileName: "proof.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" as const },
  idDocumentMeta: { materialId: "M2", fileName: "id.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" as const },
  otherMaterialMeta: { materialId: "M3", fileName: "other.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" as const },
};

describe("validation", () => {
  describe("isEconomicProofRequired", () => {
    it("returns false for NO_FIXED_INCOME", () => {
      expect(isEconomicProofRequired("NO_FIXED_INCOME")).toBe(false);
    });

    it("returns true for NONE", () => {
      expect(isEconomicProofRequired("NONE")).toBe(true);
    });

    it("returns true for NOTIFIED_CRIMINAL_DEFENSE", () => {
      expect(isEconomicProofRequired("NOTIFIED_CRIMINAL_DEFENSE")).toBe(true);
    });
  });

  describe("validateForSubmission", () => {
    it("passes with complete data and NONE exemption", () => {
      const result = validateForSubmission(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("passes without economic proof when NO_FIXED_INCOME", () => {
      const result = validateForSubmission({
        ...validData,
        exemptionReason: "NO_FIXED_INCOME",
        economicProofMeta: null,
      });
      expect(result.valid).toBe(true);
      expect(result.errors.find((e) => e.field === "economicProofMeta")).toBeUndefined();
    });

    it("fails when economic proof missing and NONE exemption", () => {
      const result = validateForSubmission({
        ...validData,
        exemptionReason: "NONE",
        economicProofMeta: null,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.find((e) => e.field === "economicProofMeta")).toBeDefined();
    });

    it("fails when name is missing", () => {
      const result = validateForSubmission({ ...validData, fullName: "" });
      expect(result.valid).toBe(false);
      expect(result.errors.find((e) => e.field === "fullName")).toBeDefined();
    });

    it("fails when phone is missing", () => {
      const result = validateForSubmission({ ...validData, contactPhone: "" });
      expect(result.valid).toBe(false);
      expect(result.errors.find((e) => e.field === "contactPhone")).toBeDefined();
    });

    it("fails when case description is too short", () => {
      const result = validateForSubmission({ ...validData, caseDescription: "短" });
      expect(result.valid).toBe(false);
      expect(result.errors.find((e) => e.field === "caseDescription")).toBeDefined();
    });

    it("fails when id document is missing", () => {
      const result = validateForSubmission({ ...validData, idDocumentMeta: null });
      expect(result.valid).toBe(false);
      expect(result.errors.find((e) => e.field === "idDocumentMeta")).toBeDefined();
    });

    it("fails when other material is missing", () => {
      const result = validateForSubmission({ ...validData, otherMaterialMeta: null });
      expect(result.valid).toBe(false);
      expect(result.errors.find((e) => e.field === "otherMaterialMeta")).toBeDefined();
    });

    it("still requires id and other materials even with NO_FIXED_INCOME", () => {
      const result = validateForSubmission({
        ...validData,
        exemptionReason: "NO_FIXED_INCOME",
        economicProofMeta: null,
        idDocumentMeta: null,
        otherMaterialMeta: null,
      });
      expect(result.valid).toBe(false);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("idDocumentMeta");
      expect(fields).toContain("otherMaterialMeta");
      expect(fields).not.toContain("economicProofMeta");
    });
  });

  describe("validateStepFields", () => {
    it("validates personal step", () => {
      const errors = validateStepFields("personal", { fullName: "", contactPhone: "" }, "NONE");
      expect(errors).toHaveLength(2);
      expect(errors.map((e) => e.field)).toContain("fullName");
      expect(errors.map((e) => e.field)).toContain("contactPhone");
    });

    it("validates case step", () => {
      const errors = validateStepFields("case", { legalIssueType: null, caseDescription: "短" }, "NONE");
      expect(errors).toHaveLength(2);
    });

    it("validates materials step with economic proof required", () => {
      const errors = validateStepFields(
        "materials",
        { idDocumentMeta: null, otherMaterialMeta: null, economicProofMeta: null },
        "NONE"
      );
      expect(errors).toHaveLength(3);
    });

    it("validates materials step without economic proof for NO_FIXED_INCOME", () => {
      const errors = validateStepFields(
        "materials",
        { idDocumentMeta: null, otherMaterialMeta: null, economicProofMeta: null },
        "NO_FIXED_INCOME"
      );
      expect(errors).toHaveLength(2);
      expect(errors.map((e) => e.field)).not.toContain("economicProofMeta");
    });
  });

  describe("draftUpdateSchema", () => {
    it("accepts valid partial update with version", () => {
      const result = draftUpdateSchema.safeParse({
        fullName: "测试",
        version: 1,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid phone", () => {
      const result = draftUpdateSchema.safeParse({
        contactPhone: "abc",
        version: 1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing version", () => {
      const result = draftUpdateSchema.safeParse({ fullName: "测试" });
      expect(result.success).toBe(false);
    });

    it("accepts empty email string", () => {
      const result = draftUpdateSchema.safeParse({ contactEmail: "", version: 1 });
      expect(result.success).toBe(true);
    });
  });
});
