import { describe, expect, it } from "vitest";
import { mergeDraftFields } from "./merge";

describe("字段级合并（基于乐观版本）", () => {
  it("同一 baseVersion 上修改不同字段：全部应用", () => {
    const result = mergeDraftFields({
      serverVersion: 2,
      serverFields: { contactName: "旧姓名" },
      fieldVersions: { address: 2 },
      baseVersion: 1,
      patch: { contactName: "张三" },
    });
    expect(result.applied.contactName).toBe("张三");
    expect(result.conflicts).toHaveLength(0);
    expect(result.newFieldVersions.contactName).toBe(3);
  });

  it("同一字段在 baseVersion 之后被服务端改过：冲突且服务端优先", () => {
    const result = mergeDraftFields({
      serverVersion: 3,
      serverFields: { address: "服务端新地址" },
      fieldVersions: { address: 3 },
      baseVersion: 1,
      patch: { address: "客户端旧地址" },
    });
    expect(result.applied.address).toBeUndefined();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      field: "address",
      serverValue: "服务端新地址",
      clientValue: "客户端旧地址",
    });
    // 冲突字段的服务端版本号保持不变
    expect(result.newFieldVersions.address).toBe(3);
  });

  it("旧草稿不能清掉合理便利需求：accommodations 冲突时保留服务端值", () => {
    const result = mergeDraftFields({
      serverVersion: 4,
      serverFields: { accommodations: ["HOME_VISIT_NEEDED"] },
      fieldVersions: { accommodations: 2 },
      baseVersion: 1,
      patch: { accommodations: [] },
    });
    expect(result.applied.accommodations).toBeUndefined();
    expect(result.conflicts[0].field).toBe("accommodations");
  });

  it("值与服务端相同的字段直接跳过：不刷版本、不算冲突（避免全量上送的假冲突）", () => {
    const result = mergeDraftFields({
      serverVersion: 6,
      serverFields: { contactName: "张三", address: "同一地址" },
      fieldVersions: { contactName: 6, address: 6 },
      baseVersion: 1,
      patch: { contactName: "张三", address: "同一地址" },
    });
    expect(result.applied).toEqual({});
    expect(result.conflicts).toHaveLength(0);
    expect(result.newFieldVersions.contactName).toBe(6);
  });

  it("混合场景：不同字段有增有冲突", () => {
    const result = mergeDraftFields({
      serverVersion: 5,
      serverFields: {
        address: "B 的地址",
        contactName: "旧",
        matterDescription: "旧案情",
      },
      fieldVersions: { address: 5, contactName: 1 },
      baseVersion: 4,
      patch: {
        address: "A 的地址",
        contactName: "A 的姓名",
        matterDescription: "新案情",
      },
    });
    expect(result.applied.address).toBeUndefined();
    expect(result.applied.contactName).toBe("A 的姓名");
    expect(result.applied.matterDescription).toBe("新案情");
    expect(result.conflicts.map((c) => c.field)).toEqual(["address"]);
  });

  it("忽略白名单外字段", () => {
    const result = mergeDraftFields({
      serverVersion: 1,
      serverFields: {},
      fieldVersions: {},
      baseVersion: 1,
      patch: { state: "ACCEPTED", contactName: "李四" },
    });
    expect(Object.keys(result.applied)).toEqual(["contactName"]);
  });
});
