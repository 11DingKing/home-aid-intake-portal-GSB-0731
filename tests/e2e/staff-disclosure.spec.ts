import { test, expect } from "@playwright/test";
import { createApplication, getApplication } from "./helpers";

// Staff continuation + minimal-disclosure evidence, plus the end-to-end
// correction -> resubmit round-trip across an applicant session and a staff
// session.

async function submitValidNone(request: import("@playwright/test").APIRequestContext, id: string) {
  const app0 = await getApplication(request, id);
  const base = app0.version as number;
  const patch = await request.patch(`/api/applications/${id}/draft`, {
    data: {
      baseVersion: base,
      edits: [
        { key: "fullName", value: "Corrina Case", baseVersion: base },
        { key: "contactEmail", value: "corrina@example.org", baseVersion: base },
        { key: "exemptionReason", value: "NONE", baseVersion: base },
        { key: "identityProof", value: "ID-META-1", baseVersion: base },
        { key: "economicProof", value: "ECON-1", baseVersion: base },
        { key: "accommodations", value: ["SIGN_INTERPRETER"], baseVersion: base },
      ],
    },
  });
  const patched = await patch.json();
  const v = patched.application.version as number;
  const res = await request.post(`/api/applications/${id}/submit`, {
    headers: { "Idempotency-Key": `submit-${id}` },
    data: { baseVersion: v },
  });
  expect(res.ok()).toBeTruthy();
}

test.describe("staff minimal disclosure", () => {
  test("INTAKE_REVIEW shows only whitelisted fields and never applicant PII", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await submitValidNone(request, id);

    await page.goto(`/staff/${id}?view=INTAKE_REVIEW`);
    await expect(page.getByTestId("active-view")).toHaveText("INTAKE_REVIEW");

    // Disclosed fields present.
    await expect(page.getByTestId("field-exemptionReason")).toContainText("NONE");
    await expect(page.getByTestId("field-accommodations")).toContainText("SIGN_INTERPRETER");
    await expect(page.getByTestId("field-materialMetadata")).toBeVisible();

    // PII never rendered.
    await expect(page.getByText("Corrina Case")).toHaveCount(0);
    await expect(page.getByText("corrina@example.org")).toHaveCount(0);

    // Correction-only fields are not part of this view.
    await expect(page.getByTestId("field-correctionFields")).toHaveCount(0);
  });

  test("the staff detail API payload contains no over-privileged keys", async ({ request }) => {
    const id = await createApplication(request);
    await submitValidNone(request, id);
    const res = await request.get(`/api/staff/applications/${id}?view=INTAKE_REVIEW`);
    const body = await res.json();
    // Only whitelisted keys (plus the __view tag) are present.
    expect(Object.keys(body).sort()).toEqual(
      ["__view", "accommodations", "exemptionReason", "id", "materialMetadata", "state"].sort(),
    );
    expect(body).not.toHaveProperty("fullName");
    expect(body).not.toHaveProperty("contactEmail");
    expect(body).not.toHaveProperty("contactPhone");
  });

  test("CORRECTION_REVIEW exposes correction metadata but not raw PII", async ({ request }) => {
    const id = await createApplication(request);
    await submitValidNone(request, id);
    await request.post(`/api/staff/applications/${id}/request-correction`, {
      data: { fields: ["economicProof"], reasonCode: "ECONOMIC_PROOF_REQUIRED" },
    });
    const res = await request.get(`/api/staff/applications/${id}?view=CORRECTION_REVIEW`);
    const body = await res.json();
    expect(body).toHaveProperty("correctionFields");
    expect(body.correctionFields).toContain("economicProof");
    expect(body).toHaveProperty("submittedFieldMetadata");
    expect(body).not.toHaveProperty("fullName");
    expect(body).not.toHaveProperty("materialMetadata");
  });
});

test.describe("correction -> resubmit round-trip (two sessions)", () => {
  test("staff requests a correction; applicant fixes and resubmits", async ({
    page,
    request,
  }) => {
    // Applicant session: submit a NONE application.
    const id = await createApplication(request);
    await submitValidNone(request, id);

    // Staff session: open the application and request a correction via the UI.
    await page.goto(`/staff/${id}`);
    await page.getByTestId("toggle-correction").click();
    await page.getByLabel("economicProof", { exact: true }).check();
    await page.getByTestId("submit-correction").click();

    // Status now reflects NEEDS_CORRECTION (non-color badge).
    await expect(page.getByTestId("status-badge").first()).toHaveAttribute(
      "data-state",
      "NEEDS_CORRECTION",
    );

    // Applicant session: reload the wizard, see the correction banner, fix and resubmit.
    await page.goto(`/apply/${id}`);
    await expect(page.getByTestId("correction-banner")).toContainText(/economicProof/);

    // Go to documents step and change the economic proof.
    await page.getByRole("button", { name: "Next →" }).click(); // eligibility
    await page.getByRole("button", { name: "Next →" }).click(); // documents
    await page.getByLabel("Economic-hardship document reference", { exact: false }).fill("ECON-2");
    await page.getByRole("button", { name: "Next →" }).click(); // accommodations
    await page.getByRole("button", { name: "Next →" }).click(); // review
    await page.getByTestId("submit").click();

    // Announcement + status converge to RESUBMITTED.
    await expect(page.getByTestId("live-polite")).toContainText(/submitted/i);
    await expect(page.getByTestId("status-badge")).toHaveAttribute("data-state", "RESUBMITTED");

    // Server confirms convergence by id + version.
    const final = await getApplication(request, id);
    expect(final.state).toBe("RESUBMITTED");
    expect(final.values.economicProof).toBe("ECON-2");
    expect(final.openCorrection).toBeNull();
  });

  test("submitting a NONE application without economic proof is blocked with focused errors", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await page.goto(`/apply/${id}`);
    await page.getByLabel("Full name", { exact: false }).fill("No Proof");
    await page.getByLabel("Email address", { exact: false }).fill("noproof@example.org");
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByLabel("None of these", { exact: false }).check();
    await page.getByRole("button", { name: "Next →" }).click();
    await page.getByLabel("Identity document reference", { exact: false }).fill("ID-META-1");
    // Leave economic proof empty though it is now required.
    await page.getByRole("button", { name: "Next →" }).click(); // accommodations
    await page.getByRole("button", { name: "Next →" }).click(); // review
    await page.getByTestId("submit").click();

    const summary = page.getByTestId("error-summary");
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(/economic hardship/i);
  });
});
