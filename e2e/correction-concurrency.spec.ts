import { expect, test } from "@playwright/test";
import { createNeedsCorrection, getApp } from "./helpers";

test.describe("申请人与工作人员基于同一旧草稿并发修改（三方合并）", () => {
  test("申请人补材料 × 工作人员写补正 reason code：各自生效，合理便利不动", async ({
    browser,
    request,
  }) => {
    const app = await createNeedsCorrection(request);
    const id = app.id;
    const baseVersion = app.version;

    const ctxA = await browser.newContext({ baseURL: "http://localhost:3100" });
    const ctxB = await browser.newContext({ baseURL: "http://localhost:3100" });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // 双方基于同一版本打开：申请人向导 + 工作人员补正编辑器
    await pageA.goto(`/apply/${id}`);
    await pageB.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await expect(pageB.getByText(`当前 v${baseVersion}`)).toBeVisible();

    // 申请人走到材料步骤并补充一份“其他材料”
    for (let i = 0; i < 3; i++) {
      await pageA.getByRole("button", { name: "下一步" }).click();
    }
    await pageA.locator("#material-kind").selectOption("OTHER");
    await pageA.locator("#material-label").fill("情况说明书");
    await pageA.getByRole("button", { name: "添加材料" }).click();
    await expect(pageA.locator('[data-material-kind="OTHER"]')).toBeVisible();

    // 工作人员仍基于旧版本写补正 reason code → 不同字段域，无冲突合并
    await pageB.locator("#edit-reason-code").fill("ECONOMIC_PROOF_EXPIRED");
    await pageB.locator("#edit-note").fill("证明已过期，请重新开具");
    await pageB.getByRole("button", { name: "保存补正要求" }).click();
    await expect(pageB.getByTestId("correction-save-result")).toContainText("补正要求已保存");
    await expect(pageB.getByTestId("staff-conflict-notice")).toHaveCount(0);

    // 申请人下一次同步看到更新后的补正要求（公告 + 提示条）
    await pageA.getByRole("button", { name: "上一步" }).click();
    await pageA.getByRole("button", { name: "上一步" }).click();
    await pageA.getByRole("button", { name: "上一步" }).click();
    await pageA.getByLabel(/联系地址/).fill("申请人补正期间改的新地址 7 号");
    await expect(pageA.getByTestId("save-status")).toContainText("已同步至服务器");
    await expect(pageA.getByTestId("correction-notice")).toContainText("ECONOMIC_PROOF_EXPIRED");
    await expect(pageA.getByTestId("sr-announcer")).toContainText("工作人员更新了补正要求");

    // 服务端最终收敛：双方修改都在，合理便利原样保留
    const view = await getApp(request, id);
    expect(view.fields.address).toBe("申请人补正期间改的新地址 7 号");
    expect(view.fields.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
    expect(view.materials.some((m) => m.kind === "OTHER")).toBe(true);
    const correction = (view as unknown as { latestCorrection: { reasonCode: string } })
      .latestCorrection;
    expect(correction.reasonCode).toBe("ECONOMIC_PROOF_EXPIRED");

    await ctxA.close();
    await ctxB.close();
  });

  test("两个工作人员会话改同一 reason code：冲突字段返回给对应会话", async ({
    browser,
    request,
  }) => {
    const app = await createNeedsCorrection(request);
    const id = app.id;

    const ctx1 = await browser.newContext({ baseURL: "http://localhost:3100" });
    const ctx2 = await browser.newContext({ baseURL: "http://localhost:3100" });
    const staff1 = await ctx1.newPage();
    const staff2 = await ctx2.newPage();
    await staff1.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await staff2.goto(`/staff/${id}?view=CORRECTION_REVIEW`);

    // 会话 1 先保存
    await staff1.locator("#edit-reason-code").fill("STAFF_ONE_CODE");
    await staff1.getByRole("button", { name: "保存补正要求" }).click();
    await expect(staff1.getByTestId("correction-save-result")).toContainText("补正要求已保存");

    // 会话 2 基于同一旧版本保存 → 冲突，服务端值获胜并回显
    await staff2.locator("#edit-reason-code").fill("STAFF_TWO_CODE");
    await staff2.getByRole("button", { name: "保存补正要求" }).click();
    await expect(staff2.getByTestId("staff-conflict-notice")).toBeVisible();
    await expect(
      staff2.locator('[data-conflict-field="correctionReasonCode"]'),
    ).toContainText("STAFF_ONE_CODE");
    await expect(staff2.locator('[data-conflict-field="correctionReasonCode"]')).toContainText(
      "STAFF_TWO_CODE",
    );
    await expect(staff2.locator("#edit-reason-code")).toHaveValue("STAFF_ONE_CODE");
    await expect(staff2.getByTestId("sr-announcer")).toContainText("已保留服务器版本");

    // 服务端只保留先到版本，合理便利未受影响
    const view = await getApp(request, id);
    const correction = (view as unknown as { latestCorrection: { reasonCode: string } })
      .latestCorrection;
    expect(correction.reasonCode).toBe("STAFF_ONE_CODE");
    expect(view.fields.accommodations).toEqual(["HOME_VISIT_NEEDED"]);

    await ctx1.close();
    await ctx2.close();
  });
});
