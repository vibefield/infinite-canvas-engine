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
 *   4. THE WHOLE NON-r3f GRAPH must have ZERO edges to `three` (widened from
 *      "the compose entry's graph" at design-013 C3, 2026-09-07). Both grounds
 *      draw in raw WebGPU now: C2 put the stratified leg on the same engine and
 *      deleted three's renderer, and C3 struck `three` from `@ice/ground`'s peer
 *      and dev deps entirely. The package's `three` peer STAYS declared — the
 *      honest claim is still not "the package is three-free" — but its reason is
 *      now exactly ONE thing, the GL ISLANDS (`./r3f`, `./r3f/webgpu`). So the
 *      walk covers every published entry but those two, and any three edge it
 *      finds is a leak of the islands' peer into a graph that must not need it.
 *
 *      The walker follows `@ice/*` specifiers as well as relative ones, because
 *      tsup bundles the workspace (`noExternal: [/^@ice\//]`) — an `@ice/r3f`
 *      edge from a non-r3f entry would put three in the SHIPPED chunk while a
 *      relative-only walk reported it as an untraced external.
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

// --- 4. three in the whole non-r3f graph -----------------------------------
/**
 * Every import/export specifier a module names. THREE patterns, because one
 * regex over ES module syntax misses two whole shapes and the audit's answer is
 * only as good as its graph:
 *
 *  - the `from` form, spanning NEWLINES. The original `[^;\n]*?` could not
 *    cross a line, so every biome-wrapped `export {\n  a,\n  b,\n} from "x"`
 *    was invisible — 187 of the tree's 1,339 source edges across 80 of its 274
 *    files, `packages/ground/src/index.ts` (the `@vibecook/ice/ground` ENTRY)
 *    among them at 5 of its 11. `[^;"']*?` crosses lines but not a `;` or a
 *    quote, so it cannot run past a statement into the next one's specifier
 *    the way a bare `[\s\S]*?` can.
 *  - the BARE side-effect import (`import "three"`), which has no `from` at all.
 *  - the DYNAMIC `import("…")`, which is how the r3f entry reaches stats-gl and
 *    is how a lazy three edge would hide from both patterns above.
 */
const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s[^;"']*?from\s+["']([^"']+)["']/g,
  /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every module reachable from a source entry, following relative + `@ice/*`. */
function walk(entries) {
  const seen = new Set();
  const external = new Map(); // specifier -> the file that imported it
  const queue = entries.map((e) => resolve(e));
  const candidates = (base) => [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  const firstFile = (paths) => {
    for (const c of paths) {
      try {
        if (statSync(c).isFile()) return c;
      } catch {
        // keep trying the next candidate
      }
    }
    return null;
  };
  const resolveSpec = (from, spec) => {
    if (spec.startsWith(".")) return firstFile(candidates(resolve(dirname(from), spec)));
    // tsup bundles the workspace, so an `@ice/*` edge is an edge in the SHIPPED
    // chunk — follow it rather than parking it as an untraced external.
    const ice = /^@ice\/([^/]+)(?:\/(.+))?$/.exec(spec);
    if (ice === null) return null;
    const base = resolve(repo, "packages", ice[1], "src", ice[2] ?? "");
    return firstFile(candidates(base));
  };
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const re of SPECIFIER_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const spec = m[1];
        if (spec === undefined) continue;
        const next = resolveSpec(file, spec);
        if (next !== null) {
          queue.push(next);
          continue;
        }
        if (!external.has(spec)) external.set(spec, file);
      }
    }
  }
  return { modules: seen, external };
}

/** The published entries, minus the two the `three` peer exists FOR. */
const iceSrc = resolve(repo, "packages/ice/src");
const ISLAND_ENTRIES = new Set(["r3f.ts", "r3f-webgpu.ts"]);
const nonR3fEntries = readdirSync(iceSrc)
  .filter((n) => n.endsWith(".ts") && !ISLAND_ENTRIES.has(n))
  .sort();
const graph = walk(nonR3fEntries.map((n) => join(iceSrc, n)));
const threeEdges = [...graph.external.entries()].filter(([spec]) => /^three(\/|$)/.test(spec));
say(
  threeEdges.length === 0,
  "the non-r3f graph is THREE-FREE",
  threeEdges.length === 0
    ? `${graph.modules.size} modules reachable from the ${nonR3fEntries.length} non-island entries (${nonR3fEntries.join(", ")}), 0 edges to three (externals: ${[...graph.external.keys()].sort().join(", ")}). The package's \`three\` peer STAYS declared, optional, at >=0.185.0 — for the ISLANDS alone (./r3f, ./r3f/webgpu) since design-013 C3 struck it from @ice/ground`
    : threeEdges.map(([spec, from]) => `${spec} from ${from.slice(repo.length + 1)}`).join(", "),
);

console.log("[pack-audit] @vibecook/ice — design-013 D-B8.1");
for (const r of rows) console.log(`[pack-audit] ${r}`);
console.log(fail.length === 0 ? "[pack-audit] ALL PASS" : `[pack-audit] ${fail.length} FAILED`);
process.exit(fail.length === 0 ? 0 : 1);
