import { expect, test } from "@playwright/test";
import { createNeedsCorrection, getApp } from "./helpers";

test.describe("补正权限边界与字段级接续", () => {
  test("NEEDS_CORRECTION→RESUBMITTED 切换瞬间的旧链接：写入被拒、编辑器消失、理由可审计", async ({
    browser,
    request,
  }) => {
    const app = await createNeedsCorrection(request);
    const id = app.id;

    const ctxStaff = await browser.newContext({ baseURL: "http://localhost:3100" });
    const ctxApplicant = await browser.newContext({ baseURL: "http://localhost:3100" });
    const staffPage = await ctxStaff.newPage();
    const applicantPage = await ctxApplicant.newPage();

    // 工作人员打开补正编辑器（此刻 NEEDS_CORRECTION）
    await staffPage.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await expect(staffPage.getByRole("button", { name: "保存补正要求" })).toBeVisible();

    // 另一会话：申请人完成补正并重新提交 → RESUBMITTED
    await applicantPage.goto(`/apply/${id}`);
    for (let i = 0; i < 5; i++) {
      await applicantPage.getByRole("button", { name: "下一步" }).click();
    }
    await applicantPage.getByRole("button", { name: "补正后重新提交" }).click();
    await expect(applicantPage.getByTestId("submitted-view")).toContainText("已重新提交");

    // 工作人员在旧页面上保存 → 服务端按最新状态重算：409，编辑器随刷新消失
    await staffPage.locator("#edit-reason-code").fill("STALE_CODE");
    await staffPage.getByRole("button", { name: "保存补正要求" }).click();
    await expect(staffPage.getByRole("button", { name: "保存补正要求" })).toHaveCount(0);
    await expect(staffPage.locator(".badge").first()).toContainText("状态：已重新提交");

    // 拒绝理由进入审计轨迹（含角色与动作）
    const audit = await request.get(`/api/staff/applications/${id}/audit`);
    const events = ((await audit.json()) as { events: Array<{ actor: string; note: string }> })
      .events;
    const rejection = events.find(
      (e) => e.actor === "STAFF" && e.note.includes("STATE_CONFLICT") && e.note.includes("PATCH correction"),
    );
    expect(rejection).toBeTruthy();

    // reasonCode 未被旧链接篡改
    const view = await getApp(request, id);
    expect(
      (view as unknown as { latestCorrection: { reasonCode: string } }).latestCorrection
        .reasonCode,
    ).toBe("ECONOMIC_PROOF_REQUIRED");

    await ctxStaff.close();
    await ctxApplicant.close();
  });

  test("恶意构造隐藏字段提交：403 + 整体拒绝 + 合理便利不被动 + 审计理由", async ({
    page,
    request,
  }) => {
    const app = await createNeedsCorrection(request);
    const id = app.id;

    // 申请人通道：夹带 state / idempotencyKey / 清空 accommodations 的恶意草稿
    const evil = await request.patch(`/api/applications/${id}`, {
      data: {
        baseVersion: app.version,
        fields: {
          contactName: "恶意篡改",
          state: "ACCEPTED",
          idempotencyKey: "hacked-key",
          accommodations: [],
        },
      },
    });
    expect(evil.status()).toBe(403);
    const evilBody = (await evil.json()) as {
      error: { code: string; details: { rejectedFields: string[] } };
    };
    expect(evilBody.error.code).toBe("FIELD_FORBIDDEN");
    expect(evilBody.error.details.rejectedFields).toEqual(
      expect.arrayContaining(["state", "idempotencyKey"]),
    );
    // 响应不泄露任何申请人字段值
    expect(JSON.stringify(evilBody)).not.toContain("测试用户");

    // 整体拒绝：合法字段也未生效，合理便利原样保留
    const after1 = await getApp(request, id);
    expect(after1.fields.contactName).toBe("测试用户");
    expect(after1.fields.accommodations).toEqual(["HOME_VISIT_NEEDED"]);

    // 工作人员通道：补正接口夹带申请人字段
    const evilStaff = await request.patch(`/api/staff/applications/${id}/correction`, {
      data: {
        baseVersion: app.version,
        reasonCode: "NEW_CODE",
        accommodations: [],
        contactName: "evil",
      },
    });
    expect(evilStaff.status()).toBe(403);
    const staffBody = (await evilStaff.json()) as {
      error: { code: string; details: { rejectedFields: string[] } };
    };
    expect(staffBody.error.details.rejectedFields).toEqual(
      expect.arrayContaining(["accommodations", "contactName"]),
    );

    // 审计轨迹包含两次拒绝及角色
    const audit = await request.get(`/api/staff/applications/${id}/audit`);
    const events = ((await audit.json()) as { events: Array<{ actor: string; note: string }> })
      .events;
    expect(
      events.some((e) => e.actor === "APPLICANT" && e.note.includes("FIELD_FORBIDDEN")),
    ).toBe(true);
    expect(events.some((e) => e.actor === "STAFF" && e.note.includes("FIELD_FORBIDDEN"))).toBe(
      true,
    );

    // 工作人员页面审计区可见
    await page.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await expect(page.getByTestId("audit-log")).toContainText("FIELD_FORBIDDEN");
    // 补正内容未被篡改
    const final = await getApp(request, id);
    expect(
      (final as unknown as { latestCorrection: { reasonCode: string } }).latestCorrection
        .reasonCode,
    ).toBe("ECONOMIC_PROOF_REQUIRED");
  });

  test("两个浏览器各自完成焦点恢复：申请人错误汇总、工作人员冲突提示", async ({
    browser,
    request,
  }) => {
    const app = await createNeedsCorrection(request);
    const id = app.id;

    const ctxA = await browser.newContext({ baseURL: "http://localhost:3100" });
    const ctxB = await browser.newContext({ baseURL: "http://localhost:3100" });
    const ctxC = await browser.newContext({ baseURL: "http://localhost:3100" });
    const pageA = await ctxA.newPage();
    const staff1 = await ctxB.newPage();
    const staff2 = await ctxC.newPage();

    // 浏览器 A：申请人表单校验失败 → 焦点恢复到错误汇总
    await pageA.goto(`/apply/${id}`);
    await pageA.getByLabel(/姓名/).fill("");
    await pageA.getByRole("button", { name: "下一步" }).click();
    await expect(pageA.getByTestId("error-summary")).toBeFocused();

    // 浏览器 B/C：两个工作人员会话制造补正冲突 → 焦点恢复到冲突提示
    await staff1.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await staff2.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await staff1.locator("#edit-reason-code").fill("FOCUS_ONE");
    await staff1.getByRole("button", { name: "保存补正要求" }).click();
    await expect(staff1.getByTestId("correction-save-result")).toContainText("补正要求已保存");
    await staff2.locator("#edit-reason-code").fill("FOCUS_TWO");
    await staff2.getByRole("button", { name: "保存补正要求" }).click();
    await expect(staff2.getByTestId("staff-conflict-notice")).toBeFocused();

    // 焦点恢复没有跨会话串扰
    await expect(pageA.getByTestId("error-summary")).toBeFocused();

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });

  test("字段级接续：视图随状态重新计算，越权字段不进 HTML 也不进 API", async ({
    page,
    request,
  }) => {
    const app = await createNeedsCorrection(request);
    const id = app.id;

    // NEEDS_CORRECTION：INTAKE_REVIEW 不适用 → API 只回 id/state/viewNotApplicable
    const api = await request.get(`/api/staff/applications/${id}?view=INTAKE_REVIEW`);
    const apiJson = (await api.json()) as Record<string, unknown>;
    expect(Object.keys(apiJson).sort()).toEqual(["id", "state", "viewNotApplicable"]);
    expect(JSON.stringify(apiJson)).not.toContain("测试用户");
    expect(JSON.stringify(apiJson)).not.toContain("13900001111");

    // HTML 同样不含
    await page.goto(`/staff/${id}?view=INTAKE_REVIEW`);
    await expect(page.getByTestId("view-not-applicable")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("测试用户");
    expect(html).not.toContain("13900001111");
    expect(html).not.toContain("用人单位拖欠工资");

    // 申请人提交后（RESUBMITTED）：同一链接重新计算，INTAKE 恢复可用
    await request.post(`/api/applications/${id}/resubmit`, {
      data: { idempotencyKey: "boundary-resubmit" },
    });
    const api2 = await request.get(`/api/staff/applications/${id}?view=INTAKE_REVIEW`);
    const api2Json = (await api2.json()) as Record<string, unknown>;
    expect(api2Json.viewNotApplicable).toBeUndefined();
    expect(Object.keys(api2Json).sort()).toEqual(
      ["accommodations", "exemptionReason", "id", "materialMetadata", "state"].sort(),
    );
    // 但申请人隐私字段（姓名/电话/地址/案情）仍不可见
    expect(JSON.stringify(api2Json)).not.toContain("测试用户");
    expect(JSON.stringify(api2Json)).not.toContain("13900001111");
    // 申请人 GET 的 permissions 也按状态重算
    const applicantView = await getApp(request, id);
    expect(
      (applicantView as unknown as { permissions: { editable: boolean; writableFields: string[] } })
        .permissions,
    ).toEqual({ editable: false, writableFields: [] });
  });
});
