import { describe, it, expect } from "vitest";
import { resolveFieldLevelConflict, isStaleDraft, sanitizeClientDraft, CLIENT_EDITABLE_FIELDS } from "@/domain/conflict";

describe("conflict resolution", () => {
  describe("resolveFieldLevelConflict", () => {
    it("returns client data when base version equals server version", () => {
      const server = { name: "Server", phone: "111", accommodations: ["A"] };
      const client = { name: "Client" };
      const result = resolveFieldLevelConflict(server, client, 1, 1);
      expect(result.merged.name).toBe("Client");
      expect(result.merged.phone).toBe("111");
      expect(result.conflicts).toHaveLength(0);
    });

    it("detects conflicts when base version is older", () => {
      const server = { name: "Server", phone: "111" };
      const client = { name: "Client", phone: "222" };
      const result = resolveFieldLevelConflict(server, client, 1, 2);
      expect(result.conflicts).toContain("name");
      expect(result.conflicts).toContain("phone");
    });

    it("protects accommodations from being overwritten - merges instead", () => {
      const server = { name: "Server", accommodations: ["HOME_VISIT_NEEDED"] };
      const client = { name: "Client", accommodations: ["SIGN_INTERPRETER"] };
      const result = resolveFieldLevelConflict(server, client, 1, 2);
      const accoms = result.merged.accommodations as string[];
      expect(accoms).toContain("HOME_VISIT_NEEDED");
      expect(accoms).toContain("SIGN_INTERPRETER");
    });

    it("does not let empty client value overwrite non-empty server value", () => {
      const server = { name: "ServerName", phone: "111" };
      const client = { name: "", phone: null };
      const result = resolveFieldLevelConflict(server, client, 1, 2);
      expect(result.merged.name).toBe("ServerName");
      expect(result.serverWins).toContain("name");
    });

    it("lets client value fill empty server field", () => {
      const server = { name: "", phone: null };
      const client = { name: "ClientName" };
      const result = resolveFieldLevelConflict(server, client, 1, 2);
      expect(result.merged.name).toBe("ClientName");
      expect(result.clientWins).toContain("name");
    });

    it("no conflict when values are identical", () => {
      const server = { name: "Same", phone: "111" };
      const client = { name: "Same" };
      const result = resolveFieldLevelConflict(server, client, 1, 2);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe("isStaleDraft", () => {
    it("returns true when client version is older", () => {
      expect(isStaleDraft(1, 2)).toBe(true);
    });

    it("returns false when versions match", () => {
      expect(isStaleDraft(2, 2)).toBe(false);
    });

    it("returns false when client is newer", () => {
      expect(isStaleDraft(3, 2)).toBe(false);
    });
  });

  describe("sanitizeClientDraft", () => {
    it("only allows whitelisted fields", () => {
      const data = {
        fullName: "Test",
        state: "ACCEPTED",
        version: 1,
        idempotencyKey: "hack",
        accommodations: ["A"],
      };
      const sanitized = sanitizeClientDraft(data, CLIENT_EDITABLE_FIELDS);
      expect(sanitized.fullName).toBe("Test");
      expect(sanitized.accommodations).toEqual(["A"]);
      expect(sanitized.state).toBeUndefined();
      expect(sanitized.idempotencyKey).toBeUndefined();
    });
  });
});
