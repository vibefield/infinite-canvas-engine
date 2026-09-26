/**
 * THE PACK AUDIT (design-013 D-B8.1; the desk's since design-015 D5b) — what
 * `@vibecook/ice` actually ships.
 *
 * Four questions, asked of the BUILT `dist/` rather than of the source, because
 * the source is not what a consumer installs. Run after `pnpm --filter
 * @vibecook/ice build`:
 *
 *   1. THE PLATES must be ABSENT. `packages/desk/oracle/fixtures/assets/*.rgba`
 *      are the oracle's test pictures (the study's gobo plates). They live
 *      outside `src/`, nothing in `src/` imports them, and `files: ["dist"]`
 *      excludes them — but "nothing imports them" is a claim that decays, so it
 *      is measured.
 *   2. THE BLUE NOISE must be PRESENT. The mat needs the 128² tile at runtime
 *      and a published consumer has no `assets/` to fetch it from, so it is
 *      generated into `src/assets/blue-noise.gen.ts`. If this reads absent,
 *      every downstream cutting mat is undithered.
 *   3. THE WGSL TEXT must be PRESENT. `src/shaders.gen.ts` is how the desk
 *      entry ships its shaders with no bundler loader (D-B1.3).
 *   4. THE WHOLE GRAPH must have ZERO edges to `three`, `@react-three` or
 *      `stats-gl` (design-015 §3 `no-three`: three is imported nowhere). Until
 *      D5b the walk spared the two GL-island entries the `three` peer existed
 *      for; the islands, the peer and the `stats-gl` dependency left together,
 *      so every published entry is walked and any such edge is a leak.
 *
 *      The walker follows `@ice/*` specifiers as well as relative ones, because
 *      tsup bundles the workspace (`noExternal: [/^@ice\//]`) — an `@ice/*`
 *      edge is an edge in the SHIPPED chunk, where a relative-only walk would
 *      report it as an untraced external.
 *
 * Run: `node packages/ice/tools/audit-pack.mjs`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const dist = resolve(repo, "packages/ice/dist");
const deskSrc = resolve(repo, "packages/desk/src");

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
const plateNames = ["gobo-b", "gobo-c"];
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
const noiseSrc = readFileSync(join(deskSrc, "assets/blue-noise.gen.ts"), "utf8");
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

// --- 4. three in the whole graph ---------------------------------------------
/**
 * Every import/export specifier a module names. THREE patterns, because one
 * regex over ES module syntax misses two whole shapes and the audit's answer is
 * only as good as its graph:
 *
 *  - the `from` form, spanning NEWLINES. The original `[^;\n]*?` could not
 *    cross a line, so every biome-wrapped `export {\n  a,\n  b,\n} from "x"`
 *    was invisible — 187 of the then tree's 1,339 source edges across 80 of its
 *    274 files, the old ground entry among them at 5 of its 11. `[^;"']*?`
 *    crosses lines but not a `;` or a quote, so it cannot run past a statement
 *    into the next one's specifier the way a bare `[\s\S]*?` can.
 *  - the BARE side-effect import (`import "three"`), which has no `from` at all.
 *  - the DYNAMIC `import("…")`, which is how the retired r3f entry reached
 *    stats-gl and is how a lazy three edge would hide from both patterns above.
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

/** Every published entry. */
const iceSrc = resolve(repo, "packages/ice/src");
const entries = readdirSync(iceSrc)
  .filter((n) => n.endsWith(".ts"))
  .sort();
const graph = walk(entries.map((n) => join(iceSrc, n)));
const threeEdges = [...graph.external.entries()].filter(([spec]) => /^(three|@react-three|stats-gl)(\/|$)/.test(spec));
say(
  threeEdges.length === 0,
  "the whole graph is THREE-FREE",
  threeEdges.length === 0
    ? `${graph.modules.size} modules reachable from the ${entries.length} entries (${entries.join(", ")}), 0 edges to three, @react-three or stats-gl (externals: ${[...graph.external.keys()].sort().join(", ")}). No \`three\` peer is declared: nothing in the package needs one (design-015 §3)`
    : threeEdges.map(([spec, from]) => `${spec} from ${from.slice(repo.length + 1)}`).join(", "),
);

console.log("[pack-audit] @vibecook/ice — design-013 D-B8.1 · design-015 §11.5");
for (const r of rows) console.log(`[pack-audit] ${r}`);
console.log(fail.length === 0 ? "[pack-audit] ALL PASS" : `[pack-audit] ${fail.length} FAILED`);
process.exit(fail.length === 0 ? 0 : 1);
