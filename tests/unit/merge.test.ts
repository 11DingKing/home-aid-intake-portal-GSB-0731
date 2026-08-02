import { describe, it, expect } from "vitest";
import { mergeField, mergeFields, valuesEqual, type StoredField } from "@/domain/merge";
import type { ApplicantFieldKey } from "@/domain/constants";

function stored(key: ApplicantFieldKey, value: StoredField["value"], v: number): StoredField {
  return { key, value, updatedAtVersion: v };
}

describe("field-level merge", () => {
  it("applies an edit when the server field has not moved past baseVersion", () => {
    const res = mergeField(stored("fullName", "Old", 2), {
      key: "fullName",
      value: "New",
      baseVersion: 2,
    });
    expect(res.status).toBe("applied");
    expect(res.resolvedValue).toBe("New");
  });

  it("treats an identical value as a no-op even if the server moved", () => {
    const res = mergeField(stored("fullName", "Same", 5), {
      key: "fullName",
      value: "Same",
      baseVersion: 2,
    });
    expect(res.status).toBe("noop");
  });

  it("flags a conflict when the same field diverged past baseVersion", () => {
    const res = mergeField(stored("fullName", "ServerValue", 5), {
      key: "fullName",
      value: "ClientValue",
      baseVersion: 2,
    });
    expect(res.status).toBe("conflict");
    expect(res.conflictReason).toBe("STALE_EDIT");
    // Server value is retained as the resolved value.
    expect(res.resolvedValue).toBe("ServerValue");
  });

  it("protects a live accommodation from being cleared by a stale draft", () => {
    const res = mergeField(stored("accommodations", ["HOME_VISIT_NEEDED"], 5), {
      key: "accommodations",
      value: [],
      baseVersion: 2,
    });
    expect(res.status).toBe("conflict");
    expect(res.conflictReason).toBe("PROTECTED_ACCOMMODATION");
    expect(res.resolvedValue).toEqual(["HOME_VISIT_NEEDED"]);
  });

  it("compares multi-select values order-insensitively", () => {
    expect(valuesEqual(["A", "B"], ["B", "A"])).toBe(true);
    const res = mergeField(stored("accommodations", ["A", "B"], 9), {
      key: "accommodations",
      value: ["B", "A"],
      baseVersion: 1,
    });
    expect(res.status).toBe("noop");
  });

  it("merges a batch: applies non-conflicting fields, isolates conflicts", () => {
    const map = new Map<ApplicantFieldKey, StoredField>([
      ["fullName", stored("fullName", "ServerName", 5)], // diverged -> conflict
      ["contactEmail", stored("contactEmail", "old@x.org", 2)], // not moved -> applied
      ["accommodations", stored("accommodations", ["SIGN_INTERPRETER"], 5)], // protected
    ]);
    const outcome = mergeFields(map, [
      { key: "fullName", value: "ClientName", baseVersion: 2 },
      { key: "contactEmail", value: "new@x.org", baseVersion: 2 },
      { key: "accommodations", value: [], baseVersion: 2 },
    ]);
    expect(outcome.applied.map((r) => r.key)).toEqual(["contactEmail"]);
    const conflictKeys = outcome.conflicts.map((r) => r.key).sort();
    expect(conflictKeys).toEqual(["accommodations", "fullName"]);
  });

  it("two sessions editing DIFFERENT fields from the same base both converge", () => {
    // Base version 3. Session A edits fullName, session B edits contactPhone.
    const afterA = mergeField(stored("fullName", "Base", 3), {
      key: "fullName",
      value: "A-edit",
      baseVersion: 3,
    });
    expect(afterA.status).toBe("applied");
    // Server bumps to v4 for fullName only; contactPhone still at its old version.
    const afterB = mergeField(stored("contactPhone", "555", 3), {
      key: "contactPhone",
      value: "B-edit",
      baseVersion: 3,
    });
    expect(afterB.status).toBe("applied");
  });
});
