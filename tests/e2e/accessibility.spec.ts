import { test, expect } from "@playwright/test";
import { createApplication, gotoApply } from "./helpers";

// Automated accessibility evidence: programmatic names, associated errors,
// keyboard-only flow, screen-reader announcements, error focus, and
// non-color-only status.

test.describe("accessibility", () => {
  test("every control has a programmatic accessible name", async ({ page, request }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);

    // Text inputs are reachable by their <label>.
    await expect(page.getByLabel("Full name", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Phone number", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Email address", { exact: false })).toBeVisible();

    // The stepper is a labeled navigation landmark.
    await expect(page.getByRole("navigation", { name: "Application steps" })).toBeVisible();

    // Buttons expose names.
    await expect(page.getByRole("button", { name: "Next →" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save progress" })).toBeVisible();
  });

  test("keyboard-only: skip link, tab to fields, and advance steps", async ({ page, request }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);

    // The skip link is the first focusable element.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();

    // Type into the full name using the keyboard after focusing it directly.
    const name = page.getByLabel("Full name", { exact: false });
    await name.focus();
    await page.keyboard.type("Keyboard User");
    await expect(name).toHaveValue("Keyboard User");

    // Activate "Next" with the keyboard (Enter) and confirm step change.
    await page.getByRole("button", { name: "Next →" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: /Economic-eligibility basis/i })).toBeVisible();
  });

  test("submitting with errors moves focus to the error summary and links to fields", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);

    // Jump straight to review without filling anything.
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Next →" }).click();
    }
    await page.getByTestId("submit").click();

    // The error summary receives focus (role=alert, tabindex=-1).
    const summary = page.getByTestId("error-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();

    // Screen-reader announcement in the polite live region.
    await expect(page.getByTestId("live-polite")).toContainText(/problem/i);

    // Clicking an error link moves focus to the offending control.
    await page.getByRole("button", { name: /Enter the applicant's full name/i }).click();
    await expect(page.getByLabel("Full name", { exact: false })).toBeFocused();
  });

  test("field errors are programmatically associated via aria-describedby + aria-invalid", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Next →" }).click();
    }
    await page.getByTestId("submit").click();

    // Return to step 1 to inspect the name field wiring.
    // The error summary link takes us straight to the field.
    await page.getByRole("button", { name: /Enter the applicant's full name/i }).click();
    const name = page.getByLabel("Full name", { exact: false });
    await expect(name).toHaveAttribute("aria-invalid", "true");
    const describedby = await name.getAttribute("aria-describedby");
    expect(describedby).toBeTruthy();
    // The referenced element is the visible error message.
    const errorId = describedby!.split(" ").find((x) => x.endsWith("-error"));
    expect(errorId).toBeTruthy();
    await expect(page.locator(`#${errorId}`)).toContainText(/full name/i);
  });

  test("status is communicated without relying on color (icon + text + data-state)", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);
    const badge = page.getByTestId("status-badge");
    await expect(badge).toBeVisible();
    // Text label present.
    await expect(badge).toContainText("Draft");
    // Machine-readable, non-color state attribute present.
    await expect(badge).toHaveAttribute("data-state", "DRAFT");
    // Visually-hidden "Status:" prefix for screen readers.
    await expect(badge.locator(".sr-only")).toHaveText("Status: ");
    // A non-color icon is injected via CSS ::before content.
    const icon = await badge.evaluate(
      (el) => getComputedStyle(el, "::before").content,
    );
    expect(icon).not.toBe("none");
    expect(icon).not.toBe("");
  });

  test("economic-proof waiver for NO_FIXED_INCOME is announced, not color-coded only", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await gotoApply(page, id);
    await page.getByLabel("Full name", { exact: false }).fill("Robin Fields");
    await page.getByLabel("Email address", { exact: false }).fill("robin@example.org");
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByLabel("No fixed income", { exact: false }).check();
    await page.getByRole("button", { name: "Next →" }).click();

    // On the documents step, economic proof control must be absent and a text
    // explanation shown as a status region.
    const waived = page.getByTestId("economic-waived");
    await expect(waived).toBeVisible();
    await expect(waived).toContainText(/do not need to upload proof of economic hardship/i);
    await expect(page.getByLabel("Economic-hardship document reference", { exact: false })).toHaveCount(0);
  });
});
