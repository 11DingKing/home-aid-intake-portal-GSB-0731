import { expect, test } from "@playwright/test";
import {
  createNeedsCorrection,
  createValidDraft,
  getApp,
  staffTransition,
  submitApp,
} from "./helpers";

test.describe("状态迁移非法回退", () => {
  test("SUBMITTED 不允许回退草稿编辑、重复提交异键、或 resubmit", async ({ request }) => {
    const app = await createValidDraft(request);
    const res = await submitApp(request, app.id, "illegal-1");
    expect(res.status()).toBe(201);

    // 回退到草稿编辑
    const patch = await request.patch(`/api/applications/${app.id}`, {
      data: { baseVersion: 2, fields: { contactName: "回退" } },
    });
    expect(patch.status()).toBe(409);
    // 异键再提交
    const again = await submitApp(request, app.id, "illegal-1-other");
    expect(again.status()).toBe(409);
    // 非 NEEDS_CORRECTION 走 resubmit
    const resub = await request.post(`/api/applications/${app.id}/resubmit`, {
      data: { idempotencyKey: "illegal-1-resub" },
    });
    expect(resub.status()).toBe(409);
  });

  test("ACCEPTED 终态：所有写操作拒绝，界面只读", async ({ page, request }) => {
    const app = await createValidDraft(request);
    await submitApp(request, app.id, "illegal-2");
    const accept = await staffTransition(request, app.id, "ACCEPT");
    expect(accept.ok()).toBeTruthy();

    const patch = await request.patch(`/api/applications/${app.id}`, {
      data: { baseVersion: 2, fields: { contactName: "回退" } },
    });
    expect(patch.status()).toBe(409);
    const corr = await request.patch(`/api/staff/applications/${app.id}/correction`, {
      data: { baseVersion: 2, reasonCode: "X" },
    });
    expect(corr.status()).toBe(409);
    const decline = await staffTransition(request, app.id, "DECLINE");
    expect(decline.status()).toBe(409);

    // UI 证据：工作人员端无可操作按钮，申请人端只读终态视图
    await page.goto(`/staff/${app.id}?view=INTAKE_REVIEW`);
    await expect(page.getByTestId("no-action")).toContainText("无可用的接续操作");
    await expect(page.getByRole("button", { name: "受理", exact: true })).toHaveCount(0);
    await page.goto(`/apply/${app.id}`);
    await expect(page.getByTestId("submitted-view")).toContainText("已受理");
    await expect(page.getByRole("button", { name: "提交申请" })).toHaveCount(0);
  });

  test("DRAFT 不允许 resubmit、补正编辑或工作人员直接受理", async ({ request }) => {
    const app = await createValidDraft(request);
    const resub = await request.post(`/api/applications/${app.id}/resubmit`, {
      data: { idempotencyKey: "illegal-3" },
    });
    expect(resub.status()).toBe(409);
    const corr = await request.patch(`/api/staff/applications/${app.id}/correction`, {
      data: { baseVersion: app.version, reasonCode: "X" },
    });
    expect(corr.status()).toBe(409);
    const accept = await staffTransition(request, app.id, "ACCEPT");
    expect(accept.status()).toBe(409);
    const view = await getApp(request, app.id);
    expect(view.state).toBe("DRAFT");
  });

  test("NEEDS_CORRECTION 不允许走首次 submit 通道", async ({ request }) => {
    const app = await createNeedsCorrection(request);
    const res = await submitApp(request, app.id, "illegal-4");
    expect(res.status()).toBe(409);
    const view = await getApp(request, app.id);
    expect(view.state).toBe("NEEDS_CORRECTION");
  });
});
