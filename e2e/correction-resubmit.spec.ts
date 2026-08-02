import { expect, test } from "@playwright/test";
import { createValidDraft, getApp, submitApp } from "./helpers";

test.describe("补正后重新提交", () => {
  test("APP-202：补正提示→材料错误焦点→补交经济困难证明→重新提交", async ({
    page,
  }) => {
    await page.goto("/apply/APP-202");

    // 补正提示（role=alert），不只靠颜色
    await expect(page.getByTestId("correction-notice")).toContainText(
      "经济困难证明",
    );
    await expect(page.getByTestId("correction-notice")).toContainText(
      "ECONOMIC_PROOF_REQUIRED",
    );

    // 走到材料步骤
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "下一步" }).click();
    }
    await expect(page.getByTestId("economic-proof-required")).toBeVisible();

    // 缺材料时点“下一步”：错误汇总获得焦点，错误可被程序定位
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByTestId("error-summary")).toBeFocused();
    await expect(page.locator("#economicProof-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await page
      .getByTestId("error-summary")
      .getByRole("link", { name: "经济困难证明" })
      .click();
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe("economicProof-error");

    // 补交经济困难证明
    await page.locator("#material-kind").selectOption("ECONOMIC_PROOF");
    await page.locator("#material-label").fill("街道出具的经济困难证明");
    await page.getByRole("button", { name: "添加材料" }).click();
    await expect(
      page.locator('[data-material-kind="ECONOMIC_PROOF"]'),
    ).toBeVisible();

    // 合理便利步骤原样通过（TEXT_ONLY 保留）
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByLabel("仅文字交流")).toBeChecked();
    await page.getByRole("button", { name: "下一步" }).click();

    // 重新提交
    await page.getByRole("button", { name: "补正后重新提交" }).click();
    await expect(page.getByTestId("submitted-view")).toContainText(
      "已重新提交",
    );
    await expect(page.getByTestId("sr-announcer")).toContainText(
      "重新提交成功",
    );
  });

  test("NO_FIXED_INCOME 不强制经济困难证明，其他材料规则照常", async ({
    page,
    request,
  }) => {
    // 只有身份证明、无经济困难证明的无固定收入申请：服务端直接放行
    const app = await createValidDraft(request, "NO_FIXED_INCOME");
    const res = await submitApp(request, app.id, "no-fixed-income-key");
    expect(res.status()).toBe(201);
    const view = await getApp(request, app.id);
    expect(view.state).toBe("SUBMITTED");

    // UI 证据：材料步骤显示免交提示，且没有“需提交”警告
    const app2 = await createValidDraft(request, "NO_FIXED_INCOME");
    await page.goto(`/apply/${app2.id}`);
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "下一步" }).click();
    }
    await expect(page.getByTestId("exempt-notice")).toContainText(
      "免交经济困难证明",
    );
    await expect(page.getByTestId("economic-proof-required")).toHaveCount(0);
    // 删除身份证明后，其他必要材料规则仍然报错
    await page.getByRole("button", { name: "删除材料 身份证复印件" }).click();
    await expect(page.locator('[data-material-kind="IDENTITY"]')).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByTestId("error-summary")).toContainText("身份证明");
  });
});
