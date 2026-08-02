import { expect, test } from "@playwright/test";
import { createValidDraft, getApp, submitApp } from "./helpers";

test.describe("重复最终提交（幂等）", () => {
  test("UI 提交后同键再提交返回首次结果", async ({ page, request }) => {
    const app = await createValidDraft(request);
    await page.goto(`/apply/${app.id}`);

    // 五步全部已就绪，直接连点到确认页
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "下一步" }).click();
    }
    await page.getByRole("button", { name: "提交申请" }).click();

    await expect(page.getByTestId("submitted-view")).toContainText("已提交");
    await expect(page.getByTestId("sr-announcer")).toContainText("提交成功");

    // 用同一幂等键再提交一次（模拟双击/重试）
    const key = await page.evaluate((id) => localStorage.getItem(`idem:${id}`), app.id);
    expect(key).toBeTruthy();
    const dup = await submitApp(request, app.id, key!);
    expect(dup.status()).toBe(200);
    const body = (await dup.json()) as { duplicate: boolean; state: string };
    expect(body.duplicate).toBe(true);
    expect(body.state).toBe("SUBMITTED");

    // 服务端只有一条提交事件
    const view = await getApp(request, app.id);
    expect(view.state).toBe("SUBMITTED");
  });

  test("并发同键双提交：恰好一次生效", async ({ request }) => {
    const app = await createValidDraft(request);
    const [r1, r2] = await Promise.all([
      submitApp(request, app.id, "concurrent-key"),
      submitApp(request, app.id, "concurrent-key"),
    ]);
    const statuses = [r1.status(), r2.status()].sort();
    expect(statuses).toEqual([200, 201]);
    const bodies = await Promise.all([r1.json(), r2.json()]);
    const duplicates = bodies.map((b: { duplicate: boolean }) => b.duplicate).sort();
    expect(duplicates).toEqual([false, true]);
    const view = await getApp(request, app.id);
    expect(view.state).toBe("SUBMITTED");
  });
});
