/**
 * Byte-flip property test (BUILD-NOTES CI job 3, refined):
 * flip one random byte in valid.chain.json — any flip that CHANGES THE PARSED
 * CONTENT must yield INVALID (or fail to parse). Flips inside JSON whitespace
 * are semantic no-ops and are skipped, not counted as escapes.
 *
 * Run: node scripts/byte-flip-test.mjs [iterations]
 */
import { readFileSync } from "node:fs";
import { verifyChain, canonicalize } from "../dist/index.js";

const N = Number(process.argv[2] ?? 1000);
const text = readFileSync("fixtures/valid.chain.json", "utf8");
const keys = JSON.parse(readFileSync("fixtures/keys.json", "utf8"));
const canonicalOriginal = canonicalize(JSON.parse(text));

// deterministic LCG so failures are reproducible
let seed = 1;
const rng = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

let parseFail = 0, invalid = 0, noop = 0, escapes = 0;
for (let i = 0; i < N; i++) {
  const pos = Math.floor(rng() * text.length);
  const flipped = String.fromCharCode(text.charCodeAt(pos) ^ (1 << Math.floor(rng() * 7)));
  const mutated = text.slice(0, pos) + flipped + text.slice(pos + 1);

  let parsed;
  try {
    parsed = JSON.parse(mutated);
  } catch {
    parseFail++;
    continue;
  }
  let canon;
  try {
    canon = canonicalize(parsed);
  } catch {
    invalid++; // non-JSON-safe value (e.g. lone surrogate) — cannot be a valid chain
    continue;
  }
  if (canon === canonicalOriginal) {
    noop++; // whitespace or equivalent-value flip: content unchanged
    continue;
  }
  const result = verifyChain(parsed, keys);
  if (result.valid) {
    escapes++;
    console.error(`ESCAPE at byte ${pos}: content changed but chain verified VALID`);
  } else {
    invalid++;
  }
}

console.log(`byte-flip: ${N} iterations — ${parseFail} parse failures, ${invalid} detected invalid, ${noop} semantic no-ops, ${escapes} ESCAPES`);
process.exit(escapes === 0 ? 0 : 1);
