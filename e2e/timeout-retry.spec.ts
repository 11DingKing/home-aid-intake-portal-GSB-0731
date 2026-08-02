import { expect, test } from "@playwright/test";
import { createValidDraft, getApp } from "./helpers";

test.describe("最终提交已成功但浏览器超时重试", () => {
  test("首个提交请求在服务端成功但浏览器看到超时，重试被幂等去重", async ({
    page,
    request,
  }) => {
    const app = await createValidDraft(request);
    await page.goto(`/apply/${app.id}`);
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "下一步" }).click();
    }

    // 拦截第一次提交：请求真实到达服务端（状态已流转），但浏览器看到超时失败
    let intercepted = 0;
    await page.route("**/api/applications/*/submit", async (route) => {
      intercepted += 1;
      await route.fetch(); // 服务端实际处理成功
      await route.abort("timedout"); // 浏览器侧表现为超时
    });
    await page.getByRole("button", { name: "提交申请" }).click();
    await expect(page.getByTestId("error-summary")).toContainText("网络异常");
    expect(intercepted).toBe(1);

    // 服务端此时已是 SUBMITTED（浏览器不知情）
    const during = await getApp(request, app.id);
    expect(during.state).toBe("SUBMITTED");

    // 用户重试：同一幂等键 → duplicate，界面收敛到已提交，不报错、不重复流转
    await page.unroute("**/api/applications/*/submit");
    await page.getByRole("button", { name: "提交申请" }).click();
    await expect(page.getByTestId("submitted-view")).toContainText("已提交");
    await expect(page.getByTestId("sr-announcer")).toContainText(
      "检测到重复提交，已忽略，保持首次提交结果",
    );

    const after = await getApp(request, app.id);
    expect(after.state).toBe("SUBMITTED");
    expect(after.version).toBe(during.version);
  });
});
