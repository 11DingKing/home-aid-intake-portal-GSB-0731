import { expect, test } from "@playwright/test";
import { createNeedsCorrection, getApp } from "./helpers";

test.describe("附件元数据替换", () => {
  test("补正中替换经济困难证明：ID/种类不变、元数据更新、版本递增、合理便利保留", async ({
    page,
    request,
  }) => {
    const app = await createNeedsCorrection(request, ["TEXT_ONLY"]);
    const id = app.id;
    const econMaterial = app.materials.find((m) => m.kind === "ECONOMIC_PROOF")!;
    const versionBefore = app.version;

    await page.goto(`/apply/${id}`);
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "下一步" }).click();
    }

    const row = page.locator('[data-material-kind="ECONOMIC_PROOF"]');
    await expect(row).toContainText("经济困难证明.pdf");

    // 用新文件替换该材料的元数据
    await row.locator('input[type="file"]').setInputFiles({
      name: "new-econ-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("new proof content"),
    });
    await expect(row).toContainText("new-econ-proof.pdf");
    await expect(row).not.toContainText("经济困难证明.pdf");
    await expect(page.getByTestId("sr-announcer")).toContainText("已替换材料");

    // 服务端：材料 ID 与种类保留、元数据整体替换、版本递增、合理便利未动
    const after = await getApp(request, id);
    const replaced = after.materials.find((m) => m.kind === "ECONOMIC_PROOF")!;
    expect(replaced.id).toBe(econMaterial.id);
    expect(replaced.kind).toBe("ECONOMIC_PROOF");
    expect(after.version).toBeGreaterThan(versionBefore);
    expect(after.fields.accommodations).toEqual(["TEXT_ONLY"]);

    // 替换后重新提交成功
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "下一步" }).click();
    await page.getByRole("button", { name: "补正后重新提交" }).click();
    await expect(page.getByTestId("submitted-view")).toContainText("已重新提交");
    const final = await getApp(request, id);
    expect(final.state).toBe("RESUBMITTED");
    expect(final.fields.accommodations).toEqual(["TEXT_ONLY"]);
  });
});
