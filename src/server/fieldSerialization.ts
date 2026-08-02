import type { StoredValue } from "@/domain/merge";
import { ACCOMMODATIONS, type Accommodation } from "@/domain/constants";

// Fields whose value is a list serialized as JSON in the DB.
const ARRAY_FIELDS = new Set<string>(["accommodations"]);

export function isArrayField(key: string): boolean {
  return ARRAY_FIELDS.has(key);
}

/** Serialize a domain field value to the nullable TEXT column. */
export function serializeFieldValue(key: string, value: StoredValue): string | null {
  if (value === null) return null;
  if (isArrayField(key)) {
    const arr = Array.isArray(value) ? value : [value];
    return JSON.stringify(arr);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

/** Parse a TEXT column back to a domain field value. */
export function deserializeFieldValue(key: string, raw: string | null): StoredValue {
  if (raw === null) return isArrayField(key) ? [] : null;
  if (isArrayField(key)) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
      return [];
    } catch {
      return [];
    }
  }
  return raw;
}

/** Coerce an unknown value from a stored accommodations list into valid enums. */
export function parseAccommodations(value: StoredValue): Accommodation[] {
  const list = Array.isArray(value) ? value : [];
  return list.filter((v): v is Accommodation =>
    (ACCOMMODATIONS as readonly string[]).includes(v),
  );
}
