import { expect, type Page, type APIRequestContext } from "@playwright/test";

// Shared helpers for the e2e accessibility + convergence suite.

export async function createApplication(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/applications");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function getApplication(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/applications/${id}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

// Fill the wizard with a valid NO_FIXED_INCOME application via the UI.
export async function fillValidNoFixedIncome(page: Page) {
  // Step 1: details
  await page.getByLabel("Full name", { exact: false }).fill("Robin Fields");
  await page.getByLabel("Email address", { exact: false }).fill("robin@example.org");
  await page.getByRole("button", { name: "Next →" }).click();

  // Step 2: eligibility
  await page.getByLabel("No fixed income", { exact: false }).check();
  await page.getByRole("button", { name: "Next →" }).click();

  // Step 3: documents (economic proof should be waived)
  await page.getByLabel("Identity document reference", { exact: false }).fill("ID-META-1");
  await page.getByRole("button", { name: "Next →" }).click();

  // Step 4: accommodations
  await page.getByLabel("Home visit needed").check();
  await page.getByRole("button", { name: "Next →" }).click();
}

export async function gotoApply(page: Page, id: string) {
  await page.goto(`/apply/${id}`);
  await expect(page.getByRole("heading", { name: `Application ${id}` })).toBeVisible();
}
