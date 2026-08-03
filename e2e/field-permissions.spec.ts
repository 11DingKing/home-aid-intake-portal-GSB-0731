import { test, expect, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:3000";

function mat(materialId: string, fileName: string) {
  return {
    materialId,
    fileName,
    mimeType: "application/pdf",
    sizeBytes: 102400,
    uploadedAt: new Date().toISOString(),
    status: "UPLOADED" as const,
  };
}

async function createAndSubmitApp(request: APIRequestContext, id: string) {
  await request.post(`${BASE}/api/applications`, { data: { id } });
  let app = await (await request.get(`${BASE}/api/applications/${id}`)).json();
  const v1 = app.data.version;

  await request.put(`${BASE}/api/applications/${id}`, {
    data: {
      fullName: "安全测试申请人",
      contactPhone: "13800138000",
      caseDescription: "这是一个用于测试字段权限边界的案件描述内容",
      legalIssueType: "HOUSING",
      exemptionReason: "NONE",
      idDocumentMeta: mat("ID-1", "id.pdf"),
      otherMaterialMeta: mat("OTHER-1", "other.pdf"),
      economicProofMeta: mat("ECON-1", "econ.pdf"),
      version: v1,
    },
  });

  app = await (await request.get(`${BASE}/api/applications/${id}`)).json();
  await request.post(`${BASE}/api/applications/${id}/submit`, {
    data: { idempotencyKey: `sec-${Date.now()}`, version: app.data.version },
  });
  return (await request.get(`${BASE}/api/applications/${id}`)).json();
}

test.describe("Field-level permission boundaries", () => {
  test("staff INTAKE_REVIEW API response does not contain sensitive fields", async ({ request }) => {
    const id = `SEC-INTAKE-${Date.now()}`;
    await createAndSubmitApp(request, id);

    const res = await request.get(`${BASE}/api/applications/${id}/fields?role=STAFF`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const app = body.data.application;

    expect(app.id).toBe(id);
    expect(app.state).toBe("SUBMITTED");
    expect(app.accommodations).toBeDefined();
    expect(app.idDocumentMeta).toBeDefined();

    expect(app.fullName).toBeUndefined();
    expect(app.contactPhone).toBeUndefined();
    expect(app.contactEmail).toBeUndefined();
    expect(app.caseDescription).toBeUndefined();
    expect(app.economicProofMeta).toBeUndefined();
    expect(app.idempotencyKey).toBeUndefined();
    expect(body.data.view).toBe("INTAKE_REVIEW");
  });

  test("staff CORRECTION_REVIEW API response includes correction fields", async ({ request }) => {
    const id = `SEC-CORR-${Date.now()}`;
    const app = await createAndSubmitApp(request, id);
    const submittedVersion = app.data.version;

    await request.post(`${BASE}/api/applications/${id}/corrections`, {
      data: {
        fields: ["economicProofMeta", "caseDescription"],
        reasonCode: "CLARIFICATION_NEEDED",
        version: submittedVersion,
      },
    });

    const res = await request.get(`${BASE}/api/applications/${id}/fields?role=STAFF`);
    const body = await res.json();
    const appData = body.data.application;

    expect(appData.state).toBe("NEEDS_CORRECTION");
    expect(body.data.view).toBe("CORRECTION_REVIEW");
    expect(appData.fullName).toBe("安全测试申请人");
    expect(appData.contactPhone).toBe("13800138000");
    expect(appData.caseDescription).toBeDefined();
    expect(appData.economicProofMeta).toBeDefined();
    expect(appData.idempotencyKey).toBeUndefined();
  });

  test("malicious client cannot inject state field via PUT", async ({ request }) => {
    const id = `SEC-INJECT-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });
    const app = await (await request.get(`${BASE}/api/applications/${id}`)).json();

    const res = await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "正常姓名",
        state: "ACCEPTED",
        version: app.data.version,
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.rejectedFields).toContain("state");
    expect(body.reasons.state).toContain("系统字段");

    const after = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(after.data.state).toBe("DRAFT");
    expect(after.data.fullName).not.toBe("正常姓名");
  });

  test("malicious client cannot inject idempotencyKey via PUT", async ({ request }) => {
    const id = `SEC-IDEM-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });
    const app = await (await request.get(`${BASE}/api/applications/${id}`)).json();

    const res = await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "测试",
        idempotencyKey: "forged-key",
        version: app.data.version,
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.rejectedFields).toContain("idempotencyKey");
  });

  test("malicious client cannot inject unknown fields like isAdmin", async ({ request }) => {
    const id = `SEC-ADMIN-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });
    const app = await (await request.get(`${BASE}/api/applications/${id}`)).json();

    const res = await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "测试",
        isAdmin: true,
        role: "STAFF",
        version: app.data.version,
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.rejectedFields).toContain("isAdmin");
    expect(body.rejectedFields).toContain("role");
  });

  test("cannot edit application in SUBMITTED state", async ({ request }) => {
    const id = `SEC-EDIT-${Date.now()}`;
    const app = await createAndSubmitApp(request, id);

    const res = await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "篡改姓名",
        version: app.data.version,
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("不允许编辑");
  });

  test("malicious staff correction with extra fields is rejected", async ({ request }) => {
    const id = `SEC-STAFF-INJ-${Date.now()}`;
    const app = await createAndSubmitApp(request, id);

    const res = await request.post(`${BASE}/api/applications/${id}/corrections`, {
      data: {
        fields: ["economicProofMeta"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        fullName: "Staff Hack",
        state: "ACCEPTED",
        version: app.data.version,
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.rejectedFields).toContain("fullName");
    expect(body.rejectedFields).toContain("state");

    const after = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(after.data.state).toBe("SUBMITTED");
    expect(after.data.fullName).not.toBe("Staff Hack");
  });

  test("malicious staff decision with extra fields is rejected", async ({ request }) => {
    const id = `SEC-STAFF-DEC-${Date.now()}`;
    const app = await createAndSubmitApp(request, id);

    const res = await request.post(`${BASE}/api/applications/${id}/decision`, {
      data: {
        action: "ACCEPTED",
        fullName: "Override",
        version: 999,
      },
    });

    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.rejectedFields).toContain("fullName");
  });
});

test.describe("Stale link during state transition", () => {
  test("staff opening old link during NEEDS_CORRECTION -> RESUBMITTED gets stale warning", async ({ request }) => {
    const id = `STALE-${Date.now()}`;
    const app = await createAndSubmitApp(request, id);

    await request.post(`${BASE}/api/applications/${id}/corrections`, {
      data: {
        fields: ["economicProofMeta"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        version: app.data.version,
      },
    });

    let current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.state).toBe("NEEDS_CORRECTION");

    await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        economicProofMeta: mat("ECON-NEW", "new-econ.pdf"),
        version: current.data.version,
      },
    });

    await request.post(`${BASE}/api/applications/${id}/submit`, {
      data: { idempotencyKey: `resubmit-${Date.now()}` },
    });

    current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.state).toBe("RESUBMITTED");

    const res = await request.get(
      `${BASE}/api/applications/${id}/fields?role=STAFF&expectedState=NEEDS_CORRECTION`
    );
    const body = await res.json();
    expect(body.data.staleLink).not.toBeNull();
    expect(body.data.staleLink.message).toContain("已从");
    expect(body.data.staleLink.message).toContain("变更为");
    expect(body.data.application.state).toBe("RESUBMITTED");
  });

  test("stale correction request when applicant already resubmitted returns 409", async ({ request }) => {
    const id = `STALE-CORR-${Date.now()}`;
    const app = await createAndSubmitApp(request, id);

    const corrRes = await request.post(`${BASE}/api/applications/${id}/corrections`, {
      data: {
        fields: ["caseDescription"],
        reasonCode: "CLARIFICATION_NEEDED",
        version: app.data.version,
      },
    });
    expect(corrRes.ok()).toBeTruthy();

    let current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    const needsCorrectionVersion = current.data.version;

    await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        caseDescription: "补正后的案件描述内容更加详细完整",
        version: current.data.version,
      },
    });
    await request.post(`${BASE}/api/applications/${id}/submit`, {
      data: { idempotencyKey: `resubmit-${Date.now()}` },
    });

    current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.state).toBe("RESUBMITTED");

    const staleCorr = await request.post(`${BASE}/api/applications/${id}/corrections`, {
      data: {
        fields: ["economicProofMeta"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        version: needsCorrectionVersion,
      },
    });
    expect(staleCorr.status()).toBe(409);
    const body = await staleCorr.json();
    expect(body.code).toBe("VERSION_CONFLICT");
    expect(body.conflicts.length).toBeGreaterThan(0);
  });
});

test.describe("Audit trail for rejected attempts", () => {
  test("rejected field injection is recorded in audit log with reason", async ({ request }) => {
    const id = `AUDIT-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });
    const app = await (await request.get(`${BASE}/api/applications/${id}`)).json();

    await request.put(`${BASE}/api/applications/${id}`, {
      data: { fullName: "test", state: "ACCEPTED", version: app.data.version },
    });

    const auditRes = await request.get(`${BASE}/api/applications/${id}/audit`);
    const auditBody = await auditRes.json();
    expect(auditBody.success).toBe(true);
    expect(auditBody.data.rejectionCount).toBeGreaterThan(0);

    const rejection = auditBody.data.auditTrail.find(
      (l: { action: string }) => l.action === "UNAUTHORIZED_FIELD_REJECTED"
    );
    expect(rejection).toBeTruthy();
    expect(rejection.details.rejectedFields).toContain("state");
    expect(rejection.details.reasons.state).toBeTruthy();
    expect(rejection.actor).toBe("APPLICANT");
  });

  test("invalid state transition is recorded in audit log", async ({ request }) => {
    const id = `AUDIT-TRANS-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });

    await request.post(`${BASE}/api/applications/${id}/decision`, {
      data: { action: "ACCEPTED" },
    });

    const auditRes = await request.get(`${BASE}/api/applications/${id}/audit`);
    const auditBody = await auditRes.json();
    const transRejection = auditBody.data.auditTrail.find(
      (l: { action: string }) => l.action === "INVALID_TRANSITION_REJECTED"
    );
    expect(transRejection).toBeTruthy();
    expect(transRejection.fromState).toBe("DRAFT");
    expect(transRejection.toState).toBe("ACCEPTED");
  });
});

test.describe("Accommodations not overwritten by field enforcement", () => {
  test("PUT with empty accommodations array preserves existing values", async ({ request }) => {
    const id = `ACC-PROTECT-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });
    let app = await (await request.get(`${BASE}/api/applications/${id}`)).json();

    await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "便利保护测试",
        accommodations: ["HOME_VISIT_NEEDED", "SIGN_INTERPRETER"],
        version: app.data.version,
      },
    });

    app = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(app.data.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.data.accommodations).toContain("SIGN_INTERPRETER");
    const v2 = app.data.version;

    await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "尝试清空",
        accommodations: [],
        version: v2,
      },
    });

    app = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(app.data.accommodations).toContain("HOME_VISIT_NEEDED");
    expect(app.data.accommodations).toContain("SIGN_INTERPRETER");
  });

  test("correction flow preserves accommodations through NEEDS_CORRECTION and RESUBMITTED", async ({ request }) => {
    const id = `ACC-CORR-${Date.now()}`;
    await request.post(`${BASE}/api/applications`, { data: { id } });
    let current = await (await request.get(`${BASE}/api/applications/${id}`)).json();

    await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        fullName: "便利补正测试",
        contactPhone: "13800138000",
        caseDescription: "这是用于测试补正流程中合理便利保留的案件描述内容",
        legalIssueType: "HOUSING",
        exemptionReason: "NONE",
        accommodations: ["BRAILLE_MATERIAL", "TEXT_ONLY"],
        idDocumentMeta: mat("ID-1", "id.pdf"),
        otherMaterialMeta: mat("OTHER-1", "other.pdf"),
        economicProofMeta: mat("ECON-1", "econ.pdf"),
        version: current.data.version,
      },
    });

    current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.accommodations).toContain("BRAILLE_MATERIAL");

    await request.post(`${BASE}/api/applications/${id}/submit`, {
      data: { idempotencyKey: `acc-submit-${Date.now()}` },
    });

    current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.state).toBe("SUBMITTED");
    expect(current.data.accommodations).toContain("BRAILLE_MATERIAL");

    await request.post(`${BASE}/api/applications/${id}/corrections`, {
      data: {
        fields: ["economicProofMeta"],
        reasonCode: "ECONOMIC_PROOF_REQUIRED",
        version: current.data.version,
      },
    });

    current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.state).toBe("NEEDS_CORRECTION");
    expect(current.data.accommodations).toContain("BRAILLE_MATERIAL");
    expect(current.data.accommodations).toContain("TEXT_ONLY");

    await request.put(`${BASE}/api/applications/${id}`, {
      data: {
        economicProofMeta: mat("ECON-V2", "econ-v2.pdf"),
        version: current.data.version,
      },
    });
    await request.post(`${BASE}/api/applications/${id}/submit`, {
      data: { idempotencyKey: `acc-resubmit-${Date.now()}` },
    });

    current = await (await request.get(`${BASE}/api/applications/${id}`)).json();
    expect(current.data.state).toBe("RESUBMITTED");
    expect(current.data.accommodations).toContain("BRAILLE_MATERIAL");
    expect(current.data.accommodations).toContain("TEXT_ONLY");
  });
});
