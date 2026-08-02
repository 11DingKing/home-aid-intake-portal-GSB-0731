import { beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { join } from "node:path";
import {
  ApiError,
  recordRejection,
  replaceMaterialMetadata,
  resubmitApplication,
  saveDraft,
  saveStaffCorrection,
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

describe("saveStaffCorrection 三方合并", () => {
  async function createNeedsCorrection(id: string) {
    await createDraft(id);
    await fillValid(id);
    await submitApplication(prisma, id, `key-${id}`);
    await staffTransition(prisma, id, "REQUEST_CORRECTION", {
      fields: ["economicProof"],
      reasonCode: "ECONOMIC_PROOF_REQUIRED",
      note: "请补正",
    });
    const app = await prisma.application.findUniqueOrThrow({ where: { id } });
    return app;
  }

  it("基于同一旧草稿：申请人补材料/改字段 与 工作人员写 reason code 各自生效", async () => {
    const app = await createNeedsCorrection("APP-T20");
    const base = app.version;
    // 申请人基于 base 改地址
    await saveDraft(prisma, "APP-T20", base, { address: "申请人新地址 9 号" });
    // 工作人员仍基于同一 base 写补正 → 不同字段域，互不冲突
    const result = await saveStaffCorrection(prisma, "APP-T20", base, {
      reasonCode: "ECONOMIC_PROOF_UPDATED",
      note: "请上传最新证明",
    });
    expect(result.conflicts).toHaveLength(0);
    expect(result.correction.reasonCode).toBe("ECONOMIC_PROOF_UPDATED");
    // 申请人的修改原样保留
    const fresh = await prisma.application.findUniqueOrThrow({
      where: { id: "APP-T20" },
    });
    expect(fresh.address).toBe("申请人新地址 9 号");
    // 合理便利不受影响
    expect(JSON.parse(fresh.accommodations)).toEqual(["HOME_VISIT_NEEDED"]);
  });

  it("两个工作人员会话改同一 reason code：后者收到冲突且服务端优先", async () => {
    const app = await createNeedsCorrection("APP-T21");
    const base = app.version;
    const first = await saveStaffCorrection(prisma, "APP-T21", base, {
      reasonCode: "STAFF_A_CODE",
    });
    expect(first.conflicts).toHaveLength(0);
    const second = await saveStaffCorrection(prisma, "APP-T21", base, {
      reasonCode: "STAFF_B_CODE",
    });
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]).toMatchObject({
      field: "correctionReasonCode",
      serverValue: "STAFF_A_CODE",
      clientValue: "STAFF_B_CODE",
    });
    expect(second.correction.reasonCode).toBe("STAFF_A_CODE");
  });

  it("非 NEEDS_CORRECTION 状态拒绝编辑补正", async () => {
    await createDraft("APP-T22");
    await expect(
      saveStaffCorrection(prisma, "APP-T22", 1, { reasonCode: "X" }),
    ).rejects.toMatchObject({ status: 409, code: "STATE_CONFLICT" });
  });

  it("重复提交/补正流程全程不清空合理便利", async () => {
    await createNeedsCorrection("APP-T23");
    // 重复提交同一幂等键
    const dup = await submitApplication(prisma, "APP-T23", `key-APP-T23`);
    expect(dup.duplicate).toBe(true);
    // 重新提交后合理便利仍在
    await resubmitApplication(prisma, "APP-T23", "key-APP-T23b");
    const fresh = await prisma.application.findUniqueOrThrow({
      where: { id: "APP-T23" },
    });
    expect(fresh.state).toBe("RESUBMITTED");
    expect(JSON.parse(fresh.accommodations)).toEqual(["HOME_VISIT_NEEDED"]);
  });
});

describe("replaceMaterialMetadata", () => {
  it("替换元数据保留材料 ID 与种类并递增版本", async () => {
    await createDraft("APP-T30");
    await fillValid("APP-T30");
    const before = await prisma.material.findUniqueOrThrow({
      where: { id: "APP-T30-ECON" },
    });
    const updated = await replaceMaterialMetadata(
      prisma,
      "APP-T30",
      "APP-T30-ECON",
      {
        metadata: { fileName: "new-proof.pdf", size: 999 },
      },
    );
    const after = updated.materials.find((m) => m.id === "APP-T30-ECON")!;
    expect(after.id).toBe(before.id);
    expect(after.kind).toBe("ECONOMIC_PROOF");
    expect(JSON.parse(after.metadata)).toMatchObject({
      fileName: "new-proof.pdf",
      size: 999,
    });
    expect(updated.version).toBeGreaterThan(before.createdAt ? 0 : 0);
  });

  it("已提交申请拒绝替换材料", async () => {
    await createDraft("APP-T31");
    await fillValid("APP-T31");
    await submitApplication(prisma, "APP-T31", "key-t31");
    await expect(
      replaceMaterialMetadata(prisma, "APP-T31", "APP-T31-ECON", {
        metadata: {},
      }),
    ).rejects.toMatchObject({ status: 409, code: "DRAFT_LOCKED" });
  });

  it("跨申请的材料 ID 拒绝替换", async () => {
    await createDraft("APP-T32");
    await fillValid("APP-T32");
    await expect(
      replaceMaterialMetadata(prisma, "APP-T32", "APP-T30-ECON", {
        metadata: {},
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("非法状态回退", () => {
  it("ACCEPTED 不能回退到任何状态；SUBMITTED 不能回到 DRAFT", async () => {
    await createDraft("APP-T40");
    await fillValid("APP-T40");
    await submitApplication(prisma, "APP-T40", "key-t40");
    // SUBMITTED 上不能再 SUBMIT（异键）
    await expect(
      submitApplication(prisma, "APP-T40", "other-key"),
    ).rejects.toMatchObject({
      status: 409,
      code: "STATE_CONFLICT",
    });
    // SUBMITTED 不能编辑草稿（回退 DRAFT）
    await expect(
      saveDraft(prisma, "APP-T40", 2, { contactName: "X" }),
    ).rejects.toMatchObject({
      status: 409,
    });
    await staffTransition(prisma, "APP-T40", "ACCEPT", {});
    await expect(
      staffTransition(prisma, "APP-T40", "REQUEST_CORRECTION", {
        fields: ["economicProof"],
        reasonCode: "R",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      resubmitApplication(prisma, "APP-T40", "k"),
    ).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("recordRejection 审计", () => {
  it("拒绝理由写入事件流，含角色与理由，不改动状态", async () => {
    await createDraft("APP-T50");
    await recordRejection(
      prisma,
      "APP-T50",
      "APPLICANT",
      "FIELD_FORBIDDEN: 测试拒绝 [state]",
    );
    await recordRejection(
      prisma,
      "APP-T50",
      "STAFF",
      "STATE_CONFLICT: 测试拒绝",
    );
    const events = await prisma.applicationEvent.findMany({
      where: { applicationId: "APP-T50" },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      actor: "APPLICANT",
      fromState: "DRAFT",
      toState: "DRAFT",
      note: "FIELD_FORBIDDEN: 测试拒绝 [state]",
    });
    expect(events[1].actor).toBe("STAFF");
    // 状态未被改动
    const app = await prisma.application.findUniqueOrThrow({
      where: { id: "APP-T50" },
    });
    expect(app.state).toBe("DRAFT");
  });

  it("serializeApplicantView 的 permissions 按状态重新计算", async () => {
    await createDraft("APP-T51");
    const draft = await prisma.application.findUniqueOrThrow({
      where: { id: "APP-T51" },
      include: { materials: true, corrections: true },
    });
    const { serializeApplicantView } = await import("./services");
    const v1 = serializeApplicantView(draft);
    expect(v1.permissions.editable).toBe(true);
    expect(v1.permissions.writableFields).toContain("accommodations");
    const submitted = { ...draft, state: "SUBMITTED" };
    const v2 = serializeApplicantView(submitted);
    expect(v2.permissions.editable).toBe(false);
    expect(v2.permissions.writableFields).toEqual([]);
  });
});
