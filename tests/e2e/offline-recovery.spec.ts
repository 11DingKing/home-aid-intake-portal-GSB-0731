import { test, expect } from "@playwright/test";
import { createApplication, gotoApply } from "./helpers";

// Offline draft recovery + focus restoration evidence.

test.describe("offline draft recovery", () => {
  test("unsaved edits survive a reload and are restored with an announcement", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);

    await page.getByLabel("Full name", { exact: false }).fill("Draft Survivor");
    await page.getByLabel("Phone number", { exact: false }).fill("555-0142");
    // Advance a step so the cached step index is non-zero.
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByLabel("No fixed income", { exact: false }).check();

    // Simulate a connection drop / accidental reload WITHOUT saving to server.
    await page.reload();

    // The draft is restored from localStorage.
    await expect(page.getByTestId("restored-banner")).toBeVisible();
    await expect(page.getByTestId("live-polite")).toContainText(/restored/i);

    // Focus is moved into the restored step region for keyboard/SR users.
    await expect(page.locator("#step-region")).toBeFocused();

    // Values persisted across the reload.
    // Navigate back to step 1 to confirm the name persisted.
    await page.getByRole("button", { name: "← Back" }).click();
    await expect(page.getByLabel("Full name", { exact: false })).toHaveValue("Draft Survivor");
    await expect(page.getByLabel("Phone number", { exact: false })).toHaveValue("555-0142");
  });

  test("offline banner appears when the browser goes offline", async ({ page, request, context }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);

    await context.setOffline(true);
    await page.getByLabel("Full name", { exact: false }).fill("Robin Fields");
    // Attempting to save while offline surfaces the offline/announcement path.
    await page.getByTestId("save-draft").click();
    await expect(page.getByTestId("live-polite")).toContainText(/offline/i);

    // Restore connectivity and confirm a save now converges with the server.
    await context.setOffline(false);
    await page.getByTestId("save-draft").click();
    await expect(page.getByTestId("live-polite")).toContainText(/up to date/i);
  });

  test("restored draft keeps the applicant on their last step", async ({ page, request }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);
    await page.getByLabel("Full name", { exact: false }).fill("Step Keeper");
    await page.getByRole("button", { name: "Next →" }).click(); // -> eligibility
    await page.getByLabel("No fixed income", { exact: false }).check();
    await page.getByRole("button", { name: "Next →" }).click(); // -> documents

    await page.reload();
    await expect(page.getByTestId("restored-banner")).toBeVisible();
    // We should be on the documents step (step 3) — the identity field is visible.
    await expect(page.getByLabel("Identity document reference", { exact: false })).toBeVisible();
  });
});
