import { expect, test } from "@playwright/test";

test.describe("工作人员最小披露", () => {
  test("INTAKE_REVIEW：只见受理必需字段，不见姓名电话地址案情", async ({
    page,
    request,
  }) => {
    // API 级：响应键严格等于白名单
    const res = await request.get(
      "/api/staff/applications/APP-201?view=INTAKE_REVIEW",
    );
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(
      [
        "accommodations",
        "exemptionReason",
        "id",
        "materialMetadata",
        "state",
      ].sort(),
    );

    // UI 级：页面不含越权字段值
    await page.goto("/staff/APP-201?view=INTAKE_REVIEW");
    await expect(page.getByTestId("projected-accommodations")).toContainText(
      "HOME_VISIT_NEEDED",
    );
    await expect(page.getByTestId("projected-exemptionReason")).toContainText(
      "NO_FIXED_INCOME",
    );
    await expect(page.getByTestId("projected-materialMetadata")).toContainText(
      "身份证复印件",
    );
    const html = await page.content();
    expect(html).not.toContain("王阿姨");
    expect(html).not.toContain("13800000001");
    expect(html).not.toContain("和平街");
    expect(html).not.toContain("拖欠三个月工资");
  });

  test("CORRECTION_REVIEW：只见补正字段与已提交字段元数据", async ({
    page,
    request,
  }) => {
    const res = await request.get(
      "/api/staff/applications/APP-202?view=CORRECTION_REVIEW",
    );
    expect(res.ok()).toBeTruthy();
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(
      ["correctionFields", "id", "state", "submittedFieldMetadata"].sort(),
    );

    await page.goto("/staff/APP-202?view=CORRECTION_REVIEW");
    await expect(page.getByTestId("projected-correctionFields")).toContainText(
      "economicProof",
    );
    await expect(page.getByTestId("projected-correctionFields")).toContainText(
      "ECONOMIC_PROOF_REQUIRED",
    );
    // 字段值只有元数据（present/length），没有原始值
    await expect(
      page.getByTestId("projected-submittedFieldMetadata"),
    ).toContainText('"present"');
    const html = await page.content();
    expect(html).not.toContain("李师傅");
    expect(html).not.toContain("13800000002");
    expect(html).not.toContain("中关村南大街");
  });

  test("工作人员受理操作与状态徽标（非颜色表达）", async ({ page }) => {
    await page.goto("/staff/APP-201?view=INTAKE_REVIEW");
    // 徽标同时包含符号与文字
    const badge = page.locator(".badge").first();
    await expect(badge).toContainText("状态：已提交");
    await expect(badge.locator(".icon")).not.toBeEmpty();

    await page.getByRole("button", { name: "受理", exact: true }).click();
    await expect(page.getByTestId("action-result")).toContainText("已受理");
    await expect(page.getByTestId("sr-announcer")).toContainText("已受理");

    // 申请人视角同步看到终态
    await page.goto("/apply/APP-201");
    await expect(page.getByTestId("submitted-view")).toContainText("已受理");
  });

  test("工作人员列表页按视图分列，不泄露隐私字段", async ({ page }) => {
    await page.goto("/staff?view=INTAKE_REVIEW");
    await expect(page.getByRole("table")).toContainText("APP-201");
    await expect(page.getByRole("table")).toContainText("合理便利");
    const html = await page.content();
    expect(html).not.toContain("13800000001");
    expect(html).not.toContain("王阿姨");
  });
});
