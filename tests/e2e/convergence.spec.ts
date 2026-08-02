import { test, expect } from "@playwright/test";
import { createApplication, getApplication } from "./helpers";

// Two-session convergence evidence. These drive the API the way two concurrent
// browser sessions would, then assert the client-visible state converges by
// application id + optimistic version.

test.describe("two-session convergence", () => {
  test("field-level merge: different fields from the same base both converge", async ({ request }) => {
    const id = await createApplication(request);
    const app0 = await getApplication(request, id);
    const base = app0.version as number;

    // Session A edits fullName from base.
    const resA = await request.patch(`/api/applications/${id}/draft`, {
      data: { baseVersion: base, edits: [{ key: "fullName", value: "Session A", baseVersion: base }] },
    });
    expect(resA.ok()).toBeTruthy();
    const bodyA = await resA.json();
    expect(bodyA.applied.map((x: { key: string }) => x.key)).toContain("fullName");

    // Session B (still at base) edits contactPhone — a different field.
    const resB = await request.patch(`/api/applications/${id}/draft`, {
      data: { baseVersion: base, edits: [{ key: "contactPhone", value: "555-0100", baseVersion: base }] },
    });
    expect(resB.ok()).toBeTruthy();
    const bodyB = await resB.json();
    expect(bodyB.conflicts).toHaveLength(0);
    expect(bodyB.applied.map((x: { key: string }) => x.key)).toContain("contactPhone");

    // Converged: both edits present, monotonic version.
    const final = await getApplication(request, id);
    expect(final.values.fullName).toBe("Session A");
    expect(final.values.contactPhone).toBe("555-0100");
    expect(final.version).toBeGreaterThan(base);
  });

  test("field-level conflict: same field diverged surfaces a conflict, server wins", async ({
    request,
  }) => {
    const id = await createApplication(request);
    const app0 = await getApplication(request, id);
    const base = app0.version as number;

    // Session A writes fullName first.
    await request.patch(`/api/applications/${id}/draft`, {
      data: { baseVersion: base, edits: [{ key: "fullName", value: "Server Wins", baseVersion: base }] },
    });
    // Session B, still at the old base, writes a different fullName.
    const resB = await request.patch(`/api/applications/${id}/draft`, {
      data: { baseVersion: base, edits: [{ key: "fullName", value: "Client Loses", baseVersion: base }] },
    });
    const bodyB = await resB.json();
    expect(bodyB.conflicts.map((c: { key: string }) => c.key)).toContain("fullName");
    const conflict = bodyB.conflicts.find((c: { key: string }) => c.key === "fullName");
    expect(conflict.conflictReason).toBe("STALE_EDIT");
    expect(conflict.serverValue).toBe("Server Wins");

    const final = await getApplication(request, id);
    expect(final.values.fullName).toBe("Server Wins");
  });

  test("a stale draft cannot clear a reasonable-accommodation request", async ({ request }) => {
    const id = await createApplication(request);
    const app0 = await getApplication(request, id);
    const base = app0.version as number;

    // Session A records an accommodation need.
    await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: base,
        edits: [{ key: "accommodations", value: ["HOME_VISIT_NEEDED"], baseVersion: base }],
      },
    });

    // Session B (older draft) tries to clear accommodations.
    const resB = await request.patch(`/api/applications/${id}/draft`, {
      data: { baseVersion: base, edits: [{ key: "accommodations", value: [], baseVersion: base }] },
    });
    const bodyB = await resB.json();
    const conflict = bodyB.conflicts.find((c: { key: string }) => c.key === "accommodations");
    expect(conflict.conflictReason).toBe("PROTECTED_ACCOMMODATION");

    const final = await getApplication(request, id);
    expect(final.values.accommodations).toEqual(["HOME_VISIT_NEEDED"]);
  });

  test("duplicate final submit with the same idempotency key does not double-transition", async ({
    request,
  }) => {
    const id = await createApplication(request);
    const app0 = await getApplication(request, id);
    const base = app0.version as number;
    // Fill valid NO_FIXED_INCOME.
    const patch = await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: base,
        edits: [
          { key: "fullName", value: "Dup Tester", baseVersion: base },
          { key: "contactEmail", value: "dup@example.org", baseVersion: base },
          { key: "exemptionReason", value: "NO_FIXED_INCOME", baseVersion: base },
          { key: "identityProof", value: "ID-META-1", baseVersion: base },
        ],
      },
    });
    const patched = await patch.json();
    const v = patched.application.version as number;

    const key = "dup-key-123";
    const first = await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": key },
      data: { baseVersion: v },
    });
    const second = await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": key },
      data: { baseVersion: v },
    });
    const b1 = await first.json();
    const b2 = await second.json();
    expect(b1.replayed).toBe(false);
    expect(b2.replayed).toBe(true);
    expect(b2.application.version).toBe(b1.application.version);
    expect(b2.application.state).toBe("SUBMITTED");
  });

  test("a second submit at a stale version is rejected with VERSION_CONFLICT", async ({ request }) => {
    const id = await createApplication(request);
    const app0 = await getApplication(request, id);
    const base = app0.version as number;
    await request.patch(`/api/applications/${id}/draft`, {
      data: {
        baseVersion: base,
        edits: [
          { key: "fullName", value: "Stale Submitter", baseVersion: base },
          { key: "contactEmail", value: "s@example.org", baseVersion: base },
          { key: "exemptionReason", value: "NO_FIXED_INCOME", baseVersion: base },
          { key: "identityProof", value: "ID-META-1", baseVersion: base },
        ],
      },
    });
    const staleVersion = base; // deliberately behind
    const res = await request.post(`/api/applications/${id}/submit`, {
      headers: { "Idempotency-Key": "stale-submit-key" },
      data: { baseVersion: staleVersion },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });
});
