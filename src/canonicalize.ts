/**
 * @vorionsys/verify — src/canonicalize.ts
 * Minimal RFC 8785 (JSON Canonicalization Scheme) implementation.
 *
 * This is the ONLY canonicalizer in the ecosystem. gate-core imports it from
 * this package to sign; the verifier uses it to verify. One implementation,
 * zero drift by construction.
 *
 * Scope notes (documented, deliberate):
 * - Key sort: Array.prototype.sort() default = UTF-16 code-unit order, which is
 *   exactly what RFC 8785 §3.2.3 requires for our key space.
 * - Numbers/strings: JSON.stringify implements the ECMAScript serialization
 *   RFC 8785 mandates (short escapes, \u00XX for control chars, ES number formatting).
 * - undefined object values are skipped (standard JSON semantics).
 * - NaN/Infinity/BigInt/functions throw — they must never reach a record.
 */

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";

  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("JCS: non-finite number");
    }
    return JSON.stringify(value);
  }

  if (t === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]";
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort(); // UTF-16 code-unit order per RFC 8785
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]));
    return "{" + parts.join(",") + "}";
  }

  throw new Error(`JCS: unsupported type "${t}"`);
}

/** UTF-8 bytes of the canonical form — the exact input to hash/sign/verify. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
