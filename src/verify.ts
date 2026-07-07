/**
 * @vorionsys/verify — src/verify.ts
 * Pure verification core. No network. No telemetry. No side effects.
 *
 * Deps: @noble/ed25519, @noble/hashes, zod (via @vorionsys/contracts).
 */
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import {
  DecisionRecordSchema,
  parseKeysFile,
  toSignable,
  type DecisionRecord,
  type KeysFile,
} from "@vorionsys/contracts/basis";
import { canonicalBytes } from "./canonicalize.js";

// @noble/ed25519 v2 needs a sha512 provider for sync APIs — wire it once here.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

/* ── result types ───────────────────────────────────────────────────────── */

export type CheckName = "envelope" | "schema" | "key" | "signature" | "link" | "timestamp" | "strict";

export interface RecordCheck {
  index: number;
  id: string | null;
  ok: boolean;
  check?: CheckName;
  message?: string;
}

export interface VerifyResult {
  valid: boolean;
  records: RecordCheck[];
  firstFailure: { index: number; id: string | null; check: CheckName; message: string } | null;
  signers: string[]; // distinct kids seen on valid-signature records
  span: { from: string; to: string } | null;
}

export interface VerifyOptions {
  strict?: boolean;
  /** Optional vocab from @vorionsys/shared-constants for strict membership checks. */
  strictVocab?: { domains?: readonly string[]; capabilities?: readonly string[] };
}

/* ── helpers ────────────────────────────────────────────────────────────── */

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** sha256 over the canonical form of the FULL record (including sig) → "sha256:<hex>" */
export function hashRecord(record: DecisionRecord): string {
  return "sha256:" + hex(sha256(canonicalBytes(record)));
}

const b64ToBytes = (s: string): Uint8Array => {
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(s, "base64"));
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/* ── the algorithm (SPEC-basis-verify §4) ───────────────────────────────── */

export function verifyChain(chainInput: unknown, keysInput: unknown, opts: VerifyOptions = {}): VerifyResult {
  const results: RecordCheck[] = [];
  const fail = (index: number, id: string | null, check: CheckName, message: string): VerifyResult => {
    results.push({ index, id, ok: false, check, message });
    return { valid: false, records: results, firstFailure: { index, id, check, message }, signers: [], span: null };
  };

  // 0. envelope + keys
  const env = chainInput as { basisVerify?: unknown; records?: unknown };
  if (!env || env.basisVerify !== "1" || !Array.isArray(env.records) || env.records.length === 0) {
    return fail(-1, null, "envelope", 'chain file must be { "basisVerify": "1", "records": [ …≥1 ] }');
  }
  let keys: KeysFile;
  try {
    keys = parseKeysFile(keysInput);
  } catch (e) {
    return fail(-1, null, "envelope", `keys file invalid: ${(e as Error).message}`);
  }

  // 1. schema-validate every record (fail fast at exact index)
  const records: DecisionRecord[] = [];
  for (let i = 0; i < env.records.length; i++) {
    const parsed = DecisionRecordSchema.safeParse(env.records[i]);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const id = (env.records[i] as { id?: string })?.id ?? null;
      return fail(i, id, "schema", `${first.path.join(".") || "(root)"}: ${first.message}`);
    }
    records.push(parsed.data);
  }

  const signers = new Set<string>();
  let prevHash = "GENESIS";
  let prevTs = "";

  for (let i = 0; i < records.length; i++) {
    const r = records[i];

    // 2. signature
    const pub = keys[r.sig.kid];
    if (!pub) return fail(i, r.id, "key", `unknown kid "${r.sig.kid}" — not present in keys file`);
    let sigOk = false;
    try {
      sigOk = ed.verify(b64ToBytes(r.sig.value), canonicalBytes(toSignable(r)), b64ToBytes(pub));
    } catch (e) {
      return fail(i, r.id, "signature", `verification error: ${(e as Error).message}`);
    }
    if (!sigOk) return fail(i, r.id, "signature", "signature verification failed");
    signers.add(r.sig.kid);

    // 3. hash link
    if (r.prev !== prevHash) {
      return fail(i, r.id, "link", `prev mismatch — expected ${prevHash.slice(0, 18)}…, got ${String(r.prev).slice(0, 18)}…`);
    }
    prevHash = hashRecord(r);

    // 4. timestamp monotonicity (RFC 3339 UTC strings compare lexicographically)
    if (i > 0 && r.ts < prevTs) {
      return fail(i, r.id, "timestamp", `ts ${r.ts} precedes previous record ${prevTs}`);
    }
    prevTs = r.ts;

    results.push({ index: i, id: r.id, ok: true });
  }

  // 5. strict extras
  if (opts.strict) {
    const ids = new Set(records.map((r) => r.id));
    if (ids.size !== records.length) return fail(-1, null, "strict", "duplicate record ids in chain");
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.verdict.linksTo && !ids.has(r.verdict.linksTo)) {
        return fail(i, r.id, "strict", `linksTo ${r.verdict.linksTo} does not exist in chain`);
      }
      const v = opts.strictVocab;
      if (v?.domains && !v.domains.includes(r.action.domain)) {
        return fail(i, r.id, "strict", `domain "${r.action.domain}" not in shared-constants vocabulary`);
      }
      if (v?.capabilities && !v.capabilities.includes(r.action.capability)) {
        return fail(i, r.id, "strict", `capability "${r.action.capability}" not in shared-constants vocabulary`);
      }
    }
  }

  return {
    valid: true,
    records: results,
    firstFailure: null,
    signers: [...signers],
    span: { from: records[0].ts, to: records[records.length - 1].ts },
  };
}
