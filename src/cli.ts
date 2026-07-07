#!/usr/bin/env node
/**
 * @vorionsys/verify — src/cli.ts
 * Usage: npx @vorionsys/verify <chain.json> --keys <keys.json> [--json] [--strict] [--quiet]
 * Exit codes: 0 valid · 1 invalid · 2 usage/parse error. No network. Ever.
 */
import { readFileSync } from "node:fs";
import { verifyChain, type VerifyResult } from "./verify.js";

function usage(): never {
  process.stderr.write(
    "usage: verify <chain.json> --keys <keys.json> [--json] [--strict] [--quiet]\n",
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  let chainPath: string | null = null;
  let keysPath: string | null = null;
  let json = false, strict = false, quiet = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keys") { keysPath = args[++i] ?? null; }
    else if (a === "--json") json = true;
    else if (a === "--strict") strict = true;
    else if (a === "--quiet") quiet = true;
    else if (a === "--help" || a === "-h") usage();
    else if (a.startsWith("--")) usage();
    else if (!chainPath) chainPath = a;
    else usage();
  }
  if (!chainPath || !keysPath) usage();

  let chain: unknown, keys: unknown;
  try {
    chain = JSON.parse(readFileSync(chainPath, "utf8"));
    keys = JSON.parse(readFileSync(keysPath, "utf8"));
  } catch (e) {
    process.stderr.write(`error reading input: ${(e as Error).message}\n`);
    process.exit(2);
  }

  const result: VerifyResult = verifyChain(chain, keys, { strict });

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!quiet) {
    for (const rc of result.records) {
      if (rc.ok) process.stdout.write(`\u2713 record ${rc.index} (${rc.id})\n`);
      else process.stdout.write(`\u2717 record ${rc.index}${rc.id ? ` (${rc.id})` : ""} — ${rc.check}: ${rc.message}\n`);
    }
    if (result.valid && result.span) {
      const n = result.records.length;
      process.stdout.write(
        `VALID — ${n} record${n === 1 ? "" : "s"}, ` +
        `${result.signers.length} signer${result.signers.length === 1 ? "" : "s"} (${result.signers.join(", ")}), ` +
        `${result.span.from} \u2192 ${result.span.to}\n`,
      );
    } else if (!result.valid && result.firstFailure) {
      const f = result.firstFailure;
      process.stdout.write(`INVALID at record ${f.index}${f.id ? ` (${f.id})` : ""}: ${f.message}\n`);
    }
  }

  process.exit(result.valid ? 0 : 1);
}

main();
