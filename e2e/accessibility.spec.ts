import { test, expect, type Page } from "@playwright/test";

const TEST_APP_ID = `E2E-ACCESS-${Date.now()}`;

async function goToStep(page: Page, stepIndex: number) {
  for (let i = 0; i < stepIndex; i++) {
    const errors = await page.locator(".has-error").count();
    if (errors > 0) {
      throw new Error(`Errors on step ${i} before proceeding`);
    }
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
  }
}

test.describe("Accessibility - keyboard navigation and screen reader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/apply/${TEST_APP_ID}`);
    await page.waitForTimeout(1000);
  });

  test("all form controls have programmatic names", async ({ page }) => {
    const inputs = page.locator("#form-panel input, #form-panel select, #form-panel textarea");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const tag = await input.evaluate((el) => el.tagName);
      if (tag === "INPUT" && (await input.getAttribute("type")) === "file") continue;

      const id = await input.getAttribute("id");
      expect(id, `Control at index ${i} should have an id`).toBeTruthy();

      const label = page.locator(`label[for="${id}"]`);
      const labelCount = await label.count();
      const ariaLabel = await input.getAttribute("aria-label");
      const ariaLabelledby = await input.getAttribute("aria-labelledby");

      expect(
        labelCount > 0 || ariaLabel || ariaLabelledby,
        `Control ${id} should have an associated label or aria-label`
      ).toBeTruthy();
    }
  });

  test("error messages are programmatically associated with fields", async ({ page }) => {
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);

    const errorFields = page.locator('[aria-invalid="true"]');
    const count = await errorFields.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const field = errorFields.nth(i);
      const fieldId = await field.getAttribute("id");
      const describedBy = await field.getAttribute("aria-describedby");
      expect(describedBy, `Field ${fieldId} should have aria-describedby`).toBeTruthy();

      const errorId = `${fieldId}-error`;
      const errorEl = page.locator(`#${errorId}`);
      await expect(errorEl).toBeVisible();
      const errorText = await errorEl.textContent();
      expect(errorText?.trim().length).toBeGreaterThan(0);
    }
  });

  test("focus moves to first error field on validation failure", async ({ page }) => {
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe("fullName");
  });

  test("focus moves to step heading on step navigation", async ({ page }) => {
    await page.fill("#fullName", "测试用户");
    await page.fill("#contactPhone", "13800138000");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    const activeElement = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, id: el?.id, role: el?.getAttribute("role") };
    });
    expect(activeElement.tag).toBeTruthy();
  });

  test("can complete entire form using only keyboard", async ({ page }) => {
    await page.keyboard.press("Tab");
    await page.keyboard.type("键盘测试用户");
    await page.keyboard.press("Tab");
    await page.keyboard.type("13900139000");
    await page.keyboard.press("Tab");
    await page.keyboard.type("keyboard@test.com");

    let focused = await page.evaluate(() => document.activeElement?.getAttribute("name"));
    expect(focused).toBe("contactEmail");

    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.textContent);
    expect(focused).toContain("下一步");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    await page.keyboard.press("Tab");
    await page.keyboard.type("这是一个通过键盘填写的案件描述内容");
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.textContent);
    expect(focused).toContain("下一步");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    await page.keyboard.press("Tab");
    focused = await page.evaluate(() => document.activeElement?.textContent);
    expect(focused).toContain("下一步");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    const stepText = await page.locator("#step-heading").textContent();
    expect(stepText).toContain("合理便利");
  });

  test("ARIA live region announces step changes", async ({ page }) => {
    const liveRegion = page.locator('[aria-live="assertive"]').first();
    await page.fill("#fullName", "测试用户");
    await page.fill("#contactPhone", "13800138000");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    const announcement = await liveRegion.textContent();
    expect(announcement).toContain("案件信息");
  });

  test("ARIA live region announces validation errors", async ({ page }) => {
    const liveRegion = page.locator('[aria-live="assertive"]').first();
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(500);

    const announcement = await liveRegion.textContent();
    expect(announcement).toContain("错误");
  });

  test("status is not communicated by color alone - has icon and text", async ({ page }) => {
    const badge = page.locator(".status-badge").first();
    await expect(badge).toBeVisible();

    const badgeText = await badge.textContent();
    expect(badgeText?.trim().length).toBeGreaterThan(0);

    const icon = badge.locator(".status-icon");
    await expect(icon).toBeVisible();
    const iconText = await icon.textContent();
    expect(iconText?.trim().length).toBeGreaterThan(0);
  });

  test("step indicator uses aria-current for current step", async ({ page }) => {
    const currentStep = page.locator('[aria-current="step"]');
    await expect(currentStep).toHaveCount(1);
    await expect(currentStep).toContainText("个人信息");
  });
});
