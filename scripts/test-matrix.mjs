/**
 * Fixture acceptance matrix (SPEC-basis-verify §7) + a 200-iteration byte-flip
 * smoke. Asserts every tampered fixture fails at the right record with the
 * right check. Run after build + fixtures:  node scripts/test-matrix.mjs
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { detectFormat, verifyAuraisChain, verifyChain } from "../dist/index.js";

const load = (n) => JSON.parse(readFileSync(`fixtures/${n}`, "utf8"));
const keys = load("keys.json");

const MATRIX = [
  ["valid.chain.json", null, null],
  ["tampered-amount.chain.json", 2, "signature"],
  ["broken-link.chain.json", 3, "link"],
  ["reordered.chain.json", 1, "link"],
  ["unknown-key.chain.json", 0, "key"],
  ["bad-schema.chain.json", 4, "schema"],
  ["non-monotonic.chain.json", 5, "timestamp"],
];

let failures = 0;
for (const [file, failIndex, check] of MATRIX) {
  const r = verifyChain(load(file), keys, { strict: file === "valid.chain.json" });
  const ok =
    failIndex === null
      ? r.valid
      : !r.valid && r.firstFailure.index === failIndex && r.firstFailure.check === check;
  console.log(`${ok ? "✓" : "✗"} ${file} → ${r.valid ? "VALID" : `INVALID @${r.firstFailure.index} (${r.firstFailure.check})`}`);
  if (!ok) failures++;
}

// Aurais format: genuine emitter fixtures + detection + key-embedded verification
{
  const av = load("aurais-valid.chain.json");
  const at = load("aurais-tampered.chain.json");
  const rv = verifyAuraisChain(av);
  const rt = verifyAuraisChain(at);
  const detOk = detectFormat(av) === "aurais" && detectFormat(load("valid.chain.json")) === "basis";
  const ok =
    rv.valid &&
    rv.signers.length === 1 &&
    (rv.notes ?? []).some((n) => n.includes("ephemeral")) &&
    !rt.valid && rt.firstFailure.index === 1 && rt.firstFailure.check === "signature" &&
    detOk;
  console.log(`${ok ? "✓" : "✗"} aurais: valid=${rv.valid} (ephemeral noted) · tampered → INVALID @${rt.firstFailure?.index} (${rt.firstFailure?.check}) · auto-detect ok=${detOk}`);
  if (!ok) failures++;
}

// byte-flip smoke (full 1000-iteration run lives in byte-flip-test.mjs)
execFileSync(process.execPath, ["scripts/byte-flip-test.mjs", "200"], { stdio: "inherit" });

if (failures > 0) {
  console.error(`${failures} matrix failure(s)`);
  process.exit(1);
}
console.log("MATRIX PASS");
