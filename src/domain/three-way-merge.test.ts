import { describe, it, expect } from "vitest";
import {
  threeWayMerge,
  diffChangedFields,
  resolveFieldLevelConflict,
  isStaleDraft,
  sanitizeClientDraft,
  CLIENT_EDITABLE_FIELDS,
} from "@/domain/conflict";

describe("three-way merge", () => {
  it("no changes on either side returns server data", () => {
    const base = { name: "A", phone: "1" };
    const client = { name: "A", phone: "1" };
    const server = { name: "A", phone: "1" };
    const result = threeWayMerge(base, client, server);
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged).toEqual(server);
  });

  it("only client changed - takes client value", () => {
    const base = { name: "A", phone: "1" };
    const client = { name: "B", phone: "1" };
    const server = { name: "A", phone: "1" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("B");
    expect(result.applicantWins).toContain("name");
    expect(result.conflicts).toHaveLength(0);
  });

  it("only server changed - takes server value", () => {
    const base = { name: "A", phone: "1" };
    const client = { name: "A", phone: "1" };
    const server = { name: "A", phone: "2" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.phone).toBe("2");
    expect(result.serverWins).toContain("phone");
    expect(result.conflicts).toHaveLength(0);
  });

  it("both changed same field to same value - no conflict", () => {
    const base = { name: "A" };
    const client = { name: "C" };
    const server = { name: "C" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("C");
    expect(result.conflicts).toHaveLength(0);
  });

  it("both changed same field to different values - true conflict, client wins", () => {
    const base = { name: "A" };
    const client = { name: "B" };
    const server = { name: "C" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("B");
    expect(result.conflicts).toContain("name");
    expect(result.applicantWins).toContain("name");
  });

  it("both changed different fields - clean auto-merge, no conflict", () => {
    const base = { name: "A", phone: "1" };
    const client = { name: "B", phone: "1" };
    const server = { name: "A", phone: "2" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("B");
    expect(result.merged.phone).toBe("2");
    expect(result.applicantWins).toContain("name");
    expect(result.serverWins).toContain("phone");
    expect(result.conflicts).toHaveLength(0);
  });

  it("protected field (accommodations) - both add different values, auto-merges union", () => {
    const base = { name: "A", accommodations: ["X"] };
    const client = { name: "A", accommodations: ["X", "Y"] };
    const server = { name: "A", accommodations: ["X", "Z"] };
    const result = threeWayMerge(base, client, server, ["accommodations"]);
    const accoms = result.merged.accommodations as string[];
    expect(accoms).toContain("X");
    expect(accoms).toContain("Y");
    expect(accoms).toContain("Z");
    expect(result.autoMerged).toContain("accommodations");
    expect(result.conflicts).not.toContain("accommodations");
  });

  it("protected field never lost even if client sends empty array", () => {
    const base = { accommodations: ["HOME_VISIT"] };
    const client = { accommodations: [] };
    const server = { accommodations: ["HOME_VISIT", "SIGN_INTERPRETER"] };
    const result = threeWayMerge(base, client, server, ["accommodations"]);
    const accoms = result.merged.accommodations as string[];
    expect(accoms).toContain("HOME_VISIT");
    expect(accoms).toContain("SIGN_INTERPRETER");
  });

  it("client cleared field while server also changed it - server wins on empty client value", () => {
    const base = { name: "A", phone: "1" };
    const client = { name: "", phone: "1" };
    const server = { name: "B", phone: "1" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("B");
    expect(result.serverWins).toContain("name");
    expect(result.conflicts).toContain("name");
  });

  it("client cleared field while server kept base value - client wins (intentional clear)", () => {
    const base = { name: "A", phone: "1" };
    const client = { name: "", phone: "1" };
    const server = { name: "A", phone: "1" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("");
    expect(result.applicantWins).toContain("name");
  });

  it("client fills field that server left empty - client wins", () => {
    const base = { name: "", phone: "" };
    const client = { name: "B", phone: "" };
    const server = { name: "", phone: "" };
    const result = threeWayMerge(base, client, server);
    expect(result.merged.name).toBe("B");
    expect(result.applicantWins).toContain("name");
  });

  it("material metadata replacement - new file replaces old, conflict reported", () => {
    const base = {
      idDocumentMeta: { materialId: "OLD", fileName: "old.pdf" },
    };
    const client = {
      idDocumentMeta: { materialId: "NEW", fileName: "new.pdf" },
    };
    const server = {
      idDocumentMeta: { materialId: "STAFF", fileName: "staff.pdf" },
    };
    const result = threeWayMerge(base, client, server);
    expect(result.conflicts).toContain("idDocumentMeta");
    expect((result.merged.idDocumentMeta as { materialId: string }).materialId).toBe("NEW");
  });

  it("applicant adds material while staff changes different field - auto-merge", () => {
    const base = {
      economicProofMeta: null,
      caseDescription: "original",
    };
    const client = {
      economicProofMeta: { materialId: "M1", fileName: "proof.pdf" },
      caseDescription: "original",
    };
    const server = {
      economicProofMeta: null,
      caseDescription: "staff updated description",
    };
    const result = threeWayMerge(base, client, server);
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.caseDescription).toBe("staff updated description");
    expect((result.merged.economicProofMeta as { materialId: string }).materialId).toBe("M1");
  });

  it("concurrent applicant material upload and staff correction reason - no field conflict", () => {
    const base = {
      fullName: "Zhang",
      economicProofMeta: null,
      state: "SUBMITTED",
    };
    const client = {
      fullName: "Zhang",
      economicProofMeta: { materialId: "M1", fileName: "econ.pdf" },
      state: "SUBMITTED",
    };
    const server = {
      fullName: "Zhang",
      economicProofMeta: null,
      state: "NEEDS_CORRECTION",
    };
    const result = threeWayMerge(base, client, server);
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.state).toBe("NEEDS_CORRECTION");
    expect((result.merged.economicProofMeta as { materialId: string }).materialId).toBe("M1");
  });
});

describe("diffChangedFields", () => {
  it("detects which fields changed between base and current", () => {
    const base = { name: "A", phone: "1", email: "a@b.com" };
    const current = { name: "B", phone: "1", email: "c@d.com" };
    const changed = diffChangedFields(base, current, ["name", "phone", "email"]);
    expect(changed).toContain("name");
    expect(changed).toContain("email");
    expect(changed).not.toContain("phone");
  });

  it("returns empty array when no fields changed", () => {
    const base = { name: "A" };
    const current = { name: "A" };
    const changed = diffChangedFields(base, current, ["name"]);
    expect(changed).toHaveLength(0);
  });
});

describe("legacy two-way conflict resolution (backward compat)", () => {
  it("client wins when version matches", () => {
    const result = resolveFieldLevelConflict(
      { name: "Server" },
      { name: "Client" },
      1,
      1
    );
    expect(result.merged.name).toBe("Client");
  });

  it("detects conflicts on stale version", () => {
    const result = resolveFieldLevelConflict(
      { name: "Server", phone: "111" },
      { name: "Client", phone: "222" },
      1,
      2
    );
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it("protects accommodations from overwrite", () => {
    const result = resolveFieldLevelConflict(
      { accommodations: ["HOME_VISIT_NEEDED"] },
      { accommodations: ["SIGN_INTERPRETER"] },
      1,
      2
    );
    const accoms = result.merged.accommodations as string[];
    expect(accoms).toContain("HOME_VISIT_NEEDED");
    expect(accoms).toContain("SIGN_INTERPRETER");
  });
});

describe("isStaleDraft", () => {
  it("returns true for older version", () => {
    expect(isStaleDraft(1, 3)).toBe(true);
  });
  it("returns false for same version", () => {
    expect(isStaleDraft(3, 3)).toBe(false);
  });
});

describe("sanitizeClientDraft", () => {
  it("strips non-whitelisted fields like state and idempotencyKey", () => {
    const dirty = {
      fullName: "Test",
      state: "ACCEPTED",
      version: 1,
      idempotencyKey: "hack",
      accommodations: ["A"],
    };
    const clean = sanitizeClientDraft(dirty, CLIENT_EDITABLE_FIELDS);
    expect(clean.fullName).toBe("Test");
    expect(clean.state).toBeUndefined();
    expect(clean.idempotencyKey).toBeUndefined();
    expect(clean.accommodations).toEqual(["A"]);
  });
});
