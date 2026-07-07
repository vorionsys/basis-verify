# @vorionsys/verify

> Verify a BASIS proof chain offline. No network, no service, no trust in Vorion required.

![license](https://img.shields.io/badge/license-Apache--2.0-blue)

## Use

```bash
$ npx @vorionsys/verify chain.json --keys keys.json
✓ record 0 (01KWHJ8DESJGXPRPG4179ZPNB8)
✓ record 1 (01KWHJ8EE13WVTE8T1RYS3AM18)
…
VALID — 6 records, 1 signer (vorion-demo-2026-07), 2026-07-02T14:03:23.481Z → 2026-07-02T14:03:28.481Z
```

Tamper with any byte and it fails at the exact record, with the exact check:

```bash
$ npx @vorionsys/verify fixtures/tampered-amount.chain.json --keys fixtures/keys.json
✗ record 2 (01KWHJ8FD9GR8G0JHMPVT7TDX4) — signature: signature verification failed
INVALID at record 2
```

Flags: `--json` (machine output), `--strict` (duplicate ids, dangling `linksTo`),
`--quiet`. Exit codes: `0` valid · `1` invalid · `2` usage/parse error.

**No network path exists in this package.** There is no key fetching, no `--remote`,
no telemetry — the absence of those features is the feature. A CI job runs the CLI
in a network-disabled container to keep it that way.

## The static verifier

[`verifier.html`](verifier.html) is a single self-contained file generated from the
**same source** as the CLI (generated and diffed in CI so the two can never drift).
It works from `file://` on an air-gapped machine: drag in `chain.json` and
`keys.json`, or click "Load demo fixtures" to see it run with zero files on hand.

## Library

```ts
import { verifyChain } from "@vorionsys/verify";

const result = verifyChain(chainFile, keysFile, { strict: true });
// { valid: true, records: [...], firstFailure: null, signers: ["vorion-demo-2026-07"], span: {...} }
```

Also exported: `hashRecord` (sha256 over the canonical full record) and
`canonicalize`/`canonicalBytes` (RFC 8785). `@vorionsys/gate-core` imports its
canonicalization and hashing **from this package** — the thing that signs cannot
disagree with the thing that verifies.

## What is checked, in order

1. **envelope** — `{ "basisVerify": "1", "records": [...] }` + keys file shape
2. **schema** — every record against `DecisionRecordSchema` from [`contracts`](https://github.com/vorionsys/contracts) (`@vorionsys/contracts/basis`)
3. **key + signature** — Ed25519 over the RFC 8785 canonical record without `sig`
4. **hash link** — `records[i].prev === sha256(canonical(records[i−1]))`, genesis `"GENESIS"`
5. **timestamps** — non-decreasing across the chain
6. **strict extras** — duplicate ids, dangling `verdict.linksTo`

Fail-fast, reporting the exact record index, check name, and message.

## Fixtures

`fixtures/` contains a valid 6-record chain plus one tampered variant per failure
class (signature, link, reorder, unknown key, bad schema, non-monotonic timestamps) —
assert the matrix with `npm test`, and run the 1,000-iteration byte-flip property
test with `npm run test:byte-flip`. Regenerating them (`npm run fixtures`) uses the
real gate engine and needs a one-off `npm i -D @vorionsys/gate-core --no-save` —
it is deliberately not a standing devDependency to keep the verify↔gate install
graph acyclic (gate-core depends on this package at runtime).

## Where this sits in BASIS

```
basis-spec (standard)
   └── basis-gate (pre-action authority pipeline)
         ├── contracts (record schema — @vorionsys/contracts/basis)
         ├── gate-core (reference gate engine — signs what this verifies)
         └── THIS REPO ◄ (offline proof-chain verification)
```

See it end-to-end at [`basis-demo`](https://github.com/vorionsys/basis-demo).
Standard: [`basis-spec`](https://github.com/vorionsys/basis-spec) · [vorion.org](https://vorion.org)

## Status & versioning

`v0.1.0` — API stable enough to script against; strict mode may add checks in minors.
npm publish (with `--provenance`) lands once `@vorionsys/contracts@1.2.0`
(vorionsys/contracts PR: `feat/basis-decision-record`) is merged and released;
until then, build from source below. Non-goals for v1: multi-signer chains, key
rotation/revocation lists, Merkle batching, timestamp authorities.

## Development

```bash
git clone https://github.com/vorionsys/basis-verify && cd basis-verify
npm install && npm run build && npm test
npm run build:verifier   # regenerate verifier.html from src/
```

Node ≥ 18. PRs: small, tested, one concern. Issues welcome — including
"the README lied to me," which we treat as a bug.

## License

Apache-2.0 © Vorion LLC
