/**
 * Generates Aurais-format fixtures with the REAL emitter (@vorionsys/aurais-core
 * ProofChain — the same code the aurais-mcp-* bots use), so the adapter is tested
 * against genuine chains, not our own imitation of them.
 *
 * Run: node scripts/make-aurais-fixtures.mjs   (writes fixtures/aurais-*.json)
 */
import { writeFileSync } from "node:fs";
import { ProofChain } from "@vorionsys/aurais-core";

const chain = new ProofChain();
chain.append("session_started", { bot: "fixture", n: 1 });
chain.append("commentary_generated", { provider: "anthropic", ok: true });
chain.append("briefing_assembled", { count: 3 });
chain.append("session_closed", { clean: true });
const valid = chain.toJSON();

// tamper: flip a payload value without re-signing → signature fails at event 1
const tampered = JSON.parse(JSON.stringify(valid));
tampered[1].payload.ok = false;

const write = (name, data) => writeFileSync(`fixtures/${name}`, JSON.stringify(data, null, 2) + "\n");
write("aurais-valid.chain.json", valid);
write("aurais-tampered.chain.json", tampered);
console.log("wrote fixtures/aurais-valid.chain.json (+ tampered) — expected: VALID / INVALID @1 signature");
