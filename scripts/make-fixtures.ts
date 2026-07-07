/**
 * basis-verify — scripts/make-fixtures.ts
 * Generates fixtures/ for the acceptance criteria in SPEC-basis-verify §7:
 *   valid.chain.json + keys.json, plus one tampered fixture per failure class.
 *
 * Uses @vorionsys/gate-core to build the valid chain (the same engine the demo
 * uses), then derives tampered variants. Where a variant must remain
 * signature-valid (reordered, non-monotonic), records are re-signed and
 * re-linked with the fixture private key so ONLY the target check fails.
 *
 * Run: npx tsx scripts/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { GateChain, ed25519Signer, type GateContext, type PolicyDoc } from "@vorionsys/gate-core";
import { hashRecord, canonicalBytes } from "../src/index.js"; // canonicalBytes lives in canonicalize.ts; index re-exports both
import { toSignable, type ChainFile, type DecisionRecord } from "@vorionsys/contracts/basis";

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

const OUT = "fixtures";
const KID = "vorion-demo-2026-07";

/* deterministic-ish fixtures: fixed clock ticking 1s per record, seeded rng */
let tick = Date.parse("2026-07-02T14:03:22.481Z");
const now = () => new Date((tick += 1000));
let seed = 42;
const rng = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

const privateKey = ed.utils.randomPrivateKey(); // fresh per generation; pubkey written alongside
const signer = ed25519Signer(privateKey, KID);

const policy: PolicyDoc = {
  id: "pol_qclose",
  version: "1.0.0",
  domainAllowlist: ["finance.ledger", "finance.payments"],
  tierCaps: { 2: { paymentUsdMax: 10_000 } },
};

const activeCtx: GateContext = {
  agent: { id: "agt_qclose_01", tier: 2 },
  credential: { id: "cred_9f3a", status: "active", expiresAt: "2026-07-02T14:05:00.000Z" },
};
const expiredCtx: GateContext = {
  ...activeCtx,
  credential: { ...activeCtx.credential, status: "expired" },
};

/* ── build the valid 6-record chain (mirrors scenario.ts, deny path) ────── */

const gate = new GateChain({ policy, signer, now, rng });

gate.evaluate(activeCtx, { domain: "finance.ledger", capability: "ledger.read", params: { period: "2026-Q2" } });
gate.evaluate(activeCtx, { domain: "finance.ledger", capability: "ledger.write", params: { account: "4010", amountUsd: 1842.17, memo: "Q2 reconciliation — synthetic demo data" } });
const esc = gate.evaluate(activeCtx, { domain: "finance.payments", capability: "payments.execute", params: { vendorId: "ven_northwind", invoice: "INV-88213", amountUsd: 250000 } });
gate.resolveEscalation(esc.id, "deny", activeCtx);
gate.evaluate(activeCtx, { domain: "vendor.api", capability: "vendor.api.call", params: { host: "flashpay.example", path: "/v1/quotes" } });
gate.evaluate(expiredCtx, { domain: "finance.ledger", capability: "ledger.write", params: { account: "4010", amountUsd: 312.09, memo: "closing entry — synthetic demo data" } });

const valid = gate.toChainFile();

/* ── helpers for tampered variants ──────────────────────────────────────── */

const clone = (c: ChainFile): ChainFile => JSON.parse(JSON.stringify(c));

const toB64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** Re-sign a record with the fixture key (for variants that must stay sig-valid). */
function resign(r: DecisionRecord): DecisionRecord {
  const sigValue = toB64(ed.sign(canonicalBytes(toSignable(r)), privateKey));
  return { ...r, sig: { ...r.sig, value: sigValue } };
}

/** Recompute prev links across the whole chain, re-signing as we go. */
function relink(records: DecisionRecord[]): DecisionRecord[] {
  let prev = "GENESIS";
  return records.map((r) => {
    const linked = resign({ ...r, prev });
    prev = hashRecord(linked);
    return linked;
  });
}

/* ── variants (one per failure class, SPEC §1.4) ────────────────────────── */

// signature: edit a field without re-signing → fails at record 2 (index 2)
const tamperedAmount = clone(valid);
tamperedAmount.records[2].action.paramsHash = tamperedAmount.records[2].action.paramsHash.replace(/.$/, (c) => (c === "0" ? "1" : "0"));

// link: valid signature, broken prev → re-sign record 3 with a corrupted prev
const brokenLink = clone(valid);
brokenLink.records[3] = resign({ ...brokenLink.records[3], prev: "sha256:" + "0".repeat(64) });

// reordered: swap records 1 and 2, re-link + re-sign → signatures fine, link check
// passes too after relink… so break it honestly: swap WITHOUT relinking.
const reordered = clone(valid);
[reordered.records[1], reordered.records[2]] = [reordered.records[2], reordered.records[1]];

// unknown key: kid not present in keys.json
const unknownKey = clone(valid);
unknownKey.records[0] = { ...unknownKey.records[0], sig: { ...unknownKey.records[0].sig, kid: "not-a-known-key" } };

// bad schema: delete a required field
const badSchema = clone(valid) as unknown as { records: Record<string, unknown>[] } & ChainFile;
delete (badSchema.records[4] as Record<string, unknown>)["policy"];

// non-monotonic timestamps: swap ts on records 4 and 5, then relink+resign the
// whole chain so ONLY the timestamp check fails.
const nonMono = clone(valid);
const t4 = nonMono.records[4].ts;
nonMono.records[4] = { ...nonMono.records[4], ts: nonMono.records[5].ts };
nonMono.records[5] = { ...nonMono.records[5], ts: t4 };
nonMono.records = relink(nonMono.records);

/* ── write ──────────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });
const write = (name: string, data: unknown) =>
  writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2) + "\n");

write("keys.json", { [KID]: signer.publicKeyBase64 });
write("valid.chain.json", valid);
write("tampered-amount.chain.json", tamperedAmount);
write("broken-link.chain.json", brokenLink);
write("reordered.chain.json", reordered);
write("unknown-key.chain.json", unknownKey);
write("bad-schema.chain.json", badSchema);
write("non-monotonic.chain.json", nonMono);

console.log(`wrote 8 files to ${OUT}/ — expected results:
  valid.chain.json            → VALID (exit 0)
  tampered-amount             → INVALID record 2, signature
  broken-link                 → INVALID record 3, link
  reordered                   → INVALID record 1, signature-or-link
  unknown-key                 → INVALID record 0, key
  bad-schema                  → INVALID record 4, schema
  non-monotonic               → INVALID record 5, timestamp`);
