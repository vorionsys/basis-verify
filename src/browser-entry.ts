/**
 * Browser entry for the static verifier.html build.
 * Bundled by scripts/build-verifier-html.mjs (esbuild, IIFE) from the SAME
 * source as the CLI — generated output is checked in and diffed in CI so the
 * two can never drift.
 */
import { verifyChain, hashRecord } from "./verify.js";
import { canonicalize, canonicalBytes } from "./canonicalize.js";

declare global {
  // eslint-disable-next-line no-var
  var BasisVerify: {
    verifyChain: typeof verifyChain;
    hashRecord: typeof hashRecord;
    canonicalize: typeof canonicalize;
    canonicalBytes: typeof canonicalBytes;
  };
}

globalThis.BasisVerify = { verifyChain, hashRecord, canonicalize, canonicalBytes };
