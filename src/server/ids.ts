import { randomBytes } from "node:crypto";

// Human-legible application IDs (APP-######) plus opaque idempotency keys.
export function newApplicationId(): string {
  // 6 digits derived from random bytes; collision-checked by caller.
  const n = (randomBytes(4).readUInt32BE(0) % 900000) + 100000;
  return `APP-${n}`;
}

export function requestHash(input: unknown): string {
  // Small stable hash for idempotency request bodies (djb2 over JSON).
  const s = JSON.stringify(input ?? null);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
