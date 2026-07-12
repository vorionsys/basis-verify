/**
 * @vorionsys/verify — src/formats/aurais.ts
 * Verifier for Aurais proof chains (the format emitted by @vorionsys/aurais-mcp-*
 * bots and @vorionsys/aurais-core's ProofChain) — absorbing @vorionsys/aurais-verify
 * per the convergence plan (vorionsys/basis-gate#8).
 *
 * Format: a JSON array (or { proofChain: [...] } tool result) of events
 *   { seq, ts, action, payload, prev_hash, pubkey, key_id, sig }
 * - sig: Ed25519 over canonical JSON of the event without `sig`
 * - pubkey: base64 DER SPKI (12-byte ed25519 prefix + 32 raw bytes), embedded
 *   per event — no separate keys file
 * - prev_hash: hex sha256 of the canonical JSON of the previous FULL event
 *   ("" for the first); seq must equal the array index; one key_id per chain
 *
 * Aurais' canonical JSON (sorted keys, no whitespace) is byte-identical to our
 * RFC 8785 canonicalizer for JSON-safe values, so this reuses the same core the
 * BASIS verifier uses. Keys whose key_id starts with "ed25519-ephemeral:" are
 * session-scoped (BYOK default): they prove integrity, not identity — surfaced
 * as a note, exactly as aurais-verify does.
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { canonicalBytes, canonicalize } from "../canonicalize.js";
import type { RecordCheck, VerifyResult } from "../verify.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

interface AuraisEvent {
  seq: number;
  ts: string;
  action: string;
  payload: unknown;
  prev_hash: string;
  pubkey: string;
  key_id: string;
  sig: string;
}

const REQUIRED: (keyof AuraisEvent)[] = ["seq", "ts", "action", "payload", "prev_hash", "pubkey", "key_id", "sig"];

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const b64ToBytes = (s: string): Uint8Array => {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(s, "base64"));
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** DER SPKI for ed25519 is exactly 44 bytes: fixed 12-byte prefix + raw key. */
const SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
function rawKeyFromSpki(pubB64: string): Uint8Array {
  const der = b64ToBytes(pubB64);
  if (der.length !== 44 || !SPKI_PREFIX.every((b, i) => der[i] === b)) {
    throw new Error("pubkey is not a DER SPKI ed25519 key");
  }
  return der.slice(12);
}

function unsignedView(e: AuraisEvent): Record<string, unknown> {
  return { seq: e.seq, ts: e.ts, action: e.action, payload: e.payload, prev_hash: e.prev_hash, pubkey: e.pubkey, key_id: e.key_id };
}

/** Verify an Aurais proof chain. Accepts the bare array or a { proofChain } wrapper.
 *  Fail-fast at the exact event, same reporting shape as the BASIS verifier. */
export function verifyAuraisChain(input: unknown): VerifyResult {
  const results: RecordCheck[] = [];
  const fail = (index: number, id: string | null, check: RecordCheck["check"], message: string): VerifyResult => {
    results.push({ index, id, ok: false, check, message });
    return { valid: false, records: results, firstFailure: { index, id, check: check!, message }, signers: [], span: null, notes: [] };
  };

  const chain =
    input && !Array.isArray(input) && typeof input === "object"
      ? ((input as { proofChain?: unknown }).proofChain ?? input)
      : input;
  if (!Array.isArray(chain) || chain.length === 0) {
    return fail(-1, null, "envelope", "an Aurais chain is a non-empty JSON array of proof events (or a { proofChain } tool result)");
  }

  let firstKeyId: string | null = null;
  let prevCanonical = "";

  for (let i = 0; i < chain.length; i++) {
    const e = chain[i] as AuraisEvent;
    const id = typeof e?.seq === "number" ? `seq ${e.seq} (${e?.action ?? "?"})` : null;

    const missing = REQUIRED.filter((f) => e == null || (e as unknown as Record<string, unknown>)[f as string] === undefined);
    if (missing.length) return fail(i, id, "schema", `missing fields: ${missing.join(", ")}`);

    if (e.seq !== i) return fail(i, id, "sequence", `seq ${e.seq} != position ${i}`);

    const expectedPrev = i === 0 ? "" : hex(sha256(new TextEncoder().encode(prevCanonical)));
    if (e.prev_hash !== expectedPrev) {
      return fail(i, id, "link", i === 0 ? `first event prev_hash must be "" (got "${e.prev_hash}")` : `prev_hash does not match sha256 of event ${i - 1}`);
    }

    let sigOk = false;
    try {
      sigOk = ed.verify(b64ToBytes(e.sig), canonicalBytes(unsignedView(e)), rawKeyFromSpki(e.pubkey));
    } catch (err) {
      return fail(i, id, "signature", `verification error: ${(err as Error).message}`);
    }
    if (!sigOk) return fail(i, id, "signature", "ed25519 signature invalid");

    if (firstKeyId === null) firstKeyId = e.key_id;
    if (e.key_id !== firstKeyId) return fail(i, id, "key", `key_id changed mid-chain (${e.key_id} != ${firstKeyId})`);

    results.push({ index: i, id, ok: true });
    prevCanonical = canonicalize(e);
  }

  const events = chain as AuraisEvent[];
  const notes: string[] = [];
  if ((firstKeyId ?? "").startsWith("ed25519-ephemeral:")) {
    notes.push("signing key is session-scoped (ephemeral): this chain proves integrity, not signer identity");
  }
  notes.push(`tip: sha256:${hex(sha256(new TextEncoder().encode(prevCanonical)))}`);

  return {
    valid: true,
    records: results,
    firstFailure: null,
    signers: firstKeyId ? [firstKeyId] : [],
    span: { from: events[0].ts, to: events[events.length - 1].ts },
    notes,
  };
}

/** Heuristic format detection for --format auto. */
export function detectFormat(input: unknown): "basis" | "aurais" | null {
  if (Array.isArray(input)) return "aurais";
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (o.basisVerify === "1") return "basis";
    if (Array.isArray(o.proofChain)) return "aurais";
  }
  return null;
}
