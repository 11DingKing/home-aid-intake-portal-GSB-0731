import { expect, test } from "@playwright/test";
import { createApp } from "./helpers";

test.describe("无障碍：键盘流程、屏幕阅读器公告、错误焦点、断线恢复", () => {
  test("错误焦点恢复与可程序识别的控件名称/错误关联", async ({
    page,
    request,
  }) => {
    const app = await createApp(request);
    await page.goto(`/apply/${app.id}`);

    // 空表单点“下一步” → 错误汇总获焦
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByTestId("error-summary")).toBeFocused();
    await expect(page.getByTestId("error-summary")).toContainText(
      "有 3 处需要修改",
    );

    // 每个错误控件：label 关联 + aria-invalid + aria-describedby 指向 role=alert 错误
    const name = page.locator("#contactName");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    const describedBy = await name.getAttribute("aria-describedby");
    expect(describedBy).toContain("contactName-error");
    await expect(page.locator("#contactName-error")).toHaveAttribute(
      "role",
      "alert",
    );
    await expect(page.locator('label[for="contactName"]')).toContainText(
      "姓名",
    );

    // 错误汇总链接把焦点送回对应控件
    await page
      .getByTestId("error-summary")
      .getByRole("link", { name: "姓名" })
      .click();
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe("contactName");
  });

  test("键盘完成第一步：Tab 顺序可用，步骤切换后焦点恢复到步骤标题并公告", async ({
    page,
    request,
  }) => {
    const app = await createApp(request);
    await page.goto(`/apply/${app.id}`);

    // 纯键盘填写（从当前焦点开始依次 Tab）
    await page.locator("#contactName").focus();
    await page.keyboard.type("键盘用户");
    await page.keyboard.press("Tab");
    await page.keyboard.type("13933334444");
    await page.keyboard.press("Tab");
    await page.keyboard.type("键盘市无障碍路 1 号");

    // Tab 到“下一步”按钮并回车
    for (let i = 0; i < 6; i++) {
      const tag = await page.evaluate(() =>
        document.activeElement?.textContent?.trim(),
      );
      if (tag === "下一步") break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");

    // 焦点恢复到第二步标题，读屏公告步骤变化
    await expect(page.getByTestId("step-heading")).toBeFocused();
    await expect(page.getByTestId("step-heading")).toContainText(
      "第 2 步：案情信息",
    );
    await expect(page.getByTestId("sr-announcer")).toContainText(
      "第 2 步，共 6 步：案情信息",
    );

    // 步骤导航 aria-current
    await expect(page.locator('[aria-current="step"]')).toContainText(
      "案情信息",
    );
  });

  test("屏幕阅读器公告区语义与断线/恢复公告", async ({
    page,
    context,
    request,
  }) => {
    const app = await createApp(request);
    await page.goto(`/apply/${app.id}`);

    const announcer = page.getByTestId("sr-announcer");
    await expect(announcer).toHaveAttribute("role", "status");
    await expect(announcer).toHaveAttribute("aria-live", "polite");

    await context.setOffline(true);
    await expect(announcer).toContainText("网络已断开");
    await expect(page.getByTestId("save-status")).toContainText(
      "离线：修改已保存在本机",
    );

    await page.getByLabel(/姓名/).fill("断线测试");
    await context.setOffline(false);
    await expect(announcer).toContainText("网络已恢复，正在同步离线修改");
    await expect(page.getByTestId("save-status")).toContainText(
      "已同步至服务器",
    );
  });

  test("状态不只靠颜色：符号 + 文字 + 边框样式", async ({ page, request }) => {
    const app = await createApp(request);
    await page.goto(`/apply/${app.id}`);
    const badge = page.locator(".badge").first();
    await expect(badge).toContainText("状态：草稿");
    await expect(badge.locator(".icon")).toContainText("◐");
    // 跳到主要内容链接：从挂载时聚焦的步骤标题逆序 Shift+Tab 到页首
    const skip = page.locator(".skip-link");
    for (let i = 0; i < 10; i++) {
      if (
        (await page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.className,
        )) === "skip-link"
      )
        break;
      await page.keyboard.press("Shift+Tab");
    }
    await expect(skip).toBeFocused();
    await expect(skip).toContainText("跳到主要内容");
  });
});
