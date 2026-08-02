import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { createApplication, getApplication } from "./helpers";

// -------------------------------------------------------------------------
// Round 3 adversarial evidence: field-level continuation views and correction
// permission boundaries are recomputed server-side on every load and submit.
// These tests prove that:
//   * over-privileged fields never appear in the HTML or the API response,
//   * a reasonable-accommodation need is never overwritten by a boundary race,
//   * every refusal leaves an auditable reason code.
// -------------------------------------------------------------------------

async function submitValidNoneWithAccommodation(request: APIRequestContext, id: string) {
  const app0 = await getApplication(request, id);
  const base = app0.version as number;
  const patch = await request.patch(`/api/applications/${id}/draft`, {
    data: {
      baseVersion: base,
      step: "review",
      edits: [
        { key: "fullName", value: "Secret Person", baseVersion: base, baseValue: null },
        { key: "contactEmail", value: "secret@example.org", baseVersion: base, baseValue: null },
        { key: "contactPhone", value: "555-0199", baseVersion: base, baseValue: null },
        { key: "exemptionReason", value: "NONE", baseVersion: base, baseValue: null },
        { key: "identityProof", value: "ID-META-1", baseVersion: base, baseValue: null },
        { key: "economicProof", value: "ECON-1", baseVersion: base, baseValue: null },
        { key: "accommodations", value: ["HOME_VISIT_NEEDED"], baseVersion: base, baseValue: [] },
      ],
    },
  });
  const v = (await patch.json()).application.version as number;
  const res = await request.post(`/api/applications/${id}/submit`, {
    headers: { "Idempotency-Key": `sub-${id}` },
    data: { baseVersion: v },
  });
  expect(res.ok()).toBeTruthy();
}

test.describe("stale link at the NEEDS_CORRECTION <-> RESUBMITTED boundary", () => {
  test("a stale CORRECTION_REVIEW link is downgraded and audited once the app leaves correction", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await submitValidNoneWithAccommodation(request, id);

    // Staff moves it into NEEDS_CORRECTION. A staff member copies the
    // CORRECTION_REVIEW link at this instant.
    await request.post(`/api/staff/applications/${id}/request-correction`, {
      data: { fields: ["economicProof"], reasonCode: "ECONOMIC_PROOF_REQUIRED" },
    });

    // The applicant resubmits — the app flips to RESUBMITTED. Then it is accepted,
    // moving fully out of any correction-appropriate state.
    const nc = await getApplication(request, id);
    await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: nc.version,
        step: "materials",
        edits: [{ key: "economicProof", value: "ECON-2", baseVersion: nc.version, baseValue: "ECON-1" }],
      },
    });
    const fixed = await getApplication(request, id);
    await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": `resub-${id}` },
      data: { baseVersion: fixed.version },
    });
    // Accept it so the app moves fully out of any correction-appropriate state
    // (ACCEPTED -> intake), making the stale correction link over-privileged.
    const acc = await request.post(`/api/staff/applications/${id}/decision`, {
      data: { action: "accept" },
    });
    expect(acc.ok()).toBeTruthy();

    // Now open the STALE correction link. Server recomputes the view from the
    // current state (ACCEPTED/RESUBMITTED -> intake). The HTML must show the
    // enforced view, not the requested one.
    await page.goto(`/staff/${id}?view=CORRECTION_REVIEW`);
    await expect(page.getByTestId("stale-view-notice")).toBeVisible();
    await expect(page.getByTestId("active-view")).toHaveText("INTAKE_REVIEW");
    // The correction-only field is absent from the rendered HTML.
    await expect(page.getByTestId("field-correctionFields")).toHaveCount(0);

    // The API response body likewise contains no correction-only keys and no PII.
    const apiRes = await request.get(`/api/staff/applications/${id}?view=CORRECTION_REVIEW`);
    expect(apiRes.headers()["x-view-downgraded"]).toBe("true");
    expect(apiRes.headers()["x-enforced-view"]).toBe("INTAKE_REVIEW");
    const body = await apiRes.json();
    expect(body).not.toHaveProperty("correctionFields");
    expect(body).not.toHaveProperty("fullName");
    expect(body).not.toHaveProperty("contactEmail");
    expect(body).not.toHaveProperty("contactPhone");

    // The downgrade is recorded in the audit trail with a reason code.
    const audit = await (await request.get(`/api/applications/${id}/audit`)).json();
    const downgrade = audit.entries.find(
      (e: { reasonCode?: string }) => e.reasonCode === "STALE_VIEW_DOWNGRADED",
    );
    expect(downgrade).toBeTruthy();
    expect(downgrade.deniedFields.length).toBeGreaterThan(0);
  });
});

test.describe("over-privileged fields never reach HTML or API", () => {
  test("applicant PII is absent from the staff page markup and JSON in every view", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await submitValidNoneWithAccommodation(request, id);

    for (const view of ["INTAKE_REVIEW", "CORRECTION_REVIEW"]) {
      await page.goto(`/staff/${id}?view=${view}`);
      // Full page HTML never contains the PII values.
      const html = await page.content();
      expect(html).not.toContain("Secret Person");
      expect(html).not.toContain("secret@example.org");
      expect(html).not.toContain("555-0199");

      const res = await request.get(`/api/staff/applications/${id}?view=${view}`);
      const body = await res.json();
      expect(body).not.toHaveProperty("fullName");
      expect(body).not.toHaveProperty("contactEmail");
      expect(body).not.toHaveProperty("contactPhone");
    }
  });
});

test.describe("maliciously crafted hidden-field submit is rejected and audited", () => {
  test("an unknown/over-privileged key is dropped, accommodations preserved, refusal audited", async ({
    request,
  }) => {
    const id = await createApplication(request);
    const app0 = await getApplication(request, id);
    const base = app0.version as number;
    // Seed a live accommodation first.
    await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: base,
        step: "accommodations",
        edits: [
          { key: "accommodations", value: ["BRAILLE_MATERIAL"], baseVersion: base, baseValue: [] },
        ],
      },
    });

    // Attacker crafts a hidden field ("isAdmin") plus an out-of-step field, and
    // ALSO tries to clear the accommodation from a stale base — all in one submit.
    const cur = await getApplication(request, id);
    const res = await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: cur.version,
        step: "contact", // only contact fields are writable on this step
        edits: [
          { key: "fullName", value: "Legit Contact", baseVersion: cur.version, baseValue: null },
          { key: "isAdmin", value: "true", baseVersion: cur.version, baseValue: null },
          { key: "exemptionReason", value: "NONE", baseVersion: cur.version, baseValue: null },
          // Stale attempt to wipe the accommodation.
          { key: "accommodations", value: [], baseVersion: base, baseValue: [] },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    // Only the in-step field was applied.
    expect(body.applied.map((a: { key: string }) => a.key)).toEqual(["fullName"]);
    // The crafted + out-of-step keys are denied with reasons.
    const deniedByKey = Object.fromEntries(
      body.denied.map((d: { key: string; reasonCode: string }) => [d.key, d.reasonCode]),
    );
    expect(deniedByKey.isAdmin).toBe("UNKNOWN_FIELD");
    expect(deniedByKey.exemptionReason).toBe("NOT_IN_STEP_WHITELIST");
    // accommodations is out-of-step here too, so it is refused (never merged),
    // guaranteeing the stale wipe cannot take effect.
    expect(deniedByKey.accommodations).toBe("NOT_IN_STEP_WHITELIST");

    // Persistence proof: crafted key absent, accommodation intact.
    const final = await getApplication(request, id);
    expect(final.values.accommodations).toEqual(["BRAILLE_MATERIAL"]);
    expect(final.values.fullName).toBe("Legit Contact");
    expect(final.fields).not.toHaveProperty("isAdmin");

    // Audit proof: a PARTIAL write with the denied fields + a reason code.
    const audit = await (await request.get(`/api/applications/${id}/audit`)).json();
    const write = [...audit.entries]
      .reverse()
      .find((e: { action: string }) => e.action === "draft.write");
    expect(write.decision).toBe("PARTIAL");
    expect(write.deniedFields).toContain("isAdmin");
    expect(write.reasonCode).toBeTruthy();
  });

  test("the wizard surfaces a denied-field notice with the auditable reason", async ({
    page,
    request,
  }) => {
    const id = await createApplication(request);
    await page.goto(`/apply/${id}`);
    // Fill a legitimate contact field so there is at least one applied edit.
    await page.getByLabel("Full name", { exact: false }).fill("Boundary Tester");

    // Inject a crafted hidden field into the very next draft PATCH the wizard
    // sends, simulating a tampered client. The server must reject it.
    await page.route(`**/api/applications/${id}/draft`, async (route) => {
      const req = route.request();
      const payload = JSON.parse(req.postData() ?? "{}");
      payload.edits.push({
        key: "isAdmin",
        value: "true",
        baseVersion: payload.baseVersion,
        baseValue: null,
      });
      await route.continue({ postData: JSON.stringify(payload) });
    });

    await page.getByTestId("save-draft").click();

    // The denied summary appears with the crafted key and its reason code.
    const denied = page.getByTestId("denied-summary");
    await expect(denied).toBeVisible();
    await expect(page.getByTestId("denied-isAdmin")).toContainText("isAdmin");
    await expect(page.getByTestId("denied-isAdmin")).toContainText("UNKNOWN_FIELD");
  });
});

test.describe("two-browser focus recovery preserves the accommodation", () => {
  test("two staff-adjacent sessions recover focus; applicant accommodation survives", async ({
    browser,
    request,
  }) => {
    const id = await createApplication(request);
    await submitValidNoneWithAccommodation(request, id);
    await request.post(`/api/staff/applications/${id}/request-correction`, {
      data: { fields: ["economicProof"], reasonCode: "ECONOMIC_PROOF_REQUIRED" },
    });

    // Two independent browser contexts open the applicant wizard.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/apply/${id}`);
    await pageB.goto(`/apply/${id}`);

    // Session A moves focus onto the economic-proof field (documents step).
    await pageA.getByRole("button", { name: "Next →" }).click(); // eligibility
    await pageA.getByRole("button", { name: "Next →" }).click(); // documents
    const econA = pageA.getByLabel("Economic-hardship document reference", { exact: false });
    await econA.focus();
    await expect(econA).toBeFocused();

    // Simulate focus loss + restore (tab away and back).
    await pageB.bringToFront();
    await pageA.bringToFront();
    // Focus is still on the same field after the context switch.
    await expect(econA).toBeFocused();

    // Session A supplements the economic proof and resubmits.
    await econA.fill("ECON-9");
    await pageA.getByRole("button", { name: "Next →" }).click(); // accommodations
    await pageA.getByRole("button", { name: "Next →" }).click(); // review
    await pageA.getByTestId("submit").click();
    await expect(pageA.getByTestId("live-polite")).toContainText(/submitted/i);

    // The accommodation is untouched by the correction/resubmit round-trip.
    const final = await getApplication(request, id);
    expect(final.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
    expect(final.values.economicProof).toBe("ECON-9");

    await ctxA.close();
    await ctxB.close();
  });
});
