import { expect, test } from "@playwright/test";
import {
  addMaterial,
  createApp,
  createValidDraft,
  getApp,
  patchDraft,
  submitApp,
  VALID_FIELDS,
} from "./helpers";

test.describe("双会话字段级合并冲突", () => {
  test("同一 baseVersion 的不同字段编辑收敛；冲突字段服务端优先；旧草稿不清合理便利", async ({
    browser,
    request,
  }) => {
    // 准备：资料齐全的草稿（v3）
    const seeded = await createValidDraft(request);
    const id = seeded.id;

    const ctxA = await browser.newContext({ baseURL: "http://localhost:3100" });
    const ctxB = await browser.newContext({ baseURL: "http://localhost:3100" });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // 会话 A、B 都基于同一版本打开
    await pageA.goto(`/apply/${id}`);
    await pageB.goto(`/apply/${id}`);
    await expect(pageA.getByTestId("save-status")).toContainText("已同步");

    // 会话 B（在线）：改地址，再走到合理便利步骤勾选“需要上门服务”
    await pageB.getByLabel(/联系地址/).fill("B 的新地址 100 号");
    await expect(pageB.getByTestId("save-status")).toContainText(
      "已同步至服务器",
    );
    for (let i = 0; i < 4; i++) {
      await pageB.getByRole("button", { name: "下一步" }).click();
    }
    await pageB.getByLabel("需要上门服务").check();
    await expect(pageB.getByTestId("save-status")).toContainText(
      "已同步至服务器",
    );

    // 会话 A（离线）：改联系电话（B 没碰）+ 改地址（与 B 冲突）
    await ctxA.setOffline(true);
    await pageA.getByLabel(/联系电话/).fill("13700009999");
    await pageA.getByLabel(/联系地址/).fill("A 的离线地址");
    await expect(pageA.getByTestId("save-status")).toContainText("离线");

    // A 恢复联网 → 自动合并
    await ctxA.setOffline(false);

    // 冲突公告与提示条：地址与合理便利均冲突，服务端版本获胜
    await expect(pageA.getByTestId("conflict-notice")).toContainText(
      "联系地址",
    );
    await expect(pageA.getByTestId("conflict-notice")).toContainText(
      "合理便利",
    );
    await expect(pageA.getByTestId("sr-announcer")).toContainText(
      "已保留服务器版本",
    );

    // A 未冲突的电话保留；地址回退为 B 的值；合理便利回退为 B 勾选的需求
    await expect(pageA.getByLabel(/联系电话/)).toHaveValue("13700009999");
    await expect(pageA.getByLabel(/联系地址/)).toHaveValue("B 的新地址 100 号");
    await expect(pageA.getByTestId("save-status")).toContainText(
      "已同步至服务器",
    );

    // 服务端最终收敛：旧草稿没有清掉合理便利需求
    const view = await getApp(request, id);
    expect(view.fields.address).toBe("B 的新地址 100 号");
    expect(view.fields.contactPhone).toBe("13700009999");
    expect(view.fields.accommodations).toEqual(["HOME_VISIT_NEEDED"]);

    await ctxA.close();
    await ctxB.close();
  });

  test("服务端已受理而客户端仍是草稿：客户端整体收敛到服务端状态", async ({
    browser,
    request,
  }) => {
    const app = await createApp(request);
    const ctxA = await browser.newContext({ baseURL: "http://localhost:3100" });
    const pageA = await ctxA.newPage();
    await pageA.goto(`/apply/${app.id}`);

    // A 离线编辑
    await ctxA.setOffline(true);
    await pageA.getByLabel(/姓名/).fill("过时草稿姓名");
    await expect(pageA.getByTestId("save-status")).toContainText("离线");

    // 另一通道补全资料并提交、受理
    const patched = await patchDraft(
      request,
      app.id,
      app.version,
      VALID_FIELDS,
    );
    let view = await addMaterial(request, app.id, "IDENTITY", "身份证复印件");
    view = await addMaterial(request, app.id, "ECONOMIC_PROOF", "经济困难证明");
    void patched;
    const submitRes = await submitApp(request, app.id, "e2e-accept-key");
    expect(submitRes.ok()).toBeTruthy();
    const accept = await request.post(
      `/api/staff/applications/${app.id}/transition`,
      {
        data: { action: "ACCEPT" },
      },
    );
    expect(accept.ok()).toBeTruthy();

    // A 恢复联网：草稿 409 → 拉取全量 → 收敛为已受理只读视图
    await ctxA.setOffline(false);
    await expect(pageA.getByTestId("submitted-view")).toContainText("已受理");
    await expect(pageA.getByTestId("sr-announcer")).toContainText(
      "申请状态已更新为：已受理",
    );
    // 本地草稿已清除
    const localDraft = await pageA.evaluate(
      (id) => localStorage.getItem(`draft:${id}`),
      app.id,
    );
    expect(localDraft).toBeNull();

    await ctxA.close();
  });
});
