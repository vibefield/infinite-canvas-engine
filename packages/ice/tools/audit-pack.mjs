/**
 * THE PACK AUDIT (design-013 D-B8.1) — what `@vibecook/ice` actually ships once
 * the ground is the compositor.
 *
 * Four questions, asked of the BUILT `dist/` rather than of the source, because
 * the source is not what a consumer installs. Run after `pnpm --filter
 * @vibecook/ice build`:
 *
 *   1. THE PLATES must be ABSENT. `oracle/fixtures/assets/*.rgba` are the
 *      oracle's test pictures. They live outside `src/`, nothing in `src/`
 *      imports them, and `files: ["dist"]` excludes them — but "nothing imports
 *      them" is a claim that decays, so it is measured.
 *   2. THE BLUE NOISE must be PRESENT. The mat pack needs the 128² tile at
 *      runtime and a published consumer has no `assets/` to fetch it from, so
 *      B8 generated it into `src/assets/blue-noise.gen.ts`. If this reads
 *      absent, every downstream cutting mat is undithered.
 *   3. THE WGSL TEXT must be PRESENT. `src/shaders.gen.ts` is how the compose
 *      entry ships its shaders with no bundler loader (D-B1.3).
 *   4. THE COMPOSE ENTRY'S GRAPH must have ZERO edges to `three`. The ground
 *      draws in raw WebGPU; three belongs to the STRATIFIED leg, which the same
 *      package still ships (`@vibecook/ice/ground`) and which Phase C moves. So
 *      the honest claim is not "the package is three-free" — the peer is still
 *      declared, and correctly — it is "the compose entry's graph is".
 *
 * Run: `node packages/ice/tools/audit-pack.mjs`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const dist = resolve(repo, "packages/ice/dist");
const groundSrc = resolve(repo, "packages/ground/src");

const rows = [];
const fail = [];
const say = (ok, label, detail) => {
  rows.push(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) fail.push(label);
};

// --- the built bundle, as one blob of text --------------------------------
let bundleBytes = 0;
const bundle = [];
for (const name of readdirSync(dist)) {
  if (!name.endsWith(".js")) continue; // .map files are not shipped code
  const p = join(dist, name);
  if (!statSync(p).isFile()) continue;
  const text = readFileSync(p, "utf8");
  bundleBytes += Buffer.byteLength(text);
  bundle.push({ name, text });
}
const anyFile = (needle) => bundle.filter((f) => f.text.includes(needle)).map((f) => f.name);

// --- 1. the plates --------------------------------------------------------
const plateNames = ["gobo-b", "gobo-c", "content-test"];
const plateHits = plateNames.flatMap((n) => anyFile(n).map((f) => `${n} in ${f}`));
say(
  plateHits.length === 0,
  "the plates are ABSENT",
  plateHits.length === 0
    ? `none of ${plateNames.join(", ")} appears in ${bundle.length} bundle files (${(bundleBytes / 1024).toFixed(0)} KB)`
    : plateHits.join(", "),
);

// --- 2. the blue noise ----------------------------------------------------
// The generated module's own first base64 chunk — a needle nothing else could
// coincidentally carry.
const noiseSrc = readFileSync(join(groundSrc, "assets/blue-noise.gen.ts"), "utf8");
const needle = /"([A-Za-z0-9+/=]{60,})"/.exec(noiseSrc)?.[1] ?? "";
const noiseIn = needle === "" ? [] : anyFile(needle);
say(
  noiseIn.length > 0,
  "the blue noise SHIPS",
  noiseIn.length > 0
    ? `the 128² rgba8 tile is in ${noiseIn.join(", ")} (base64, decoded by blueNoise())`
    : "no bundle file carries the tile — every downstream cutting mat would be undithered",
);

// --- 3. the WGSL ----------------------------------------------------------
const wgslNeedles = ["@fragment", "var<uniform>"];
const wgslIn = wgslNeedles.map((n) => ({ n, files: anyFile(n) }));
const wgslOk = wgslIn.every((r) => r.files.length > 0);
const wgslBytes = bundle
  .filter((f) => f.text.includes("@fragment"))
  .reduce((sum, f) => sum + Buffer.byteLength(f.text), 0);
say(
  wgslOk,
  "the WGSL text SHIPS",
  wgslOk
    ? `shader source is in ${[...new Set(wgslIn.flatMap((r) => r.files))].join(", ")} (${(wgslBytes / 1024).toFixed(0)} KB of bundle carries it)`
    : `missing: ${wgslIn.filter((r) => r.files.length === 0).map((r) => r.n).join(", ")}`,
);

// --- 4. three in the compose entry's graph --------------------------------
/** Every module reachable from a source entry, following relative specifiers. */
function walk(entry) {
  const seen = new Set();
  const external = new Map(); // specifier -> the file that imported it
  const queue = [resolve(entry)];
  const resolveTs = (from, spec) => {
    const base = resolve(dirname(from), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
        // keep trying the next candidate
      }
    }
    return null;
  };
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+"([^"]+)"/g)) {
      const spec = m[1];
      if (spec === undefined) continue;
      if (spec.startsWith(".")) {
        const next = resolveTs(file, spec);
        if (next !== null) queue.push(next);
        continue;
      }
      if (!external.has(spec)) external.set(spec, file);
    }
  }
  return { modules: seen, external };
}

const compose = walk(join(groundSrc, "compose/index.ts"));
const threeEdges = [...compose.external.entries()].filter(([spec]) => /^three(\/|$)/.test(spec));
say(
  threeEdges.length === 0,
  "the compose entry's graph is THREE-FREE",
  threeEdges.length === 0
    ? `${compose.modules.size} modules reachable from src/compose/index.ts, 0 edges to three (externals: ${[...compose.external.keys()].sort().join(", ")}). The package's \`three\` peer STAYS declared — the stratified leg (@vibecook/ice/ground) still needs it, and Phase C is what moves that`
    : threeEdges.map(([spec, from]) => `${spec} from ${from.slice(repo.length + 1)}`).join(", "),
);

console.log("[pack-audit] @vibecook/ice — design-013 D-B8.1");
for (const r of rows) console.log(`[pack-audit] ${r}`);
console.log(fail.length === 0 ? "[pack-audit] ALL PASS" : `[pack-audit] ${fail.length} FAILED`);
process.exit(fail.length === 0 ? 0 : 1);
