import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:3000";

function matMeta(materialId: string, fileName: string) {
  return {
    materialId,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: 102400,
    uploadedAt: new Date().toISOString(),
    status: "UPLOADED" as const,
  };
}

async function createApp(request: APIRequestContext, id: string) {
  const res = await request.post(`${BASE}/api/applications`, { data: { id } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function getApp(request: APIRequestContext, id: string) {
  const res = await request.get(`${BASE}/api/applications/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

async function saveDraft(
  request: APIRequestContext,
  id: string,
  data: Record<string, unknown>,
  version: number
) {
  return request.put(`${BASE}/api/applications/${id}`, {
    data: { ...data, version },
  });
}

async function submitApp(
  request: APIRequestContext,
  id: string,
  idempotencyKey: string,
  version?: number
) {
  return request.post(`${BASE}/api/applications/${id}/submit`, {
    data: { idempotencyKey, ...(version !== undefined ? { version } : {}) },
  });
}

async function requestCorrection(
  request: APIRequestContext,
  id: string,
  fields: string[],
  reasonCode: string,
  version?: number
) {
  return request.post(`${BASE}/api/applications/${id}/corrections`, {
    data: { fields, reasonCode, ...(version !== undefined ? { version } : {}) },
  });
}

async function fillCompleteDraft(request: APIRequestContext, id: string, version: number) {
  const res = await saveDraft(request, id, {
    fullName: "测试申请人",
    contactPhone: "13800138000",
    caseDescription: "这是一个用于测试完整提交的案件描述内容",
    legalIssueType: "HOUSING",
    exemptionReason: "NONE",
    idDocumentMeta: matMeta("ID-1", "id.pdf"),
    otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
    economicProofMeta: matMeta("ECON-1", "econ.pdf"),
  }, version);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

test.describe("E2E: Submit succeeded but browser timeout retry", () => {
  test("same idempotency key returns same result without duplicate submit", async ({ request }) => {
    const id = `E2E-RETRY-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    await fillCompleteDraft(request, id, app.version);
    app = await getApp(request, id);

    const idempotencyKey = `retry-key-${Date.now()}`;

    const res1 = await submitApp(request, id, idempotencyKey);
    expect(res1.ok()).toBeTruthy();
    const body1 = await res1.json();
    expect(body1.success).toBe(true);
    expect(body1.data.state).toBe("SUBMITTED");
    const versionAfterFirst = body1.data.version;

    const res2 = await submitApp(request, id, idempotencyKey);
    expect(res2.ok()).toBeTruthy();
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
    expect(body2.data.state).toBe("SUBMITTED");
    expect(body2.data.version).toBe(versionAfterFirst);

    app = await getApp(request, id);
    expect(app.state).toBe("SUBMITTED");
    expect(app.version).toBe(versionAfterFirst);
  });

  test("retry with different key after successful submit returns same state (no duplicate)", async ({ request }) => {
    const id = `E2E-RETRY2-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    await fillCompleteDraft(request, id, app.version);
    app = await getApp(request, id);

    const res1 = await submitApp(request, id, `key-a-${Date.now()}`);
    expect(res1.ok()).toBeTruthy();
    const body1 = await res1.json();
    expect(body1.data.state).toBe("SUBMITTED");
    const v1 = body1.data.version;

    await new Promise((r) => setTimeout(r, 100));
    const res2 = await submitApp(request, id, `key-b-${Date.now()}`);
    expect(res2.ok()).toBeTruthy();
    const body2 = await res2.json();
    expect(body2.data.state).toBe("SUBMITTED");
    expect(body2.data.version).toBe(v1);
  });

  test("idempotency key persists across correction and resubmit cycle", async ({ request }) => {
    const id = `E2E-RETRY3-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    await fillCompleteDraft(request, id, app.version);
    app = await getApp(request, id);

    const submitKey = `submit-${Date.now()}`;
    await submitApp(request, id, submitKey);
    app = await getApp(request, id);
    expect(app.state).toBe("SUBMITTED");

    const corrRes = await requestCorrection(request, id, ["economicProofMeta"], "ECONOMIC_PROOF_REQUIRED", app.version);
    expect(corrRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.state).toBe("NEEDS_CORRECTION");

    const newEcon = matMeta("ECON-2", "new-econ.pdf");
    await saveDraft(request, id, { economicProofMeta: newEcon }, app.version);
    app = await getApp(request, id);

    const resubmitKey = `resubmit-${Date.now()}`;
    const resubRes = await submitApp(request, id, resubmitKey);
    expect(resubRes.ok()).toBeTruthy();
    const resubBody = await resubRes.json();
    expect(resubBody.data.state).toBe("RESUBMITTED");

    const retryRes = await submitApp(request, id, resubmitKey);
    expect(retryRes.ok()).toBeTruthy();
    const retryBody = await retryRes.json();
    expect(retryBody.data.state).toBe("RESUBMITTED");
    expect(retryBody.data.version).toBe(resubBody.data.version);
  });
});

test.describe("E2E: Illegal state transition rollback", () => {
  test("DRAFT cannot directly transition to ACCEPTED", async ({ request }) => {
    const id = `E2E-ILLEGAL-${Date.now()}`;
    await createApp(request, id);
    const app = await getApp(request, id);

    const res = await request.post(`${BASE}/api/applications/${id}/decision`, {
      data: { action: "ACCEPTED" },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);

    const after = await getApp(request, id);
    expect(after.state).toBe("DRAFT");
    expect(after.version).toBe(app.version);
  });

  test("DRAFT cannot transition to NEEDS_CORRECTION directly", async ({ request }) => {
    const id = `E2E-ILLEGAL2-${Date.now()}`;
    await createApp(request, id);
    const app = await getApp(request, id);

    const res = await requestCorrection(request, id, ["fullName"], "INCOMPLETE_INFORMATION", app.version);
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);

    const after = await getApp(request, id);
    expect(after.state).toBe("DRAFT");
  });

  test("ACCEPTED is terminal - cannot submit, correct, or decide", async ({ request }) => {
    const id = `E2E-TERMINAL-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    await fillCompleteDraft(request, id, app.version);
    app = await getApp(request, id);
    await submitApp(request, id, `term-${Date.now()}`);
    app = await getApp(request, id);

    const acceptRes = await request.post(`${BASE}/api/applications/${id}/decision`, {
      data: { action: "ACCEPTED" },
    });
    expect(acceptRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.state).toBe("ACCEPTED");

    const submitRes = await submitApp(request, id, `should-fail-${Date.now()}`, app.version);
    expect(submitRes.status()).toBe(403);

    const corrRes = await requestCorrection(request, id, ["fullName"], "INCOMPLETE_INFORMATION", app.version);
    expect(corrRes.status()).toBe(403);

    const declineRes = await request.post(`${BASE}/api/applications/${id}/decision`, {
      data: { action: "DECLINED" },
    });
    expect(declineRes.status()).toBe(403);

    const after = await getApp(request, id);
    expect(after.state).toBe("ACCEPTED");
  });

  test("invalid transition does not increment version or corrupt data", async ({ request }) => {
    const id = `E2E-ROLLBACK-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    const v0 = app.version;

    await saveDraft(request, id, { fullName: "Before Attempt" }, v0);
    app = await getApp(request, id);
    const v1 = app.version;
    expect(v1).toBe(v0 + 1);

    const badRes = await request.post(`${BASE}/api/applications/${id}/decision`, {
      data: { action: "DECLINED" },
    });
    expect(badRes.status()).toBe(403);

    app = await getApp(request, id);
    expect(app.version).toBe(v1);
    expect(app.fullName).toBe("Before Attempt");
    expect(app.state).toBe("DRAFT");
  });
});

test.describe("E2E: Attachment metadata replacement", () => {
  test("replacing id document metadata updates materialId and fileName", async ({ request }) => {
    const id = `E2E-ATTACH-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);

    await saveDraft(request, id, { idDocumentMeta: matMeta("ID-V1", "old-id.pdf") }, app.version);
    app = await getApp(request, id);
    expect(app.idDocumentMeta.materialId).toBe("ID-V1");
    expect(app.idDocumentMeta.fileName).toBe("old-id.pdf");

    await saveDraft(request, id, { idDocumentMeta: matMeta("ID-V2", "new-id.pdf") }, app.version);
    app = await getApp(request, id);
    expect(app.idDocumentMeta.materialId).toBe("ID-V2");
    expect(app.idDocumentMeta.fileName).toBe("new-id.pdf");
  });

  test("replacing economic proof after correction updates the metadata", async ({ request }) => {
    const id = `E2E-ATTACH2-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);

    await saveDraft(request, id, {
      fullName: "附件测试",
      contactPhone: "13800138000",
      caseDescription: "这是用于测试附件替换的案件描述内容",
      legalIssueType: "EMPLOYMENT",
      exemptionReason: "NONE",
      idDocumentMeta: matMeta("ID-1", "id.pdf"),
      otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
      economicProofMeta: matMeta("ECON-OLD", "old-econ.pdf"),
    }, app.version);
    app = await getApp(request, id);

    await submitApp(request, id, `attach-submit-${Date.now()}`);
    app = await getApp(request, id);
    expect(app.state).toBe("SUBMITTED");

    await requestCorrection(request, id, ["economicProofMeta"], "ECONOMIC_PROOF_REQUIRED", app.version);
    app = await getApp(request, id);
    expect(app.state).toBe("NEEDS_CORRECTION");

    const newEcon = matMeta("ECON-NEW", "new-econ-proof.pdf");
    const saveRes = await saveDraft(request, id, { economicProofMeta: newEcon }, app.version);
    expect(saveRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.economicProofMeta.materialId).toBe("ECON-NEW");
    expect(app.economicProofMeta.fileName).toBe("new-econ-proof.pdf");

    const resubRes = await submitApp(request, id, `attach-resubmit-${Date.now()}`);
    expect(resubRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.state).toBe("RESUBMITTED");
    expect(app.economicProofMeta.materialId).toBe("ECON-NEW");
  });

  test("NO_FIXED_INCOME exemption allows null economic proof and replacement of other docs", async ({ request }) => {
    const id = `E2E-ATTACH3-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);

    await saveDraft(request, id, {
      fullName: "豁免测试",
      contactPhone: "13800138000",
      caseDescription: "这是测试无固定收入豁免的案件描述内容",
      legalIssueType: "HOUSING",
      exemptionReason: "NO_FIXED_INCOME",
      idDocumentMeta: matMeta("ID-1", "id.pdf"),
      otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
    }, app.version);
    app = await getApp(request, id);
    expect(app.economicProofMeta).toBeNull();

    await saveDraft(request, id, { idDocumentMeta: matMeta("ID-2", "replaced-id.pdf") }, app.version);
    app = await getApp(request, id);
    expect(app.idDocumentMeta.materialId).toBe("ID-2");
    expect(app.economicProofMeta).toBeNull();

    const submitRes = await submitApp(request, id, `exempt-submit-${Date.now()}`);
    expect(submitRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.state).toBe("SUBMITTED");
    expect(app.economicProofMeta).toBeNull();
  });
});

test.describe("E2E: Concurrent applicant/staff three-way merge", () => {
  test("applicant adds material while staff requests correction on same base version", async ({ request }) => {
    const id = `E2E-CONC-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    const baseVersion = app.version;

    await saveDraft(request, id, {
      fullName: "并发测试",
      contactPhone: "13800138000",
      caseDescription: "这是用于测试并发三方合并的案件描述内容",
      legalIssueType: "HOUSING",
      exemptionReason: "NONE",
      idDocumentMeta: matMeta("ID-1", "id.pdf"),
      otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
      economicProofMeta: matMeta("ECON-1", "econ.pdf"),
    }, baseVersion);
    app = await getApp(request, id);
    const submittedVersion = app.version;

    await submitApp(request, id, `conc-submit-${Date.now()}`);
    app = await getApp(request, id);
    expect(app.state).toBe("SUBMITTED");
    const submittedV = app.version;

    const corrRes = await requestCorrection(
      request,
      id,
      ["caseDescription", "economicProofMeta"],
      "CLARIFICATION_NEEDED",
      submittedV
    );
    expect(corrRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.state).toBe("NEEDS_CORRECTION");
    const correctedV = app.version;
    expect(correctedV).toBe(submittedV + 1);

    const newEcon = matMeta("ECON-UPDATED", "updated-econ.pdf");
    const applicantSaveRes = await saveDraft(
      request,
      id,
      {
        caseDescription: "这是申请人补正后的案件描述，内容更加详细",
        economicProofMeta: newEcon,
      },
      correctedV
    );
    expect(applicantSaveRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.caseDescription).toContain("补正后");
    expect(app.economicProofMeta.materialId).toBe("ECON-UPDATED");
    expect(app.accommodations).toEqual([]);
  });

  test("stale applicant save with conflict returns 409 and conflict fields", async ({ request }) => {
    const id = `E2E-CONFLICT-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    const v1 = app.version;

    await saveDraft(request, id, { fullName: "Original", contactPhone: "13800138000" }, v1);
    app = await getApp(request, id);
    const v2 = app.version;

    await saveDraft(request, id, { fullName: "Server Changed" }, v2);
    app = await getApp(request, id);
    const v3 = app.version;

    const staleRes = await saveDraft(request, id, { fullName: "Client Changed" }, v2);
    expect(staleRes.status()).toBe(409);
    const conflictBody = await staleRes.json();
    expect(conflictBody.code).toBe("VERSION_CONFLICT");
    expect(conflictBody.conflicts).toContain("fullName");
    expect(conflictBody.serverVersion).toBe(v3);
    expect(conflictBody.serverData).toBeTruthy();
  });

  test("stale staff correction returns 409 with changed fields when applicant modified data", async ({ request }) => {
    const id = `E2E-STAFF-CONF-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);

    await saveDraft(request, id, {
      fullName: "员工冲突测试",
      contactPhone: "13800138000",
      caseDescription: "这是用于测试员工端冲突的案件描述内容",
      legalIssueType: "EMPLOYMENT",
      exemptionReason: "NONE",
      idDocumentMeta: matMeta("ID-1", "id.pdf"),
      otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
      economicProofMeta: matMeta("ECON-1", "econ.pdf"),
    }, app.version);
    app = await getApp(request, id);

    await submitApp(request, id, `staff-conf-${Date.now()}`);
    app = await getApp(request, id);
    expect(app.state).toBe("SUBMITTED");
    const submittedV = app.version;

    const staleCorrRes = await requestCorrection(
      request,
      id,
      ["economicProofMeta"],
      "ECONOMIC_PROOF_REQUIRED",
      submittedV
    );
    expect(staleCorrRes.ok()).toBeTruthy();

    const corrList = await request.get(`${BASE}/api/applications/${id}/corrections`);
    const corrJson = await corrList.json();
    expect(corrJson.data.length).toBeGreaterThan(0);
  });

  test("accommodations are never cleared during concurrent edits or corrections", async ({ request }) => {
    const id = `E2E-ACCOM-PROTECT-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);
    const v1 = app.version;

    await saveDraft(request, id, {
      fullName: "合理便利保护测试",
      contactPhone: "13800138000",
      caseDescription: "这是测试合理便利不被清空的案件描述内容",
      legalIssueType: "HOUSING",
      exemptionReason: "NONE",
      accommodations: ["HOME_VISIT_NEEDED", "SIGN_INTERPRETER"],
      idDocumentMeta: matMeta("ID-1", "id.pdf"),
      otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
      economicProofMeta: matMeta("ECON-1", "econ.pdf"),
    }, v1);
    app = await getApp(request, id);
    expect(app.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.accommodations).toContain("SIGN_INTERPRETER");

    await submitApp(request, id, `accom-submit-${Date.now()}`);
    app = await getApp(request, id);
    expect(app.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.accommodations).toContain("SIGN_INTERPRETER");

    await requestCorrection(request, id, ["economicProofMeta"], "ECONOMIC_PROOF_REQUIRED", app.version);
    app = await getApp(request, id);
    expect(app.state).toBe("NEEDS_CORRECTION");
    expect(app.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.accommodations).toContain("SIGN_INTERPRETER");

    await saveDraft(request, id, {
      economicProofMeta: matMeta("ECON-2", "econ-v2.pdf"),
      accommodations: [],
    }, app.version);
    app = await getApp(request, id);
    expect(app.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.accommodations).toContain("SIGN_INTERPRETER");
    expect(app.economicProofMeta.materialId).toBe("ECON-2");

    const resubRes = await submitApp(request, id, `accom-resubmit-${Date.now()}`);
    expect(resubRes.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.state).toBe("RESUBMITTED");
    expect(app.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.accommodations).toContain("SIGN_INTERPRETER");
  });

  test("different field edits by applicant and staff auto-merge without conflict", async ({ request }) => {
    const id = `E2E-AUTOMERGE-${Date.now()}`;
    await createApp(request, id);
    let app = await getApp(request, id);

    await saveDraft(request, id, {
      fullName: "自动合并测试",
      contactPhone: "13800138000",
      caseDescription: "原始案件描述内容用于测试自动合并",
      legalIssueType: "FAMILY_LAW",
      exemptionReason: "NONE",
      idDocumentMeta: matMeta("ID-1", "id.pdf"),
      otherMaterialMeta: matMeta("OTHER-1", "other.pdf"),
      economicProofMeta: matMeta("ECON-1", "econ.pdf"),
    }, app.version);
    app = await getApp(request, id);

    await submitApp(request, id, `auto-${Date.now()}`);
    app = await getApp(request, id);
    const submittedV = app.version;

    await requestCorrection(request, id, ["economicProofMeta"], "ECONOMIC_PROOF_REQUIRED", submittedV);
    app = await getApp(request, id);
    const correctedV = app.version;

    const res = await saveDraft(request, id, {
      contactPhone: "13900139000",
      economicProofMeta: matMeta("ECON-NEW", "new.pdf"),
    }, correctedV);
    expect(res.ok()).toBeTruthy();
    app = await getApp(request, id);
    expect(app.contactPhone).toBe("13900139000");
    expect(app.economicProofMeta.materialId).toBe("ECON-NEW");
    expect(app.state).toBe("NEEDS_CORRECTION");
  });
});
