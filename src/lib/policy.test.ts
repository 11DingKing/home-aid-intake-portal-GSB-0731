import { describe, expect, it } from "vitest";
import {
  CORRECTION_KEY_TO_PSEUDO,
  fieldForbiddenReason,
  findRejectedFields,
  writableFieldsFor,
} from "./policy";
import { CORRECTION_FIELDS, EDITABLE_FIELDS, STATES, type AppState } from "./constants";

describe("写权限边界（角色 × 状态 × 字段白名单）", () => {
  it("申请人只在 DRAFT / NEEDS_CORRECTION 可写申请人字段", () => {
    expect(writableFieldsFor("APPLICANT", "DRAFT")).toEqual(EDITABLE_FIELDS);
    expect(writableFieldsFor("APPLICANT", "NEEDS_CORRECTION")).toEqual(EDITABLE_FIELDS);
    for (const s of STATES) {
      if (s !== "DRAFT" && s !== "NEEDS_CORRECTION") {
        expect(writableFieldsFor("APPLICANT", s as AppState)).toEqual([]);
      }
    }
  });

  it("工作人员只在 NEEDS_CORRECTION 可写补正伪字段，永远写不了申请人字段", () => {
    expect(writableFieldsFor("STAFF", "NEEDS_CORRECTION")).toEqual(CORRECTION_FIELDS);
    for (const s of STATES) {
      if (s !== "NEEDS_CORRECTION") {
        expect(writableFieldsFor("STAFF", s as AppState)).toEqual([]);
      }
    }
    for (const s of STATES) {
      const allowed = writableFieldsFor("STAFF", s as AppState);
      expect(allowed).not.toContain("accommodations");
      expect(allowed).not.toContain("contactName");
      expect(allowed).not.toContain("state");
    }
  });

  it("findRejectedFields 找出越权字段", () => {
    expect(
      findRejectedFields(["contactName", "state", "idempotencyKey"], ["contactName"]),
    ).toEqual(["state", "idempotencyKey"]);
    expect(findRejectedFields([], EDITABLE_FIELDS)).toEqual([]);
  });

  it("拒绝理由含角色、状态与字段名，可审计", () => {
    const reason = fieldForbiddenReason("APPLICANT", "SUBMITTED", ["state", "accommodations"]);
    expect(reason).toContain("FIELD_FORBIDDEN");
    expect(reason).toContain("APPLICANT");
    expect(reason).toContain("SUBMITTED");
    expect(reason).toContain("state");
    expect(reason).toContain("accommodations");
  });

  it("补正请求键映射到伪字段", () => {
    expect(CORRECTION_KEY_TO_PSEUDO.reasonCode).toBe("correctionReasonCode");
    expect(CORRECTION_KEY_TO_PSEUDO.fields).toBe("correctionFields");
  });
});
