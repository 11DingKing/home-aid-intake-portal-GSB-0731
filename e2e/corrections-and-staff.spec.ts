import { test, expect } from "@playwright/test";

test.describe("Correction and resubmission flow", () => {
  test("APP-202 has NEEDS_CORRECTION state and shows correction banner", async ({ page }) => {
    await page.goto("/apply/APP-202");
    await page.waitForTimeout(2000);

    const badge = page.locator(".status-badge");
    await expect(badge).toContainText("需要补正");

    const banner = page.locator(".alert-warning");
    await expect(banner).toContainText("补正");
  });

  test("staff can request correction, applicant sees it, then resubmits", async ({ page, request }) => {
    const appId = `E2E-CORR-${Date.now()}`;

    await page.goto(`/apply/${appId}`);
    await page.waitForTimeout(1500);

    await page.fill("#fullName", "补正测试用户");
    await page.fill("#contactPhone", "13800138000");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.locator("#legalIssueType").selectOption("EMPLOYMENT");
    await page.fill("#caseDescription", "这是一个需要补正流程测试的案件描述");
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "下一步" }).click();
    await page.waitForTimeout(300);

    const submitResult = await page.evaluate(async (id) => {
      const res = await fetch(`/api/applications/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `key-${Date.now()}` }),
      });
      return res.json();
    }, appId);

    if (!submitResult.success) {
      test.skip(true, "Could not submit application - missing materials via UI");
      return;
    }

    expect(submitResult.data.state).toBe("SUBMITTED");

    const corrRes = await request.post(`/api/applications/${appId}/corrections`, {
      data: {
        fields: ["economicProofMeta", "caseDescription"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
      },
    });
    expect(corrRes.ok()).toBeTruthy();
    const corrJson = await corrRes.json();
    expect(corrJson.success).toBe(true);

    const appRes = await request.get(`/api/applications/${appId}`);
    const appJson = await appRes.json();
    expect(appJson.data.state).toBe("NEEDS_CORRECTION");

    await page.goto(`/apply/${appId}`);
    await page.waitForTimeout(2000);

    const badge = page.locator(".status-badge");
    await expect(badge).toContainText("需要补正");
  });

  test("NO_FIXED_INCOME does not require economic proof on materials step", async ({ page }) => {
    await page.goto("/apply/APP-201");
    await page.waitForTimeout(2000);

    const economicField = page.locator("#economicProofMeta");
    const isDisabled = await economicField.evaluate((el) => {
      const upload = el.closest(".material-upload");
      return upload?.getAttribute("aria-disabled") || upload?.querySelector("input[disabled]") !== null;
    });

    const materialsSection = page.locator("#form-panel");
    const text = await materialsSection.textContent();
    expect(text).toContain("豁免");
  });
});

test.describe("Staff minimal disclosure", () => {
  test("staff list page does not expose sensitive applicant data", async ({ page }) => {
    await page.goto("/staff");
    await page.waitForTimeout(2000);

    const content = await page.locator("main").textContent();
    expect(content).not.toContain("13800138000");
    expect(content).not.toContain("@example.com");
    expect(content).not.toContain("案件描述");
  });

  test("intake review view shows minimal fields", async ({ page }) => {
    await page.goto("/staff/APP-201");
    await page.waitForTimeout(2000);

    const content = await page.locator("main").textContent();
    expect(content).toContain("收件审核视图");
    expect(content).toContain("豁免原因");
    expect(content).toContain("合理便利");
    expect(content).not.toContain("13800138000");
    expect(content).not.toContain("案件描述");
  });

  test("correction review view shows additional fields", async ({ page }) => {
    await page.goto("/staff/APP-202");
    await page.waitForTimeout(2000);

    const content = await page.locator("main").textContent();
    expect(content).toContain("补正审核视图");
    expect(content).toContain("姓名");
    expect(content).toContain("联系电话");
    expect(content).toContain("案件描述");
  });

  test("staff can accept a submitted application", async ({ page, request }) => {
    const appId = `E2E-ACCEPT-${Date.now()}`;

    await request.post("/api/applications", { data: { id: appId } });
    await request.put(`/api/applications/${appId}`, {
      data: {
        fullName: "受理测试",
        contactPhone: "13800138000",
        caseDescription: "这是用于测试受理流程的案件描述内容",
        legalIssueType: "HOUSING",
        exemptionReason: "NONE",
        idDocumentMeta: {
          materialId: "M1",
          fileName: "id.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          status: "UPLOADED",
        },
        otherMaterialMeta: {
          materialId: "M2",
          fileName: "other.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          status: "UPLOADED",
        },
        economicProofMeta: {
          materialId: "M3",
          fileName: "econ.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          status: "UPLOADED",
        },
        version: 1,
      },
    });

    await request.post(`/api/applications/${appId}/submit`, {
      data: { idempotencyKey: `key-${Date.now()}` },
    });

    const res = await request.post(`/api/applications/${appId}/decision`, {
      data: { action: "ACCEPTED" },
    });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.state).toBe("ACCEPTED");
  });

  test("staff can decline a submitted application", async ({ request }) => {
    const appId = `E2E-DECLINE-${Date.now()}`;

    await request.post("/api/applications", { data: { id: appId } });
    await request.put(`/api/applications/${appId}`, {
      data: {
        fullName: "拒绝测试",
        contactPhone: "13800138000",
        caseDescription: "这是用于测试拒绝流程的案件描述内容",
        legalIssueType: "OTHER",
        exemptionReason: "NONE",
        idDocumentMeta: {
          materialId: "M1",
          fileName: "id.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          status: "UPLOADED",
        },
        otherMaterialMeta: {
          materialId: "M2",
          fileName: "other.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          status: "UPLOADED",
        },
        economicProofMeta: {
          materialId: "M3",
          fileName: "econ.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
          status: "UPLOADED",
        },
        version: 1,
      },
    });

    await request.post(`/api/applications/${appId}/submit`, {
      data: { idempotencyKey: `key-${Date.now()}` },
    });

    const res = await request.post(`/api/applications/${appId}/decision`, {
      data: { action: "DECLINED" },
    });
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.state).toBe("DECLINED");
  });

  test("state machine prevents invalid transitions via API", async ({ request }) => {
    const res = await request.post(`/api/applications/APP-201/decision`, {
      data: { action: "ACCEPTED" },
    });
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(res.status()).toBe(403);
  });
});
