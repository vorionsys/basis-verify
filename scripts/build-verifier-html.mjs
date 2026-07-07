/**
 * Builds verifier.html — the single-file, offline, file://-capable BASIS
 * proof-chain verifier (SPEC-basis-verify §6).
 *
 * The verify core is bundled from src/ (same source as the CLI); demo fixtures
 * are embedded so the page demos with zero files on hand. Output is
 * deterministic given identical src/ + fixtures/ — checked in and diffed in CI.
 *
 * Run: node scripts/build-verifier-html.mjs   (after `npm run build` + fixtures)
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const bundle = await build({
  entryPoints: ["src/browser-entry.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
  minify: true,
  write: false,
});
const js = bundle.outputFiles[0].text;

// JSON embedded in <script> — escape "</" so no fixture byte can close the tag.
const embed = (path) => JSON.stringify(JSON.parse(readFileSync(path, "utf8"))).replace(/<\//g, "<\\/");
const FIXTURES = `{
  "keys": ${embed("fixtures/keys.json")},
  "valid": ${embed("fixtures/valid.chain.json")},
  "tampered": ${embed("fixtures/tampered-amount.chain.json")}
}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BASIS proof-chain verifier — offline</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;
    --muted: #8b949e; --ok: #3fb950; --bad: #f85149; --accent: #58a6ff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f6f8fa; --panel: #ffffff; --border: #d0d7de; --text: #1f2328; --muted: #656d76; --ok: #1a7f37; --bad: #cf222e; --accent: #0969da; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; padding: 2rem 1rem; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin-bottom: .25rem; }
  .sub { color: var(--muted); margin-bottom: 1.5rem; }
  .sub code { font-size: .85em; }
  .drops { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
  @media (max-width: 640px) { .drops { grid-template-columns: 1fr; } }
  .drop { background: var(--panel); border: 2px dashed var(--border); border-radius: 8px; padding: 1.25rem; text-align: center; cursor: pointer; transition: border-color .15s; }
  .drop.armed { border-color: var(--ok); border-style: solid; }
  .drop.over { border-color: var(--accent); }
  .drop h2 { font-size: .95rem; margin-bottom: .25rem; }
  .drop p { color: var(--muted); font-size: .85rem; }
  .drop .file { color: var(--ok); font-size: .85rem; word-break: break-all; }
  .row { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.5rem; }
  button { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: .5rem 1rem; font: inherit; cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  label.strict { color: var(--muted); font-size: .9rem; display: flex; gap: .35rem; align-items: center; cursor: pointer; }
  #result { display: none; }
  .verdict { border-radius: 8px; padding: .9rem 1.1rem; font-weight: 700; font-size: 1.05rem; margin-bottom: 1rem; }
  .verdict.ok { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); border: 1px solid var(--ok); }
  .verdict.bad { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); border: 1px solid var(--bad); }
  .verdict small { display: block; font-weight: 400; font-size: .85rem; margin-top: .2rem; }
  ul.records { list-style: none; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  ul.records li { padding: .55rem .9rem; border-bottom: 1px solid var(--border); font-family: ui-monospace, monospace; font-size: .84rem; display: flex; gap: .6rem; }
  ul.records li:last-child { border-bottom: none; }
  ul.records li .mark { font-weight: 700; }
  ul.records li.ok .mark { color: var(--ok); }
  ul.records li.bad { background: color-mix(in srgb, var(--bad) 8%, transparent); }
  ul.records li.bad .mark { color: var(--bad); }
  footer { margin-top: 2rem; color: var(--muted); font-size: .82rem; }
  footer code { font-size: .95em; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>BASIS proof-chain verifier</h1>
  <p class="sub">Verifies a signed, hash-linked chain of BASIS decision records — entirely in this page.
  No network requests are made, ever; it works from <code>file://</code> on an air-gapped machine.
  Same core as <code>npx @vorionsys/verify</code>.</p>

  <div class="drops">
    <div class="drop" id="dropChain" tabindex="0" role="button" aria-label="Load chain file">
      <h2>chain.json</h2>
      <p>Drop the chain file here, or click to browse</p>
      <p class="file" id="chainName"></p>
    </div>
    <div class="drop" id="dropKeys" tabindex="0" role="button" aria-label="Load keys file">
      <h2>keys.json</h2>
      <p>Drop the public-keys file here, or click to browse</p>
      <p class="file" id="keysName"></p>
    </div>
  </div>

  <div class="row">
    <button class="primary" id="btnVerify" disabled>Verify</button>
    <label class="strict"><input type="checkbox" id="chkStrict"> strict (duplicate ids, dangling linksTo)</label>
    <span style="flex:1"></span>
    <button id="btnDemoValid">Load demo fixtures</button>
    <button id="btnDemoTampered">Load tampered fixtures</button>
  </div>

  <section id="result" aria-live="polite">
    <div class="verdict" id="verdict"></div>
    <ul class="records" id="records"></ul>
  </section>

  <footer>
    Record schema: <code>@vorionsys/contracts</code> · Standard:
    <a href="https://github.com/vorionsys/basis-spec">basis-spec</a> ·
    <a href="https://vorion.org">vorion.org</a><br>
    Checks, in order: schema → signature (Ed25519 over RFC 8785 canonical form) →
    hash link (<code>prev</code>) → timestamp monotonicity. Fail-fast at the exact record.
  </footer>
</main>

<script>__BUNDLE__</script>
<script>
const FIXTURES = __FIXTURES__;
</script>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  let chain = null, keys = null;

  const arm = (which, name, data) => {
    if (which === "chain") { chain = data; $("chainName").textContent = name; $("dropChain").classList.add("armed"); }
    else { keys = data; $("keysName").textContent = name; $("dropKeys").classList.add("armed"); }
    $("btnVerify").disabled = !(chain && keys);
  };

  const readInto = (which) => (file) => {
    const r = new FileReader();
    r.onload = () => {
      try { arm(which, file.name, JSON.parse(r.result)); }
      catch (e) { alert(file.name + " is not valid JSON: " + e.message); }
    };
    r.readAsText(file);
  };

  const wireDrop = (el, which) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json"; input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => input.files[0] && readInto(which)(input.files[0]));
    el.addEventListener("click", () => input.click());
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") input.click(); });
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault(); el.classList.remove("over");
      const f = e.dataTransfer.files[0];
      if (f) readInto(which)(f);
    });
  };
  wireDrop($("dropChain"), "chain");
  wireDrop($("dropKeys"), "keys");

  $("btnDemoValid").addEventListener("click", () => {
    arm("chain", "valid.chain.json (bundled demo)", FIXTURES.valid);
    arm("keys", "keys.json (bundled demo)", FIXTURES.keys);
    run();
  });
  $("btnDemoTampered").addEventListener("click", () => {
    arm("chain", "tampered-amount.chain.json (bundled demo)", FIXTURES.tampered);
    arm("keys", "keys.json (bundled demo)", FIXTURES.keys);
    run();
  });
  $("btnVerify").addEventListener("click", run);

  function run() {
    if (!chain || !keys) return;
    const res = BasisVerify.verifyChain(chain, keys, { strict: $("chkStrict").checked });
    $("result").style.display = "block";
    const v = $("verdict");
    if (res.valid) {
      const n = res.records.length;
      v.className = "verdict ok";
      v.innerHTML = "VALID<small>" + n + " record" + (n === 1 ? "" : "s") + " · " +
        res.signers.length + " signer (" + res.signers.map(esc).join(", ") + ") · " +
        esc(res.span.from) + " → " + esc(res.span.to) + "</small>";
    } else {
      const f = res.firstFailure;
      v.className = "verdict bad";
      v.innerHTML = "INVALID at record " + f.index + (f.id ? " (" + esc(f.id) + ")" : "") +
        "<small>" + esc(f.check) + ": " + esc(f.message) + "</small>";
    }
    const ul = $("records");
    ul.innerHTML = "";
    for (const rc of res.records) {
      const li = document.createElement("li");
      li.className = rc.ok ? "ok" : "bad";
      li.innerHTML = '<span class="mark">' + (rc.ok ? "\\u2713" : "\\u2717") + "</span><span>record " +
        rc.index + (rc.id ? " (" + esc(rc.id) + ")" : "") +
        (rc.ok ? "" : " — " + esc(rc.check) + ": " + esc(rc.message)) + "</span>";
      ul.appendChild(li);
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
})();
</script>
</body>
</html>
`;

const out = html.replace("__BUNDLE__", () => js).replace("__FIXTURES__", () => FIXTURES);
writeFileSync("verifier.html", out);
console.log(`verifier.html written (${(out.length / 1024).toFixed(1)} KB) — bundle ${(js.length / 1024).toFixed(1)} KB`);
