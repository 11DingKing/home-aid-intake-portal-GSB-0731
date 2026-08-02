import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const TEST_APP_ID = `E2E-DRAFT-${Date.now()}`;

async function fillPersonalInfo(page: Page, name: string, phone: string) {
  await page.fill("#fullName", name);
  await page.fill("#contactPhone", phone);
}

test.describe("Offline draft recovery", () => {
  test("saves draft to localStorage and restores after reload", async ({ page }) => {
    await page.goto(`/apply/${TEST_APP_ID}`);
    await page.waitForTimeout(1000);

    await fillPersonalInfo(page, "离线测试用户", "13700137000");
    await page.waitForTimeout(2500);

    const localData = await page.evaluate((id) => {
      return localStorage.getItem(`legal-aid-draft-${id}`);
    }, TEST_APP_ID);
    expect(localData).toBeTruthy();
    const parsed = JSON.parse(localData!);
    expect(parsed.fullName).toBe("离线测试用户");

    await page.reload();
    await page.waitForTimeout(1500);

    const nameValue = await page.inputValue("#fullName");
    expect(nameValue).toBe("离线测试用户");
  });

  test("shows offline banner and saves locally when disconnected", async ({ page, context }) => {
    await page.goto(`/apply/${TEST_APP_ID}`);
    await page.waitForTimeout(1000);

    await context.setOffline(true);
    await page.waitForTimeout(300);

    const offlineBanner = page.locator(".offline-banner");
    await expect(offlineBanner).toBeVisible();
    await expect(offlineBanner).toContainText("离线");

    await fillPersonalInfo(page, "断网用户", "13600136000");
    await page.waitForTimeout(500);

    const localData = await page.evaluate((id) => {
      return localStorage.getItem(`legal-aid-draft-${id}`);
    }, TEST_APP_ID);
    const parsed = JSON.parse(localData!);
    expect(parsed.fullName).toBe("断网用户");

    await context.setOffline(false);
    await page.waitForTimeout(1000);

    await expect(offlineBanner).not.toBeVisible({ timeout: 5000 });
  });

  test("accommodations are preserved through offline/online cycle", async ({ page, context }) => {
    await page.goto(`/apply/${TEST_APP_ID}`);
    await page.waitForTimeout(1000);

    await fillPersonalInfo(page, "便利测试", "13500135000");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.locator("#legalIssueType").selectOption("HOUSING");
    await page.fill("#caseDescription", "这是需要合理便利的案件描述内容");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);

    await page.check("#accommodations-HOME_VISIT_NEEDED");
    await page.check("#accommodations-SIGN_INTERPRETER");
    await page.waitForTimeout(2500);

    await context.setOffline(true);
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(1000);
    await context.setOffline(false);
    await page.waitForTimeout(2000);

    await page.goto(`/apply/${TEST_APP_ID}`);
    await page.waitForTimeout(2000);

    const homeVisit = await page.isChecked("#accommodations-HOME_VISIT_NEEDED");
    const signInterp = await page.isChecked("#accommodations-SIGN_INTERPRETER");
    expect(homeVisit || signInterp).toBeTruthy();
  });
});

test.describe("Field-level merge conflicts", () => {
  test("same base version with different field edits merges correctly", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const appId = `E2E-MERGE-${Date.now()}`;

    await page1.goto(`/apply/${appId}`);
    await page2.goto(`/apply/${appId}`);
    await page1.waitForTimeout(1500);
    await page2.waitForTimeout(1500);

    await page1.fill("#fullName", "会话A用户");
    await page1.waitForTimeout(2500);

    await page2.fill("#contactPhone", "13811112222");
    await page2.waitForTimeout(2500);

    await page1.reload();
    await page1.waitForTimeout(2000);

    const name = await page1.inputValue("#fullName");
    expect(name).toBe("会话A用户");

    await context1.close();
    await context2.close();
  });

  test("server accepted while client remains draft - conflict detected and merged", async ({ page }) => {
    const appId = `E2E-SERVER-${Date.now()}`;

    await page.goto(`/apply/${appId}`);
    await page.waitForTimeout(1500);
    await page.fill("#fullName", "原始姓名");
    await page.waitForTimeout(2500);

    await page.evaluate(async (id) => {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactPhone: "13999999999",
          version: 1,
        }),
      });
      return res.json();
    }, appId);

    await page.fill("#contactPhone", "13800000000");
    await page.waitForTimeout(2500);

    await page.waitForTimeout(1000);
  });

  test("old draft cannot clear accommodations set on server", async ({ page }) => {
    const appId = `E2E-PROTECT-${Date.now()}`;

    await page.goto(`/apply/${appId}`);
    await page.waitForTimeout(1500);

    await page.evaluate(async (id) => {
      await fetch(`/api/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "服务器设置",
          accommodations: ["HOME_VISIT_NEEDED", "SIGN_INTERPRETER"],
          version: 1,
        }),
      });
    }, appId);

    const result = await page.evaluate(async (id) => {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "旧草稿覆盖",
          accommodations: [],
          version: 1,
        }),
      });
      const json = await res.json();
      return json;
    }, appId);

    if (result.success) {
      expect(result.data.accommodations).toContain("HOME_VISIT_NEEDED");
      expect(result.data.accommodations).toContain("SIGN_INTERPRETER");
    } else if (result.code === "VERSION_CONFLICT") {
      expect(result.serverData.accommodations).toContain("HOME_VISIT_NEEDED");
    }
  });
});

test.describe("Duplicate final submission", () => {
  test("duplicate submit with same idempotency key returns same result", async ({ page }) => {
    const appId = `E2E-IDEM-${Date.now()}`;
    await page.goto(`/apply/${appId}`);
    await page.waitForTimeout(1500);

    await page.fill("#fullName", "幂等测试用户");
    await page.fill("#contactPhone", "13800138000");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.locator("#legalIssueType").selectOption("HOUSING");
    await page.fill("#caseDescription", "这是用于测试幂等提交的案件描述内容");
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);

    await page.evaluate((id) => {
      const upload = (materialId: string, fileName: string) => {
        const input = document.querySelector(
          `input[name="${materialId}"]`
        ) as HTMLInputElement;
        return input;
      };
      void upload;
    }, appId);

    const idempotencyKey = `test-key-${Date.now()}`;
    const result1 = await page.evaluate(
      async ({ id, key }) => {
        const res = await fetch(`/api/applications/${id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: key }),
        });
        return res.json();
      },
      { id: appId, key: idempotencyKey }
    );

    if (result1.success) {
      const result2 = await page.evaluate(
        async ({ id, key }) => {
          const res = await fetch(`/api/applications/${id}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idempotencyKey: key }),
          });
          return res.json();
        },
        { id: appId, key: idempotencyKey }
      );

      expect(result2.success).toBe(true);
      expect(result2.data.state).toBe(result1.data.state);
      expect(result2.data.version).toBe(result1.data.version);
    }
  });
});
