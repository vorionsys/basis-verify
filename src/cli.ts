#!/usr/bin/env node
/**
 * @vorionsys/verify — src/cli.ts
 * Usage: npx @vorionsys/verify <chain.json> [--keys <keys.json>] [--format basis|aurais|auto]
 *                              [--json] [--strict] [--quiet]
 * Formats: BASIS decision-record chains (needs --keys) and Aurais proof chains
 * (keys are embedded per event). Default --format auto detects by shape.
 * Exit codes: 0 valid · 1 invalid · 2 usage/parse error. No network. Ever.
 */
import { readFileSync } from "node:fs";
import { verifyChain, type VerifyResult } from "./verify.js";
import { detectFormat, verifyAuraisChain } from "./formats/aurais.js";

function usage(): never {
  process.stderr.write(
    "usage: npx @vorionsys/verify <chain.json> [--keys <keys.json>] [--format basis|aurais|auto] [--json] [--strict] [--quiet]\n",
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  let chainPath: string | null = null;
  let keysPath: string | null = null;
  let format: "basis" | "aurais" | "auto" = "auto";
  let json = false, strict = false, quiet = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--keys") { keysPath = args[++i] ?? null; }
    else if (a === "--format") {
      const v = args[++i];
      if (v !== "basis" && v !== "aurais" && v !== "auto") usage();
      format = v;
    }
    else if (a === "--json") json = true;
    else if (a === "--strict") strict = true;
    else if (a === "--quiet") quiet = true;
    else if (a === "--help" || a === "-h") usage();
    else if (a.startsWith("--")) usage();
    else if (!chainPath) chainPath = a;
    else usage();
  }
  if (!chainPath) usage();

  let chain: unknown;
  try {
    chain = JSON.parse(readFileSync(chainPath, "utf8"));
  } catch (e) {
    process.stderr.write(`error reading input: ${(e as Error).message}\n`);
    process.exit(2);
  }

  const resolved = format === "auto" ? (detectFormat(chain) ?? "basis") : format;

  let result: VerifyResult;
  if (resolved === "aurais") {
    result = verifyAuraisChain(chain);
  } else {
    if (!keysPath) {
      process.stderr.write("BASIS chains need --keys <keys.json> (Aurais chains embed their keys)\n");
      process.exit(2);
    }
    let keys: unknown;
    try {
      keys = JSON.parse(readFileSync(keysPath, "utf8"));
    } catch (e) {
      process.stderr.write(`error reading keys: ${(e as Error).message}\n`);
      process.exit(2);
    }
    result = verifyChain(chain, keys, { strict });
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else if (!quiet) {
    for (const rc of result.records) {
      if (rc.ok) process.stdout.write(`✓ record ${rc.index}${rc.id ? ` (${rc.id})` : ""}\n`);
      else process.stdout.write(`✗ record ${rc.index}${rc.id ? ` (${rc.id})` : ""} — ${rc.check}: ${rc.message}\n`);
    }
    for (const note of result.notes ?? []) process.stdout.write(`ℹ ${note}\n`);
    if (result.valid && result.span) {
      const n = result.records.length;
      process.stdout.write(
        `VALID [${resolved}] — ${n} record${n === 1 ? "" : "s"}, ` +
        `${result.signers.length} signer${result.signers.length === 1 ? "" : "s"} (${result.signers.join(", ")}), ` +
        `${result.span.from} → ${result.span.to}\n`,
      );
    } else if (!result.valid && result.firstFailure) {
      const f = result.firstFailure;
      process.stdout.write(`INVALID at record ${f.index}${f.id ? ` (${f.id})` : ""}: ${f.message}\n`);
    }
  }

  process.exit(result.valid ? 0 : 1);
}

main();
