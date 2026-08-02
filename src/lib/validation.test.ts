import { describe, expect, it } from "vitest";
import {
  requiresEconomicProof,
  validateForSubmit,
  type MaterialMeta,
  type SubmittableShape,
} from "./validation";

const baseApp: SubmittableShape = {
  contactName: "王阿姨",
  contactPhone: "13800000001",
  address: "朝阳区和平街 12 号院",
  matterType: "LABOR_DISPUTE",
  matterDescription: "被拖欠三个月工资，申请法律援助。",
  exemptionReason: "NONE",
  accommodations: ["HOME_VISIT_NEEDED"],
};

const identity: MaterialMeta = {
  kind: "IDENTITY",
  label: "身份证复印件",
  metadata: {},
};
const econProof: MaterialMeta = {
  kind: "ECONOMIC_PROOF",
  label: "经济困难证明",
  metadata: {},
};

describe("提交校验", () => {
  it("NO_FIXED_INCOME 免交经济困难证明，但身份证明仍必须", () => {
    const app = { ...baseApp, exemptionReason: "NO_FIXED_INCOME" };
    // 无经济困难证明、无身份证明 → 只报身份证明缺失
    const errors = validateForSubmit(app, []);
    expect(errors.economicProof).toBeUndefined();
    expect(errors.identity).toBeDefined();
    // 有身份证明、无经济困难证明 → 通过
    const ok = validateForSubmit(app, [identity]);
    expect(Object.keys(ok)).toHaveLength(0);
  });

  it("NOTIFIED_CRIMINAL_DEFENSE 同样免交经济困难证明", () => {
    const app = { ...baseApp, exemptionReason: "NOTIFIED_CRIMINAL_DEFENSE" };
    const errors = validateForSubmit(app, [identity]);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("NONE 情形必须提交经济困难证明", () => {
    const errors = validateForSubmit(baseApp, [identity]);
    expect(errors.economicProof).toBeDefined();
    const ok = validateForSubmit(baseApp, [identity, econProof]);
    expect(Object.keys(ok)).toHaveLength(0);
  });

  it("requiresEconomicProof 仅对 NONE 为真", () => {
    expect(requiresEconomicProof("NONE")).toBe(true);
    expect(requiresEconomicProof("NO_FIXED_INCOME")).toBe(false);
    expect(requiresEconomicProof("NOTIFIED_CRIMINAL_DEFENSE")).toBe(false);
  });

  it("基础字段校验", () => {
    const errors = validateForSubmit(
      {
        ...baseApp,
        contactName: "王",
        contactPhone: "abc",
        address: "短",
        matterType: "",
        matterDescription: "太短",
      },
      [identity, econProof],
    );
    expect(errors.contactName).toBeDefined();
    expect(errors.contactPhone).toBeDefined();
    expect(errors.address).toBeDefined();
    expect(errors.matterType).toBeDefined();
    expect(errors.matterDescription).toBeDefined();
  });

  it("座机号码可通过", () => {
    const errors = validateForSubmit(
      { ...baseApp, contactPhone: "010-12345678" },
      [identity, econProof],
    );
    expect(errors.contactPhone).toBeUndefined();
  });
});
