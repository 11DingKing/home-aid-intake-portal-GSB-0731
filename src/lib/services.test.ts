import { beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { join } from "node:path";
import {
  ApiError,
  resubmitApplication,
  saveDraft,
  staffTransition,
  submitApplication,
} from "./services";

const prisma = new PrismaClient({
  datasourceUrl: `file:${join(process.cwd(), "prisma", "test.db")}`,
});

async function reset() {
  await prisma.application.deleteMany();
}

async function createDraft(id: string) {
  return prisma.application.create({
    data: { id, version: 1, fieldVersions: "{}" },
    include: { materials: true, corrections: true },
  });
}

const validFields = {
  contactName: "王阿姨",
  contactPhone: "13800000001",
  address: "朝阳区和平街 12 号院 3 单元 501",
  matterType: "LABOR_DISPUTE",
  matterDescription: "被原单位拖欠三个月工资，多次协商未果。",
  exemptionReason: "NONE",
  accommodations: ["HOME_VISIT_NEEDED"],
};

async function fillValid(id: string, exemptionReason = "NONE") {
  await saveDraft(prisma, id, 1, { ...validFields, exemptionReason });
  await prisma.material.create({
    data: {
      id: `${id}-ID`,
      applicationId: id,
      kind: "IDENTITY",
      label: "身份证复印件",
      metadata: "{}",
    },
  });
  if (exemptionReason === "NONE") {
    await prisma.material.create({
      data: {
        id: `${id}-ECON`,
        applicationId: id,
        kind: "ECONOMIC_PROOF",
        label: "经济困难证明",
        metadata: "{}",
      },
    });
  }
}

beforeEach(reset);

describe("saveDraft 字段级合并", () => {
  it("不同字段离线并行编辑最终收敛；同字段冲突服务端优先", async () => {
    await createDraft("APP-T1");
    // 会话 B 基于 v1 改 address
    const b = await saveDraft(prisma, "APP-T1", 1, { address: "B 的新地址" });
    expect(b.application.version).toBe(2);
    // 会话 A 仍基于 v1 改 contactName 和 address
    const a = await saveDraft(prisma, "APP-T1", 1, {
      contactName: "A 的姓名",
      address: "A 的旧地址",
    });
    expect(a.conflicts.map((c) => c.field)).toEqual(["address"]);
    expect(a.conflicts[0].serverValue).toBe("B 的新地址");
    expect(a.application.contactName).toBe("A 的姓名");
    expect(a.application.address).toBe("B 的新地址");
    expect(a.application.version).toBe(3);
  });

  it("旧草稿清 accommodations 时与服务端冲突，需求被保留", async () => {
    await createDraft("APP-T2");
    await saveDraft(prisma, "APP-T2", 1, {
      accommodations: ["HOME_VISIT_NEEDED"],
    });
    const stale = await saveDraft(prisma, "APP-T2", 1, { accommodations: [] });
    expect(stale.conflicts.map((c) => c.field)).toEqual(["accommodations"]);
    expect(JSON.parse(stale.application.accommodations)).toEqual([
      "HOME_VISIT_NEEDED",
    ]);
  });

  it("已提交申请拒绝草稿保存", async () => {
    await createDraft("APP-T3");
    await fillValid("APP-T3");
    await submitApplication(prisma, "APP-T3", "key-t3");
    await expect(
      saveDraft(prisma, "APP-T3", 2, { contactName: "X" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "DRAFT_LOCKED",
    });
  });
});

describe("submitApplication 幂等提交", () => {
  it("NO_FIXED_INCOME 无经济困难证明也可提交（身份证明了即可）", async () => {
    await createDraft("APP-T4");
    await fillValid("APP-T4", "NO_FIXED_INCOME");
    const result = await submitApplication(prisma, "APP-T4", "key-t4");
    expect(result.duplicate).toBe(false);
    expect(result.application.state).toBe("SUBMITTED");
  });

  it("NONE 缺经济困难证明返回 422", async () => {
    await createDraft("APP-T5");
    await saveDraft(prisma, "APP-T5", 1, { ...validFields });
    await prisma.material.create({
      data: {
        id: "APP-T5-ID",
        applicationId: "APP-T5",
        kind: "IDENTITY",
        label: "身份证",
        metadata: "{}",
      },
    });
    await expect(
      submitApplication(prisma, "APP-T5", "key-t5"),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
    });
  });

  it("同键重复提交返回首次结果，不重复流转", async () => {
    await createDraft("APP-T6");
    await fillValid("APP-T6");
    const first = await submitApplication(prisma, "APP-T6", "key-t6");
    const second = await submitApplication(prisma, "APP-T6", "key-t6");
    expect(second.duplicate).toBe(true);
    expect(second.application.version).toBe(first.application.version);
    const events = await prisma.applicationEvent.count({
      where: { applicationId: "APP-T6" },
    });
    expect(events).toBe(1);
  });

  it("并发同键双提交：恰好一次生效", async () => {
    await createDraft("APP-T7");
    await fillValid("APP-T7");
    const results = await prisma.$transaction(async () => [1]); // 占位，确保连接就绪
    void results;
    const [r1, r2] = await Promise.all([
      submitApplication(prisma, "APP-T7", "key-t7"),
      submitApplication(prisma, "APP-T7", "key-t7"),
    ]);
    expect([r1.duplicate, r2.duplicate].sort()).toEqual([false, true]);
    const app = await prisma.application.findUniqueOrThrow({
      where: { id: "APP-T7" },
    });
    expect(app.state).toBe("SUBMITTED");
  });

  it("幂等键被他单占用时返回 409", async () => {
    await createDraft("APP-T8");
    await fillValid("APP-T8");
    await submitApplication(prisma, "APP-T8", "shared-key");
    await createDraft("APP-T9");
    await fillValid("APP-T9");
    await expect(
      submitApplication(prisma, "APP-T9", "shared-key"),
    ).rejects.toMatchObject({
      status: 409,
      code: "DUPLICATE_KEY",
    });
  });
});

describe("补正与工作人员流转", () => {
  it("SUBMITTED → NEEDS_CORRECTION → RESUBMITTED → ACCEPTED", async () => {
    await createDraft("APP-T10");
    await fillValid("APP-T10");
    await submitApplication(prisma, "APP-T10", "key-t10");

    const corrected = await staffTransition(
      prisma,
      "APP-T10",
      "REQUEST_CORRECTION",
      {
        fields: ["economicProof"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        note: "请补正",
      },
    );
    expect(corrected.state).toBe("NEEDS_CORRECTION");
    expect(corrected.corrections[0].reasonCode).toBe("ECONOMIC_PROOF_REQUIRED");

    const resub = await resubmitApplication(prisma, "APP-T10", "key-t10b");
    expect(resub.application.state).toBe("RESUBMITTED");
    // 同键再次 resubmit → duplicate
    const resub2 = await resubmitApplication(prisma, "APP-T10", "key-t10b");
    expect(resub2.duplicate).toBe(true);

    const accepted = await staffTransition(prisma, "APP-T10", "ACCEPT", {});
    expect(accepted.state).toBe("ACCEPTED");
    // 终态不能再流转
    await expect(
      staffTransition(prisma, "APP-T10", "DECLINE", {}),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("REQUEST_CORRECTION 缺少 fields/reasonCode 返回 400", async () => {
    await createDraft("APP-T11");
    await fillValid("APP-T11");
    await submitApplication(prisma, "APP-T11", "key-t11");
    await expect(
      staffTransition(prisma, "APP-T11", "REQUEST_CORRECTION", {}),
    ).rejects.toMatchObject({ status: 400, code: "BAD_CORRECTION" });
  });

  it("DRAFT 状态工作人员不能直接受理", async () => {
    await createDraft("APP-T12");
    await expect(
      staffTransition(prisma, "APP-T12", "ACCEPT", {}),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
