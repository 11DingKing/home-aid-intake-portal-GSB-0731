import { describe, it, expect } from "vitest";
import {
  mergeField,
  mergeFields,
  fieldsChangedSince,
  type StoredField,
} from "@/domain/merge";
import type { ApplicantFieldKey } from "@/domain/constants";

function stored(key: ApplicantFieldKey, value: StoredField["value"], v: number): StoredField {
  return { key, value, updatedAtVersion: v };
}

describe("three-way merge (base/server/client)", () => {
  it("takes the client value when the server did not change from base", () => {
    const res = mergeField(stored("fullName", "Base", 3), {
      key: "fullName",
      value: "Client",
      baseVersion: 1,
      baseValue: "Base",
    });
    expect(res.basis).toBe("three-way");
    expect(res.status).toBe("applied");
    expect(res.resolvedValue).toBe("Client");
  });

  it("is a no-op when the client did not actually change from base (keeps server value)", () => {
    // Server moved to "ServerNew"; client still holds the old base "Base".
    const res = mergeField(stored("fullName", "ServerNew", 5), {
      key: "fullName",
      value: "Base",
      baseVersion: 1,
      baseValue: "Base",
    });
    expect(res.status).toBe("noop");
    expect(res.resolvedValue).toBe("ServerNew");
  });

  it("conflicts only when BOTH server and client changed the same field", () => {
    const res = mergeField(stored("fullName", "ServerNew", 5), {
      key: "fullName",
      value: "ClientNew",
      baseVersion: 1,
      baseValue: "Base",
    });
    expect(res.status).toBe("conflict");
    expect(res.conflictReason).toBe("STALE_EDIT");
    expect(res.resolvedValue).toBe("ServerNew");
    expect(res.baseValue).toBe("Base");
  });

  it("does NOT conflict when server and client converged to the same new value", () => {
    const res = mergeField(stored("fullName", "Same", 5), {
      key: "fullName",
      value: "Same",
      baseVersion: 1,
      baseValue: "Base",
    });
    expect(res.status).toBe("noop");
  });

  it("still protects a live accommodation from being cleared under three-way", () => {
    const res = mergeField(stored("accommodations", ["HOME_VISIT_NEEDED"], 5), {
      key: "accommodations",
      value: [],
      baseVersion: 1,
      baseValue: [],
    });
    expect(res.status).toBe("conflict");
    expect(res.conflictReason).toBe("PROTECTED_ACCOMMODATION");
    expect(res.resolvedValue).toEqual(["HOME_VISIT_NEEDED"]);
  });

  it("falls back to version-based merge when no baseValue is supplied", () => {
    const applied = mergeField(stored("fullName", "S", 2), {
      key: "fullName",
      value: "C",
      baseVersion: 2,
    });
    expect(applied.basis).toBe("version");
    expect(applied.status).toBe("applied");

    const conflict = mergeField(stored("fullName", "S", 5), {
      key: "fullName",
      value: "C",
      baseVersion: 2,
    });
    expect(conflict.basis).toBe("version");
    expect(conflict.status).toBe("conflict");
  });

  it("batch: three-way applies the untouched-by-server field and conflicts the co-edited one", () => {
    const map = new Map<ApplicantFieldKey, StoredField>([
      ["fullName", stored("fullName", "ServerName", 5)], // server changed
      ["contactPhone", stored("contactPhone", "555-base", 2)], // server untouched since base
    ]);
    const outcome = mergeFields(map, [
      { key: "fullName", value: "ClientName", baseVersion: 1, baseValue: "Base" },
      { key: "contactPhone", value: "555-client", baseVersion: 1, baseValue: "555-base" },
    ]);
    expect(outcome.applied.map((r) => r.key)).toEqual(["contactPhone"]);
    expect(outcome.conflicts.map((r) => r.key)).toEqual(["fullName"]);
  });
});

describe("fieldsChangedSince", () => {
  it("reports fields whose version is beyond the given base", () => {
    const fields: StoredField[] = [
      stored("fullName", "x", 1),
      stored("identityProof", "ID-META-9", 4),
      stored("economicProof", "ECON-2", 4),
    ];
    expect(fieldsChangedSince(fields, 2).sort()).toEqual(["economicProof", "identityProof"]);
    expect(fieldsChangedSince(fields, 4)).toEqual([]);
  });
});
