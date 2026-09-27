/**
 * THE PACK AUDIT (design-013 D-B8.1; the desk's since design-015 D5b; widened at D7) — what
 * `@vibecook/ice` actually ships.
 *
 * Every question is asked of the BUILT `dist/` rather than of the source, because the source is not
 * what a consumer installs. Run after `pnpm --filter @vibecook/ice build`:
 *
 *   1. THE PLATES must be ABSENT — by CONTENT, not by name (D7): the oracle's study plates
 *      (`packages/objects/oracle/fixtures/assets/gobo-{b,c}.rgba`, oryzo/Lusion's) and apps/desk's product
 *      plates (`apps/desk/assets/gobo-*.rgba`) are 1 MB each; a plate inlined as base64 carries no file
 *      name, so each is sought as three base64 needles cut from its own bytes (one per alignment).
 *   2. THE BLUE NOISE must be PRESENT (the mat's 128² tile, generated into `src/assets/blue-noise.gen.ts`).
 *   3. THE WGSL TEXT must be PRESENT (`src/shaders.gen.ts` — the desk entry ships its shaders, D-B1.3).
 *   4. THE SHIPPED CHUNKS must have ZERO edges to `three`, `@react-three` or `stats-gl` (design-015 §3
 *      `no-three`) — read off every `dist/*.js` (D7: until then this walked the SOURCE graph, though the
 *      header said dist/), static, bare and dynamic imports alike.
 *   5. THE EXTERNALS the chunks import are DECLARED: each is a dependency or a peer (or a node builtin),
 *      and every dependency is imported by a chunk or named by the d.ts (an undeclared external breaks an
 *      install; an unused dependency is weight).
 *   6. THE EXPORTS MAP's every target — `types` and `default` — exists in dist/.
 *   7. THE D.TS resolves standalone: every relative specifier of every `dist/types/**` file lands on a file,
 *      no quoted `@ice/*` specifier survives (subpaths included — fix-dts-specifiers rewrites them), and every
 *      bare specifier is declared.
 *   8. EACH ENTRY IMPORTS IN NODE (`import(dist/<entry>.js)`): no module-scope DOM or GPU touch — the
 *      headless engine, the oracle and SSR hosts load these.
 *   9. THE DESK'S ENTRIES CARRY NO KIND (design-016 K4b): `/desk`, `/desk/kit` and `/desk/engine` — each entry's chunk closure —
 *      hold none of the six reference kinds' durable type ids nor their WGSL files' keys, read off `packages/objects`; the
 *      `/desk/objects` closure holds every one (no dead needle). The kinds are a package of their own: a desk that shipped one
 *      would be a desk a plugin kind does not stand on equal to.
 *
 * Run: `node packages/ice/tools/audit-pack.mjs` (`pnpm --filter ./packages/ice pack:audit` builds first).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../../..");
const pkgDir = resolve(repo, "packages/ice");
const dist = resolve(pkgDir, "dist");
const deskSrc = resolve(repo, "packages/desk/src");
const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8"));

const rows = [];
const fail = [];
const say = (ok, label, detail) => {
  rows.push(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) fail.push(label);
};

// --- the built bundle, as text ---------------------------------------------
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

/** Every import specifier a module's text names: `from` (spanning newlines), bare `import "x"`, dynamic `import("x")`. */
const SPECIFIER_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s[^;"']*?from\s+["']([^"']+)["']/g,
  /(?:^|\n)\s*import\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];
/** Block comments out, so prose that happens to read `import("…")` is not an edge. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const specifiersOf = (text) => SPECIFIER_PATTERNS.flatMap((re) => [...code(text).matchAll(re)].map((m) => m[1]).filter((s) => s !== undefined));
/** A bare specifier's package: `@scope/name` or `name`. */
const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
const isBuiltin = (spec) => spec.startsWith("node:") || builtinModules.includes(packageOf(spec));

// --- 1. the plates, by content -------------------------------------------------
/** Three base64 needles from a plate's bytes, one per alignment: a 48-byte window where the bytes vary (never a flat run). */
function plateNeedles(bytes) {
  let at = Math.floor(bytes.length / 2);
  for (let o = at; o + 64 < bytes.length; o += 997) {
    if (new Set(bytes.subarray(o, o + 48)).size > 24) {
      at = o;
      break;
    }
  }
  return [0, 1, 2].map((k) => Buffer.from(bytes.subarray(at + k, at + k + 48)).toString("base64").slice(4, -4));
}
const plateFiles = [
  ...["gobo-b.rgba", "gobo-c.rgba"].map((n) => resolve(repo, "packages/objects/oracle/fixtures/assets", n)),
  ...readdirSync(resolve(repo, "apps/desk/assets"))
    .filter((n) => /^gobo-.*\.rgba$/.test(n))
    .map((n) => resolve(repo, "apps/desk/assets", n)),
];
const plateHits = plateFiles.flatMap((file) => {
  const name = file.split("/").pop().replace(/\.rgba$/, "");
  const hits = [...new Set(plateNeedles(new Uint8Array(readFileSync(file))).flatMap((n) => anyFile(n)))];
  return [...hits.map((f) => `${name}'s bytes in ${f}`), ...anyFile(name).map((f) => `${name}'s name in ${f}`)];
});
say(
  plateHits.length === 0,
  "the plates are ABSENT",
  plateHits.length === 0
    ? `none of ${plateFiles.length} plates (${plateFiles.map((f) => f.split("/").pop()).join(", ")}) appears by content or by name in ${bundle.length} bundle files (${(bundleBytes / 1024).toFixed(0)} KB)`
    : plateHits.join(", "),
);

// --- 2. the blue noise ------------------------------------------------------
// The generated module's own first base64 chunk — a needle nothing else could coincidentally carry.
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
const wgslBytes = bundle.filter((f) => f.text.includes("@fragment")).reduce((sum, f) => sum + Buffer.byteLength(f.text), 0);
say(
  wgslOk,
  "the WGSL text SHIPS",
  wgslOk
    ? `shader source is in ${[...new Set(wgslIn.flatMap((r) => r.files))].join(", ")} (${(wgslBytes / 1024).toFixed(0)} KB of bundle carries it)`
    : `missing: ${wgslIn.filter((r) => r.files.length === 0).map((r) => r.n).join(", ")}`,
);

// --- 4. three in the shipped chunks ------------------------------------------
const externals = new Map(); // bare specifier -> the chunk that imports it
for (const f of bundle) for (const spec of specifiersOf(f.text)) if (!spec.startsWith(".") && !externals.has(spec)) externals.set(spec, f.name);
const threeEdges = [...externals.entries()].filter(([spec]) => /^(three|@react-three|stats-gl)(\/|$)/.test(spec));
say(
  threeEdges.length === 0,
  "the shipped chunks are THREE-FREE",
  threeEdges.length === 0
    ? `${bundle.length} chunks, 0 edges to three, @react-three or stats-gl (externals: ${[...externals.keys()].sort().join(", ")}). No \`three\` peer is declared: nothing in the package needs one (design-015 §3)`
    : threeEdges.map(([spec, from]) => `${spec} from ${from}`).join(", "),
);

// --- 7 (read before 5, which needs its bare specifiers). the d.ts ---------------------
const typesRoot = resolve(dist, "types");
function* dtsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* dtsFiles(p);
    else if (p.endsWith(".d.ts")) yield p;
  }
}
const dts = existsSync(typesRoot) ? [...dtsFiles(typesRoot)] : [];
const unresolved = [];
const privateScope = [];
const dtsBare = new Map();
for (const file of dts) {
  for (const spec of specifiersOf(readFileSync(file, "utf8"))) {
    if (spec.startsWith(".")) {
      const base = resolve(dirname(file), spec);
      const hit = [`${base}.d.ts`, base, join(base, "index.d.ts"), base.replace(/\.js$/, ".d.ts")].some((c) => existsSync(c) && statSync(c).isFile());
      if (!hit) unresolved.push(`${relative(dist, file)} → ${spec}`);
    } else if (spec.startsWith("@ice/")) privateScope.push(`${relative(dist, file)} → ${spec}`);
    else if (!dtsBare.has(spec)) dtsBare.set(spec, relative(dist, file));
  }
}
const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
const undeclaredInDts = [...dtsBare.keys()].filter((s) => !isBuiltin(s) && !declared.has(packageOf(s)));
const dtsProblems = [
  ...unresolved.slice(0, 4).map((u) => `unresolved ${u}`),
  ...privateScope.slice(0, 4).map((u) => `private ${u}`),
  ...undeclaredInDts.map((s) => `undeclared ${s} (${dtsBare.get(s)})`),
];
say(
  dts.length > 0 && dtsProblems.length === 0,
  "the d.ts RESOLVES standalone",
  dts.length === 0
    ? "no dist/types — the build's tsc step did not run"
    : dtsProblems.length === 0
      ? `${dts.length} files: every relative specifier lands on a file, no @ice/* specifier survives, the bare ones (${[...new Set([...dtsBare.keys()].map(packageOf))].sort().join(", ")}) are declared`
      : dtsProblems.join(" · "),
);

// --- 5. externals vs the declared dependencies -------------------------------------------
const undeclared = [...externals.keys()].filter((s) => !isBuiltin(s) && !declared.has(packageOf(s)));
const used = new Set([...externals.keys(), ...dtsBare.keys()].map(packageOf));
// `@webgpu/types` is ambient: the d.ts name GPUDevice & co. through the globals it declares, so no specifier names it
const unused = Object.keys(pkg.dependencies ?? {}).filter((d) => !used.has(d) && d !== "@webgpu/types");
say(
  undeclared.length === 0 && unused.length === 0,
  "the externals are the DECLARED dependencies",
  undeclared.length === 0 && unused.length === 0
    ? `every external a chunk imports is a dependency or a peer (${[...new Set([...externals.keys()].map(packageOf))].sort().join(", ")}), and every dependency is imported or ambient (@webgpu/types)`
    : [...undeclared.map((s) => `undeclared ${s} (imported by ${externals.get(s)})`), ...unused.map((d) => `unused dependency ${d}`)].join(" · "),
);

// --- 6. the exports map's targets ------------------------------------------------------
const targets = Object.entries(pkg.exports ?? {}).flatMap(([sub, t]) => (typeof t === "string" ? [[sub, t]] : Object.values(t).map((v) => [sub, v])));
const missingTargets = targets.filter(([, t]) => !existsSync(resolve(pkgDir, t))).map(([sub, t]) => `${sub} → ${t}`);
say(
  missingTargets.length === 0,
  "the exports map's targets EXIST",
  missingTargets.length === 0 ? `${targets.length} targets across ${Object.keys(pkg.exports ?? {}).length} subpaths` : missingTargets.join(", "),
);

// --- 8. a Node import of each entry ---------------------------------------------------
const entries = Object.entries(pkg.exports ?? {}).flatMap(([sub, t]) =>
  typeof t === "object" && typeof t.default === "string" && t.default.endsWith(".js") ? [[sub, t.default]] : [],
);
const refused = [];
for (const [sub, file] of entries) {
  try {
    await import(pathToFileURL(resolve(pkgDir, file)).href);
  } catch (e) {
    refused.push(`${sub}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
}
say(
  refused.length === 0,
  "every entry IMPORTS in Node",
  refused.length === 0 ? `${entries.length} entries (${entries.map(([s]) => s).join(" ")}) load with no DOM and no GPU` : refused.join(" · "),
);

// --- 9. the desk's entries carry no kind (design-016 §5, K4b) --------------------------------------
// `@vibecook/ice/desk`, `/desk/kit` and `/desk/engine` are the engine, the contract and the kit — never a reference kind: the
// closure of each entry's imports (its chunks, static and dynamic) must hold none of the six kinds' durable type ids nor their
// WGSL. The needles are read off the kinds' own package (`objects/src/<kind>/object.ts`'s `*_TYPE`, `objects/shaders/<kind>/`'s
// file keys — the generated module's), and `/desk/objects`' closure must hold every one of them, so none is a dead needle.
const objectsDir = resolve(repo, "packages/objects");
const needles = new Set();
for (const kind of readdirSync(resolve(objectsDir, "shaders"))) {
  const dir = resolve(objectsDir, "shaders", kind);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) if (f.endsWith(".wgsl")) needles.add(`"${kind}/${f}"`);
  const object = resolve(objectsDir, "src", kind, "object.ts");
  if (existsSync(object)) for (const m of readFileSync(object, "utf8").matchAll(/_TYPE = "([^"]+)"/g)) needles.add(`"${m[1]}"`);
}
const kindNeedles = [...needles];   // a type id two objects name (the mini mat accepts the note by its type) is one needle
/** An entry's chunks: the file its exports map names, and every relative import (static or dynamic) reached from it. */
const closureOf = (entry) => {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const f = bundle.find((b) => b.name === name);
    if (f !== undefined) for (const spec of specifiersOf(f.text)) if (spec.startsWith("./")) queue.push(spec.slice(2));
  }
  return [...seen].map((name) => bundle.find((b) => b.name === name)).filter((f) => f !== undefined);
};
const entryFile = (sub) => { const t = pkg.exports?.[sub]; const d = typeof t === "string" ? t : t?.default; return d?.replace(/^\.\/dist\//, ""); };
const deskHits = ["./desk", "./desk/kit", "./desk/engine"].flatMap((sub) =>
  closureOf(entryFile(sub)).flatMap((f) => kindNeedles.filter((n) => f.text.includes(n)).map((n) => `${sub} → ${f.name} carries ${n}`)));
const objectsText = closureOf(entryFile("./desk/objects")).map((f) => f.text).join("\n");
const deadNeedles = kindNeedles.filter((n) => !objectsText.includes(n));
say(
  deskHits.length === 0 && deadNeedles.length === 0 && kindNeedles.length > 0,
  "the desk's entries carry NO KIND",
  deskHits.length === 0 && deadNeedles.length === 0
    ? `${kindNeedles.length} needles (the six kinds' type ids and WGSL files) in none of ./desk ./desk/kit ./desk/engine's chunks, every one in ./desk/objects'`
    : [...deskHits.slice(0, 6), ...deadNeedles.map((n) => `dead needle ${n} (not in ./desk/objects)`)].join(" · "),
);

console.log("[pack-audit] @vibecook/ice — design-013 D-B8.1 · design-015 §11.5 · D7 · design-016 K4b");
for (const r of rows) console.log(`[pack-audit] ${r}`);
console.log(fail.length === 0 ? "[pack-audit] ALL PASS" : `[pack-audit] ${fail.length} FAILED`);
process.exit(fail.length === 0 ? 0 : 1);
