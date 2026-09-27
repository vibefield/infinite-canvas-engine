/**
 * THE M10 exit test, on the desk (design-015 §11.6 — moodboard's `exit-imports`, ported BY NAME at D5a before the
 * moodboard retires): "a third-party-shaped sample app builds against the published surface only (no deep
 * imports)". It holds every import specifier under `apps/desk/src` two ways:
 *   1. NONE matches the forbidden shapes — a deep import into an engine package's `src/` or `dist/`, a raw strata
 *      or loro import (the engine's own dependencies), or a relative climb out of the app into `packages/`.
 *   2. By PAGE (design-015 D7, D-D7-C.3). THE PRODUCT — every module `index.html`'s `main.tsx` reaches through
 *      static imports (type-only ones too) — imports THE SURFACE only, and THE SURFACE is held to the UMBRELLA's
 *      exports map (`packages/ice/package.json`: `@ice/desk` IS `@vibecook/ice/desk` …), so an entry the published
 *      package does not ship cannot pass (until D7 it read the workspace package's map, which admits `./oracle/*`,
 *      and the app's palette came from the oracle's fixture — why the published quickstart could not run). THE RIGS'
 *      pages — `rig.html`'s harness (src/rig/) and `parity.html`'s page — may add the oracle's door,
 *      `@ice/desk/oracle/*`, which the WORKSPACE desk package publishes and the umbrella does not. Every module under
 *      src/ is reached by one of the three pages, and the product reaches nothing of the rigs'.
 * THE SURFACE is exactly what the product imports, no more (an allowance nothing uses fails too). A vite query
 * (`?url`) is not part of the module path.
 *
 * Test files live under `test/`, not `src/`, so this file (which necessarily NAMES the forbidden strings) is not
 * scanned by itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** THE SURFACE — the engine entries the PRODUCT imports, in their workspace spelling; each must be an entry the UMBRELLA publishes. */
const SURFACE = ["@ice/core", "@ice/react", "@ice/desk", "@ice/objects", "@ice/desk/kit", "@ice/devtools"] as const;   // devtools since design-016 K2: the dock on ⇧`; `@ice/objects` (published `./desk/objects`) since K4b — the kinds' own package
/** The rigs' extra door: the oracle's scenes, frames and fixtures (published by the WORKSPACE desk package, not the umbrella). */
const RIG_DOOR = "@ice/desk/oracle/*";
/** The three pages and the module each one loads (their `<script type="module" src>`); the product is `index`. */
const PAGES = { index: ["src/main.tsx"], rig: ["src/rig/harness.ts", "src/main.tsx"], parity: ["src/parity.ts"] } as const;

/** The forbidden shapes, applied per specifier: a deep `src|dist` path, the engine's raw deps, a climb into `packages/`. */
const FORBIDDEN = /^@[^/]+\/[^/]+\/(src|dist)(\/|$)|^@vibecook\/strata-ecs|^loro-crdt|(^|\/)\.\.\/(\.\.\/)*packages\//;

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(APP, "src");
const PACKAGES = join(APP, "../../packages");
if (!existsSync(SRC) || !existsSync(PACKAGES)) throw new Error(`desk exit test: could not locate ${SRC} and ${PACKAGES}`);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mts|mjs)$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** Every import/export/dynamic-import specifier in a source file, its vite query dropped. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticRe = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(staticRe)) specs.push(m[1] as string);
  for (const m of source.matchAll(dynamicRe)) specs.push(m[1] as string);
  return specs.map((s) => s.replace(/\?.*$/, ""));
}

/** The workspace's packages by name → their `exports` map (the published entries). */
const WORKSPACE = new Map<string, Record<string, unknown>>();
for (const dir of readdirSync(PACKAGES)) {
  const pj = join(PACKAGES, dir, "package.json");
  if (!existsSync(pj)) continue;
  const p = JSON.parse(readFileSync(pj, "utf8")) as { name: string; exports?: Record<string, unknown> };
  WORKSPACE.set(p.name, p.exports ?? {});
}

/** The workspace package a specifier names (`@scope/name`), or undefined for anything else (react, a relative path). */
function packageOf(spec: string): string | undefined {
  const m = /^(@[^/]+\/[^/]+)/.exec(spec);
  return m !== null && WORKSPACE.has(m[1] as string) ? m[1] : undefined;
}

/** The umbrella's exports map — what `@vibecook/ice` publishes. */
const UMBRELLA = (JSON.parse(readFileSync(join(PACKAGES, "ice/package.json"), "utf8")) as { exports: Record<string, unknown> }).exports;

/**
 * The umbrella's entries in their WORKSPACE spelling → the subpath it publishes them at: each exports-map entry's
 * `dist/<name>.js` is built from `packages/ice/src/<name>.ts`, which re-exports ONE workspace barrel
 * (`export * from "../../objects/src/index"` is `@ice/objects`, published as `./desk/objects` — the kinds' own package since K4b).
 */
const PUBLISHED = new Map<string, string>();
for (const [sub, target] of Object.entries(UMBRELLA)) {
  const dist = typeof target === "string" ? target : (target as { default?: string }).default;
  const m = dist === undefined ? null : /^\.\/dist\/(.+)\.js$/.exec(dist);
  if (m === null) continue; // ./package.json
  const barrel = /export \* from "\.\.\/\.\.\/([^/]+)\/src\/(?:(.+)\/)?index"/.exec(readFileSync(join(PACKAGES, "ice/src", `${m[1]}.ts`), "utf8"));
  if (barrel !== null) PUBLISHED.set(`@ice/${barrel[1]}${barrel[2] === undefined ? "" : `/${barrel[2]}`}`, sub);
}

/** Does an allowance cover a specifier: an exact entry, or a wildcard's directory. */
const covers = (entry: string, spec: string): boolean => (entry.endsWith("/*") ? spec.startsWith(entry.slice(0, -1)) && spec.length > entry.length - 1 : spec === entry);

/** Every STATIC import/export specifier (type-only included) and every dynamic one, their vite query dropped — the module graph's edges. */
function edgesOf(source: string): { statics: string[]; dynamics: string[] } {
  const statics = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => (m[1] as string).replace(/\?.*$/, ""));
  const dynamics = [...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => (m[1] as string).replace(/\?.*$/, ""));
  return { statics, dynamics };
}

/** A relative specifier's module file under src/, or undefined (an asset, a package). */
function fileOf(from: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = join(dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find((c) => existsSync(c) && /\.(tsx?|mts|mjs)$/.test(c));
}

/** The modules a page reaches from its entries — static AND dynamic edges (a lazy chunk is still the page's). */
function closure(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map((e) => join(APP, e));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !existsSync(file)) continue;   // a missing entry is the pages row's to report
    seen.add(file);
    const { statics, dynamics } = edgesOf(readFileSync(file, "utf8"));
    for (const spec of [...statics, ...dynamics]) { const next = fileOf(file, spec); if (next !== undefined) queue.push(next); }
  }
  return seen;
}

describe("M10 exit criterion — apps/desk is surface-only", () => {
  const files = walk(SRC);
  const rel = (f: string): string => f.slice(APP.length + 1);
  const specsOf = (f: string): string[] => { const { statics, dynamics } = edgesOf(readFileSync(f, "utf8")); return [...statics, ...dynamics]; };
  const pages = { index: closure(PAGES.index), rig: closure(PAGES.rig), parity: closure(PAGES.parity) };
  const product = [...pages.index];
  const engineSpecs = (list: readonly string[]): { spec: string; file: string }[] =>
    list.flatMap((f) => specsOf(f).filter((s) => packageOf(s) !== undefined).map((spec) => ({ spec, file: rel(f) })));

  it("finds source files, the three pages' modules and the product's engine imports", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(product.length).toBeGreaterThan(1);
    expect(engineSpecs(product).length).toBeGreaterThan(0); // the app really does consume the engine
  });

  it("the pages load what PAGES says — and the product page loads nothing of the rigs'", () => {
    for (const [page, entries] of Object.entries(PAGES)) {
      const html = readFileSync(join(APP, `${page}.html`), "utf8");
      const scripts = [...html.matchAll(/<script[^>]*\bsrc="\/?([^"]+)"/g)].map((m) => m[1]);
      expect(scripts, `${page}.html's module scripts`).toEqual([...entries]);
      for (const e of entries) expect(existsSync(join(APP, e)), `${page}.html's ${e}`).toBe(true);
    }
  });

  it("no import specifier matches the forbidden (deep-import / raw-dep / climb) shapes", () => {
    const offenders = files.flatMap((f) => specsOf(f).filter((s) => FORBIDDEN.test(s)).map((s) => `${s}  (in ${rel(f)})`));
    expect(offenders, `forbidden specifiers found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("THE PRODUCT imports THE SURFACE only — no oracle, no entry the umbrella does not publish", () => {
    const bad = engineSpecs(product).filter(({ spec }) => !(SURFACE as readonly string[]).includes(spec)).map(({ spec, file }) => `${spec}  (in ${file})`);
    expect(bad, `product imports outside THE SURFACE:\n${bad.join("\n")}`).toEqual([]);
  });

  it("the rigs' pages import what the umbrella publishes and the oracle's door only", () => {
    const rigs = [...new Set([...pages.rig, ...pages.parity])].filter((f) => !pages.index.has(f));
    expect(rigs.length).toBeGreaterThan(0);
    const bad = engineSpecs(rigs).filter(({ spec }) => !PUBLISHED.has(spec) && !covers(RIG_DOOR, spec)).map(({ spec, file }) => `${spec}  (in ${file})`);
    expect(bad, `rig imports outside the umbrella's entries and the oracle's door:\n${bad.join("\n")}`).toEqual([]);
  });

  it("every module under src/ belongs to a page, and the product reaches no module under src/rig/ nor the parity page", () => {
    const reached = new Set([...pages.index, ...pages.rig, ...pages.parity]);
    expect(files.filter((f) => !reached.has(f)).map(rel), "orphans (reached by no page)").toEqual([]);
    expect(product.map(rel).filter((f) => f.startsWith("src/rig/") || f === "src/parity.ts"), "rig modules in the product").toEqual([]);
  });

  it("THE SURFACE is exactly what the product imports — no allowance nothing uses", () => {
    const used = new Set(engineSpecs(product).map(({ spec }) => spec));
    const unused = SURFACE.filter((e) => !used.has(e));
    expect(unused, `allowances nothing imports (drop them from THE SURFACE):\n${unused.join("\n")}`).toEqual([]);
  });

  it("every entry of THE SURFACE is one the UMBRELLA publishes (packages/ice/package.json's exports map), in its workspace spelling", () => {
    expect(PUBLISHED.size, "the umbrella's entries, each read back to its workspace barrel").toBe(Object.keys(UMBRELLA).length - 1);
    const unpublished = SURFACE.filter((spec) => !PUBLISHED.has(spec) || packageOf(spec) === undefined);
    expect(unpublished, `entries the umbrella does not publish:\n${unpublished.join("\n")}`).toEqual([]);
    // …and the oracle's door is the WORKSPACE package's alone: the umbrella ships no oracle
    expect(Object.keys(UMBRELLA).some((k) => k.includes("oracle"))).toBe(false);
    expect(Object.hasOwn(WORKSPACE.get("@ice/desk") ?? {}, "./oracle/*")).toBe(true);
  });
});
