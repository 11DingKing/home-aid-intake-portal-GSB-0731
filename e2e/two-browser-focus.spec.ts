import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:3000";

function makeId() {
  return `FOCUS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function seedApp(request: APIRequestContext, id: string, data: Record<string, unknown>) {
  await request.post(`${BASE}/api/applications`, { data: { id } });
  const app = await (await request.get(`${BASE}/api/applications/${id}`)).json();
  await request.put(`${BASE}/api/applications/${id}`, {
    data: { ...data, version: app.data.version },
  });
}

async function getApp(request: APIRequestContext, id: string) {
  return (await request.get(`${BASE}/api/applications/${id}`)).json();
}

async function updateField(
  request: APIRequestContext,
  id: string,
  field: string,
  value: unknown
) {
  const app = await getApp(request, id);
  return request.put(`${BASE}/api/applications/${id}`, {
    data: { [field]: value, version: app.data.version },
  });
}

test.describe("Two-browser focus recovery", () => {
  test("browser B recovers data changed by browser A after reload", async ({ page, browser, request }) => {
    const appId = makeId();
    await seedApp(request, appId, {
      fullName: "浏览器A用户",
      contactPhone: "13800000001",
    });

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`/apply/${appId}`);
    await pageB.goto(`/apply/${appId}`);
    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    expect(await pageA.inputValue("#fullName")).toBe("浏览器A用户");
    expect(await pageB.inputValue("#fullName")).toBe("浏览器A用户");

    await updateField(request, appId, "contactPhone", "13800000002");

    await pageB.reload();
    await pageB.waitForTimeout(2000);

    expect(await pageB.inputValue("#contactPhone")).toBe("13800000002");

    await contextA.close();
    await contextB.close();
  });

  test("two sessions editing different fields - both visible after reload", async ({ browser, request }) => {
    const appId = makeId();
    await seedApp(request, appId, {
      fullName: "原始姓名",
      contactPhone: "13800000000",
    });

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`/apply/${appId}`);
    await pageB.goto(`/apply/${appId}`);
    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    await updateField(request, appId, "fullName", "A编辑姓名");
    await updateField(request, appId, "contactPhone", "13900000009");

    await pageA.reload();
    await pageA.waitForTimeout(2000);

    expect(await pageA.inputValue("#fullName")).toBe("A编辑姓名");
    expect(await pageA.inputValue("#contactPhone")).toBe("13900000009");

    await contextA.close();
    await contextB.close();
  });

  test("accommodations set in one session appear in other browser after reload", async ({ browser, request }) => {
    const appId = makeId();
    await seedApp(request, appId, {
      fullName: "便利同步测试",
      contactPhone: "13800138000",
      caseDescription: "这是用于测试双浏览器便利同步的案件描述",
      legalIssueType: "FAMILY_LAW",
      accommodations: ["HOME_VISIT_NEEDED", "BRAILLE_MATERIAL"],
    });

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`/apply/${appId}`);
    await pageB.goto(`/apply/${appId}`);
    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    for (let i = 0; i < 3; i++) {
      const btn = pageB.getByRole("button", { name: "下一步" });
      if (await btn.isVisible()) {
        await btn.click();
        await pageB.waitForTimeout(400);
      }
    }

    const homeVisit = await pageB.isChecked("#accommodations-HOME_VISIT_NEEDED");
    const braille = await pageB.isChecked("#accommodations-BRAILLE_MATERIAL");
    expect(homeVisit || braille).toBeTruthy();

    await contextA.close();
    await contextB.close();
  });

  test("focus recovery after correction state change", async ({ browser, request }) => {
    const appId = makeId();
    await request.post(`${BASE}/api/applications`, { data: { id: appId } });
    let app = await getApp(request, appId);

    await request.put(`${BASE}/api/applications/${appId}`, {
      data: {
        fullName: "焦点恢复测试",
        contactPhone: "13800138000",
        caseDescription: "这是测试焦点恢复的案件描述内容",
        legalIssueType: "HOUSING",
        exemptionReason: "NONE",
        accommodations: ["TEXT_ONLY"],
        idDocumentMeta: { materialId: "ID-1", fileName: "id.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" },
        otherMaterialMeta: { materialId: "O-1", fileName: "o.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" },
        economicProofMeta: { materialId: "E-1", fileName: "e.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" },
        version: app.data.version,
      },
    });

    await request.post(`${BASE}/api/applications/${appId}/submit`, {
      data: { idempotencyKey: `focus-${Date.now()}` },
    });

    app = await getApp(request, appId);
    await request.post(`${BASE}/api/applications/${appId}/corrections`, {
      data: {
        fields: ["economicProofMeta"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        version: app.data.version,
      },
    });

    app = await getApp(request, appId);
    expect(app.data.state).toBe("NEEDS_CORRECTION");

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/apply/${appId}`);
    await page.waitForTimeout(2500);

    await expect(page.locator(".status-badge")).toContainText("需要补正");
    await expect(page.locator(".alert-warning").first()).toContainText("补正");
    expect(await page.inputValue("#fullName")).toBe("焦点恢复测试");

    await context.close();
  });

  test("staff old link during state transition shows stale warning", async ({ page, request }) => {
    const appId = makeId();
    await request.post(`${BASE}/api/applications`, { data: { id: appId } });
    let app = await getApp(request, appId);

    await request.put(`${BASE}/api/applications/${appId}`, {
      data: {
        fullName: "过期链接测试",
        contactPhone: "13800138000",
        caseDescription: "这是测试过期链接的案件描述内容",
        legalIssueType: "HOUSING",
        exemptionReason: "NONE",
        idDocumentMeta: { materialId: "ID-1", fileName: "id.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" },
        otherMaterialMeta: { materialId: "O-1", fileName: "o.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" },
        economicProofMeta: { materialId: "E-1", fileName: "e.pdf", mimeType: "application/pdf", sizeBytes: 1024, uploadedAt: new Date().toISOString(), status: "UPLOADED" },
        version: app.data.version,
      },
    });

    await request.post(`${BASE}/api/applications/${appId}/submit`, {
      data: { idempotencyKey: `stale-${Date.now()}` },
    });

    app = await getApp(request, appId);
    await request.post(`${BASE}/api/applications/${appId}/corrections`, {
      data: {
        fields: ["economicProofMeta"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        version: app.data.version,
      },
    });

    app = await getApp(request, appId);
    const needsCorrectionVersion = app.data.version;

    await updateField(request, appId, "economicProofMeta", {
      materialId: "E-NEW",
      fileName: "new-econ.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      uploadedAt: new Date().toISOString(),
      status: "UPLOADED",
    });
    await request.post(`${BASE}/api/applications/${appId}/submit`, {
      data: { idempotencyKey: `resubmit-${Date.now()}` },
    });

    app = await getApp(request, appId);
    expect(app.data.state).toBe("RESUBMITTED");

    const staleRes = await request.get(
      `${BASE}/api/applications/${appId}/fields?role=STAFF&expectedState=NEEDS_CORRECTION`
    );
    const staleBody = await staleRes.json();
    expect(staleBody.data.staleLink).not.toBeNull();
    expect(staleBody.data.staleLink.message).toContain("变更为");
    expect(staleBody.data.application.state).toBe("RESUBMITTED");

    const staleCorr = await request.post(
      `${BASE}/api/applications/${appId}/corrections`,
      {
        data: {
          fields: ["caseDescription"],
          reasonCode: "CLARIFICATION_NEEDED",
          version: needsCorrectionVersion,
        },
      }
    );
    expect(staleCorr.status()).toBe(409);
  });
});
