import { expect, test } from "@playwright/test";
import { createApp, getApp } from "./helpers";

test.describe("离线草稿恢复", () => {
  test("离线填写→本机暂存→联网后重新打开自动恢复并合并到服务端", async ({
    page,
    context,
    request,
  }) => {
    const app = await createApp(request);
    await page.goto(`/apply/${app.id}`);

    // 断网填写
    await context.setOffline(true);
    await page.getByLabel(/姓名/).fill("张离线");
    await page.getByLabel(/联系电话/).fill("13911112222");
    await page.getByLabel(/联系地址/).fill("西城区离线胡同 1 号院");

    // 断线状态与屏幕阅读器公告
    await expect(page.getByTestId("save-status")).toContainText("离线");
    await expect(page.getByTestId("sr-announcer")).toContainText("网络已断开");

    // 本机暂存证据
    const local = await page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`draft:${id}`) ?? "null"),
      app.id,
    );
    expect(local.fields.contactName).toBe("张离线");

    // 关闭页面、恢复网络、重新打开：应从本机草稿恢复并同步
    await page.close();
    await context.setOffline(false);
    const page2 = await context.newPage();
    await page2.goto(`/apply/${app.id}`);

    await expect(page2.getByTestId("sr-announcer")).toContainText(
      "已从本机恢复未同步的离线草稿",
    );
    await expect(page2.getByLabel(/姓名/)).toHaveValue("张离线");
    await expect(page2.getByLabel(/联系地址/)).toHaveValue(
      "西城区离线胡同 1 号院",
    );
    await expect(page2.getByTestId("save-status")).toContainText(
      "已同步至服务器",
    );

    // 服务端最终收敛
    const view = await getApp(request, app.id);
    expect(view.fields.contactName).toBe("张离线");
    expect(view.fields.contactPhone).toBe("13911112222");
  });
});
