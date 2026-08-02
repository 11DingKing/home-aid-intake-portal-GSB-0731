import { describe, expect, it } from "vitest";
import {
  projectForStaffView,
  STAFF_VIEWS,
  type StaffProjectionSource,
} from "./disclosure";

const source: StaffProjectionSource = {
  id: "APP-201",
  state: "SUBMITTED",
  exemptionReason: "NO_FIXED_INCOME",
  accommodations: JSON.stringify(["HOME_VISIT_NEEDED"]),
  contactName: "王阿姨",
  contactPhone: "13800000001",
  address: "朝阳区和平街 12 号院 3 单元 501",
  matterType: "LABOR_DISPUTE",
  matterDescription: "被拖欠工资的具体细节描述",
  materials: [
    {
      kind: "IDENTITY",
      label: "身份证复印件",
      metadata: JSON.stringify({ fileName: "id.pdf", size: 1234 }),
    },
  ],
  corrections: [
    {
      fields: JSON.stringify(["economicProof"]),
      reasonCode: "ECONOMIC_PROOF_REQUIRED",
      note: "请补充",
      createdAt: new Date("2026-01-01"),
    },
  ],
};

describe("工作人员最小披露投影", () => {
  it("INTAKE_REVIEW 只含白名单键", () => {
    const projected = projectForStaffView(source, "INTAKE_REVIEW");
    expect(Object.keys(projected).sort()).toEqual(
      [...STAFF_VIEWS.INTAKE_REVIEW].sort(),
    );
  });

  it("INTAKE_REVIEW 不泄露姓名、电话、地址、案情原文", () => {
    const projected = projectForStaffView(source, "INTAKE_REVIEW");
    const raw = JSON.stringify(projected);
    expect(raw).not.toContain("王阿姨");
    expect(raw).not.toContain("13800000001");
    expect(raw).not.toContain("和平街");
    expect(raw).not.toContain("拖欠工资");
    // 但应包含合理便利与材料元数据
    expect(projected.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
    expect(projected.exemptionReason).toBe("NO_FIXED_INCOME");
  });

  it("CORRECTION_REVIEW 只含白名单键且字段值只暴露元数据", () => {
    const projected = projectForStaffView(
      { ...source, state: "NEEDS_CORRECTION" },
      "CORRECTION_REVIEW",
    );
    expect(Object.keys(projected).sort()).toEqual(
      [...STAFF_VIEWS.CORRECTION_REVIEW].sort(),
    );
    const meta = projected.submittedFieldMetadata as Record<
      string,
      { present: boolean; length?: number }
    >;
    expect(meta.contactName).toEqual({ present: true, length: 3 });
    expect(meta.contactPhone?.present).toBe(true);
    // 不出现原始值
    const raw = JSON.stringify(projected);
    expect(raw).not.toContain("王阿姨");
    expect(raw).not.toContain("13800000001");
    expect(raw).not.toContain("和平街");
    // 补正字段可见
    expect(projected.correctionFields).toMatchObject({
      fields: ["economicProof"],
      reasonCode: "ECONOMIC_PROOF_REQUIRED",
    });
  });

  it("无补正记录时 correctionFields 为 null", () => {
    const projected = projectForStaffView(
      { ...source, state: "NEEDS_CORRECTION", corrections: [] },
      "CORRECTION_REVIEW",
    );
    expect(projected.correctionFields).toBeNull();
  });

  it("状态超出视图适用范围时只回 id + state + viewNotApplicable", () => {
    // DRAFT 不在 INTAKE_REVIEW 范围
    const draft = projectForStaffView(
      { ...source, state: "DRAFT" },
      "INTAKE_REVIEW",
    );
    expect(draft).toEqual({
      id: "APP-201",
      state: "DRAFT",
      viewNotApplicable: true,
    });
    // SUBMITTED 不在 CORRECTION_REVIEW 范围
    const submitted = projectForStaffView(
      { ...source, state: "SUBMITTED" },
      "CORRECTION_REVIEW",
    );
    expect(Object.keys(submitted).sort()).toEqual([
      "id",
      "state",
      "viewNotApplicable",
    ]);
    // NEEDS_CORRECTION 在 CORRECTION_REVIEW 范围（source 默认 SUBMITTED，这里切换）
    const nc = projectForStaffView(
      { ...source, state: "NEEDS_CORRECTION" },
      "CORRECTION_REVIEW",
    );
    expect(nc.correctionFields).toBeTruthy();
    // RESUBMITTED 两个视图都适用
    const rs1 = projectForStaffView(
      { ...source, state: "RESUBMITTED" },
      "INTAKE_REVIEW",
    );
    const rs2 = projectForStaffView(
      { ...source, state: "RESUBMITTED" },
      "CORRECTION_REVIEW",
    );
    expect(rs1.viewNotApplicable).toBeUndefined();
    expect(rs2.viewNotApplicable).toBeUndefined();
  });
});
