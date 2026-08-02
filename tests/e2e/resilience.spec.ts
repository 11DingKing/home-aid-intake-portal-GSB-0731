import { test, expect } from "@playwright/test";
import { createApplication, getApplication } from "./helpers";
import type { APIRequestContext } from "@playwright/test";

// Round-2 resilience evidence:
//  * a final submit that succeeded on the server but "timed out" in the browser,
//    then retried, must converge (not double-transition, not clear accommodations)
//  * illegal backward state transitions are rejected
//  * attachment metadata replacement preserves accommodations and swaps metadata

async function fillNoFixedIncomeWithAccommodation(
  request: APIRequestContext,
  id: string,
): Promise<number> {
  const app0 = await getApplication(request, id);
  const base = app0.version as number;
  const patch = await request.patch(`/api/applications/${id}/draft`, {
    data: {
      baseVersion: base,
      edits: [
        { key: "fullName", value: "Retry Rivera", baseVersion: base, baseValue: null },
        { key: "contactEmail", value: "retry@example.org", baseVersion: base, baseValue: null },
        { key: "exemptionReason", value: "NO_FIXED_INCOME", baseVersion: base, baseValue: null },
        { key: "identityProof", value: "ID-META-1", baseVersion: base, baseValue: null },
        {
          key: "accommodations",
          value: ["HOME_VISIT_NEEDED"],
          baseVersion: base,
          baseValue: [],
        },
      ],
    },
  });
  const body = await patch.json();
  return body.application.version as number;
}

test.describe("submit success + browser timeout retry", () => {
  test("retrying a submit with the same idempotency key converges and keeps accommodations", async ({
    request,
  }) => {
    const id = await createApplication(request);
    const v = await fillNoFixedIncomeWithAccommodation(request, id);
    const key = `timeout-retry-${id}`;

    // First submit succeeds server-side. Simulate the browser NOT seeing the
    // response (timeout) by simply ignoring it, then retrying with the same key.
    const first = await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": key },
      data: { baseVersion: v },
    });
    expect(first.ok()).toBeTruthy();
    const firstBody = await first.json();
    expect(firstBody.replayed).toBe(false);
    expect(firstBody.application.state).toBe("SUBMITTED");

    // The retry (same key) replays the original outcome — no second transition.
    const retry = await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": key },
      data: { baseVersion: v },
    });
    expect(retry.ok()).toBeTruthy();
    const retryBody = await retry.json();
    expect(retryBody.replayed).toBe(true);
    expect(retryBody.application.version).toBe(firstBody.application.version);

    // Exactly one SUBMITTED transition, and the accommodation survived.
    const final = await getApplication(request, id);
    expect(final.state).toBe("SUBMITTED");
    expect(final.version).toBe(firstBody.application.version);
    expect(final.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
  });

  test("a retry that arrives after a real timeout at a stale version still does not lose the accommodation", async ({
    request,
  }) => {
    const id = await createApplication(request);
    const v = await fillNoFixedIncomeWithAccommodation(request, id);
    const key = `timeout-retry-2-${id}`;
    await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": key },
      data: { baseVersion: v },
    });
    // Retry using the SAME key but a stale baseVersion (client never advanced).
    const retry = await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": key },
      data: { baseVersion: v - 1 },
    });
    // Idempotency replay takes precedence over the version check.
    expect(retry.ok()).toBeTruthy();
    const body = await retry.json();
    expect(body.replayed).toBe(true);
    const final = await getApplication(request, id);
    expect(final.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
  });
});

test.describe("illegal backward transitions are rejected", () => {
  test("accepted application cannot be corrected, declined, or resubmitted", async ({ request }) => {
    const id = await createApplication(request);
    const v = await fillNoFixedIncomeWithAccommodation(request, id);
    await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": `k-${id}` },
      data: { baseVersion: v },
    });
    // Staff accepts -> terminal.
    const accepted = await request.post(`/api/staff/applications/${id}/decision`, {
      data: { action: "accept" },
    });
    expect(accepted.ok()).toBeTruthy();

    // Backward: request a correction on a terminal application -> rejected.
    const correction = await request.post(`/api/staff/applications/${id}/request-correction`, {
      data: { fields: ["identityProof"], reasonCode: "IDENTITY_REQUIRED" },
    });
    expect(correction.status()).toBe(409);
    expect((await correction.json()).error.code).toBe("INVALID_TRANSITION");

    // Backward: decline after accept -> rejected.
    const decline = await request.post(`/api/staff/applications/${id}/decision`, {
      data: { action: "decline" },
    });
    expect(decline.status()).toBe(409);
    expect((await decline.json()).error.code).toBe("INVALID_TRANSITION");

    // State and accommodation are unchanged after the rejected attempts.
    const final = await getApplication(request, id);
    expect(final.state).toBe("ACCEPTED");
    expect(final.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
  });

  test("a submitted application cannot be edited back into a draft field patch", async ({
    request,
  }) => {
    const id = await createApplication(request);
    const v = await fillNoFixedIncomeWithAccommodation(request, id);
    await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": `k2-${id}` },
      data: { baseVersion: v },
    });
    const patch = await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: v + 1,
        edits: [{ key: "fullName", value: "Too Late", baseVersion: v + 1, baseValue: "Retry Rivera" }],
      },
    });
    expect(patch.status()).toBe(409);
    expect((await patch.json()).error.code).toBe("NOT_EDITABLE");
  });
});

test.describe("attachment metadata replacement", () => {
  test("replaces identity metadata while preserving the accommodation need", async ({ request }) => {
    const id = await createApplication(request);
    await fillNoFixedIncomeWithAccommodation(request, id);

    const before = await getApplication(request, id);
    const res = await request.post(`/api/applications/${id}/materials`, {
      data: {
        fieldKey: "identityProof",
        kind: "IDENTITY",
        filename: "passport-scan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 20480,
        materialId: "ID-META-NEW",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.application.values.identityProof).toBe("ID-META-NEW");
    expect(body.replacedMaterialId).toBe("ID-META-1");
    expect(body.material.filename).toBe("passport-scan.pdf");
    // Version advanced; accommodation untouched by the swap.
    expect(body.application.version).toBeGreaterThan(before.version as number);
    expect(body.application.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);

    // The staff intake view shows the new metadata (metadata only, no bytes).
    const staff = await request.get(`/api/staff/applications/${id}?view=INTAKE_REVIEW`);
    const staffBody = await staff.json();
    const ids = (staffBody.materialMetadata as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain("ID-META-NEW");
  });

  test("replacement is rejected once the application is no longer editable", async ({ request }) => {
    const id = await createApplication(request);
    const v = await fillNoFixedIncomeWithAccommodation(request, id);
    await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": `k3-${id}` },
      data: { baseVersion: v },
    });
    const res = await request.post(`/api/applications/${id}/materials`, {
      data: {
        fieldKey: "identityProof",
        kind: "IDENTITY",
        filename: "late.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_EDITABLE");
  });
});
