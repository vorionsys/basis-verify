# @vorionsys/verify

> Verify a BASIS proof chain offline. No network, no service, no trust in Vorion required.

**Status:** Published on npm as `@vorionsys/verify@0.6.0`. The CLI, library, and `verifier.html` verify BASIS chains offline, and the CLI auto-detects Aurais chains. Pre-1.0: strict mode may add checks; key rotation, Merkle batching, and timestamp authorities are absent.  
`npm test` on this tree: 8/8 fixture-matrix checks passed, 0 failed; its 200-iteration byte-flip smoke had 0 escapes. `npm run test:byte-flip`: 1,000 iterations, 0 escapes.  
Known issue: `@vorionsys/contracts@^1.6.0` (resolved 1.6.1) depends on `zod@^3.24.1` (resolved 3.25.76), inside open high-severity [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (`zod < 4.6.6`).

![license](https://img.shields.io/badge/license-Apache--2.0-blue)

## Use

```bash
$ npx @vorionsys/verify fixtures/valid.chain.json --keys fixtures/keys.json
✓ record 0 (01KWHJ8DESJGXPRPG4179ZPNB8)
✓ record 1 (01KWHJ8EE13WVTE8T1RYS3AM18)
✓ record 2 (01KWHJ8FD9GR8G0JHMPVT7TDX4)
✓ record 3 (01KWHJ8GCHV90F04X7AKQJSKK2)
✓ record 4 (01KWHJ8HBS82WZ7T7D204BHZDC)
✓ record 5 (01KWHJ8JB1BMD0RDT5NGRMFD70)
VALID [basis] — 6 records, 1 signer (vorion-demo-2026-07), 2026-07-02T14:03:23.481Z → 2026-07-02T14:03:28.481Z
```

Tamper with any byte and it fails at the exact record, with the exact check:

```bash
$ npx @vorionsys/verify fixtures/tampered-amount.chain.json --keys fixtures/keys.json
✓ record 0 (01KWHJ8DESJGXPRPG4179ZPNB8)
✓ record 1 (01KWHJ8EE13WVTE8T1RYS3AM18)
✗ record 2 (01KWHJ8FD9GR8G0JHMPVT7TDX4) — signature: signature verification failed
INVALID at record 2 (01KWHJ8FD9GR8G0JHMPVT7TDX4): signature verification failed
```

Flags: `--json` (machine output), `--strict` (duplicate ids, dangling `linksTo`),
`--quiet`. Exit codes: `0` valid · `1` invalid · `2` usage/parse error.
Installed globally, the command is `basis-verify` — deliberately not `verify`,
which is a cmd.exe built-in that shadows it on Windows.

**No network path exists in this package.** There is no key fetching, no `--remote`,
no telemetry — the absence of those features is the feature. A CI job runs the CLI
in a network-disabled container to keep it that way.

## Aurais chains too

The same CLI verifies **Aurais proof chains** (the format `@vorionsys/aurais-core`'s
`ProofChain` emits; the published `@vorionsys/aurais-mcp-*` packages depend on that
library). No flags needed — the format is auto-detected,
and Aurais events embed their keys, so there is no `--keys` file:

```bash
$ npx @vorionsys/verify fixtures/aurais-valid.chain.json
✓ record 0 (seq 0 (session_started))
✓ record 1 (seq 1 (commentary_generated))
✓ record 2 (seq 2 (briefing_assembled))
✓ record 3 (seq 3 (session_closed))
ℹ signing key is session-scoped (ephemeral): this chain proves integrity, not signer identity
ℹ tip: sha256:2724ff703930ca77ad86dcb1369a18f9c6e6d0e00a0442a801a256c11276c0be
VALID [aurais] — 4 records, 1 signer (ed25519-ephemeral:8087efd8c49b), 2026-07-12T13:57:44.058Z → 2026-07-12T13:57:44.062Z
```

Checks: per-event Ed25519 (embedded SPKI keys), hash links, sequence, chain-wide
key consistency — plus an advisory when `key_id` starts with `ed25519-ephemeral:`
(integrity, not signer identity). [`aurais-verify`](https://www.npmjs.com/package/@vorionsys/aurais-verify)
flags that same distinction with different CLI wording. This CLI covers that format
per [basis-gate#8](https://github.com/vorionsys/basis-gate/issues/8).
`scripts/make-aurais-fixtures.mjs` calls that `ProofChain`. A fresh run mints a new
ephemeral key and writes a different fixture than the one committed.
Force a format with `--format basis|aurais` when auto-detection isn't wanted.

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

`0.6.0` is the version in `package.json` and the latest release on npm.
It verifies BASIS decision-record chains and Aurais proof chains
([basis-gate#8](https://github.com/vorionsys/basis-gate/issues/8)).
`@vorionsys/aurais-verify@0.5.1` is still published and is not marked deprecated;
that issue says it deprecates with a pointer here once its consumers migrate.
The TypeScript sources are the same since 0.4.0. Releases 0.5.0 and 0.6.0 were rebuilt against `@vorionsys/contracts` `^1.5.0` and then `^1.6.0`, and the schema those builds accept gained the reason codes `APPROVAL_CEILING_EXCEEDED` and then `VERIFICATION_REQUIRED`. Strict mode may add checks in minors.
A second BASIS signer is not rejected when its `kid` is in the keys file.
Still out of scope: key rotation/revocation lists, Merkle batching, timestamp authorities.

## Development

```bash
git clone https://github.com/vorionsys/basis-verify && cd basis-verify
npm install && npm run build && npm test
npm run build:verifier   # regenerate verifier.html from src/
```

Node ≥ 18. PRs: small, tested, one concern. Issues welcome — including
"the README lied to me," which we treat as a bug.

## License

Apache-2.0. Copyright 2026 Vorion Systems
