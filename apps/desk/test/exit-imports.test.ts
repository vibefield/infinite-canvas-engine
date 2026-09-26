/**
 * THE M10 exit test, on the desk (design-015 §11.6 — moodboard's `exit-imports`, ported BY NAME at D5a before the
 * moodboard retires): "a third-party-shaped sample app builds against the published surface only (no deep
 * imports)". It walks every source file under `apps/desk/src` and holds each import specifier two ways:
 *   1. NONE matches the forbidden shapes — a deep import into an engine package's `src/` or `dist/`, a raw strata
 *      or loro import (the engine's own dependencies), or a relative climb out of the app into `packages/`.
 *   2. EVERY engine specifier (one whose package is a workspace package) is an entry of THE SURFACE — exactly what
 *      apps/desk imports today, no more (an allowance nothing uses fails too) — and every entry of THE SURFACE is
 *      one its package's `exports` map publishes (`/*` = a wildcard entry, the files under it).
 * THE SURFACE is ONE constant on one line: D5b's umbrella rename (the `@ice/*` workspace entries → the umbrella's)
 * changes that line and nothing else. A vite query (`?url`) is not part of the module path.
 *
 * Test files live under `test/`, not `src/`, so this file (which necessarily NAMES the forbidden strings) is not
 * scanned by itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** THE SURFACE — the engine entries apps/desk may import. D5b's umbrella rename is a change to this one line. */
const SURFACE = ["@ice/core", "@ice/react", "@ice/desk/compose", "@ice/desk/engine", "@ice/desk/host", "@ice/desk/kinds", "@ice/desk/noise", "@ice/desk/objects", "@ice/desk/shaders", "@ice/desk/theme", "@ice/desk/oracle/*"] as const;

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

/** The SURFACE entry a specifier falls under: an exact entry, or a wildcard's directory. */
function entryOf(spec: string): string | undefined {
  return SURFACE.find((e) => (e.endsWith("/*") ? spec.startsWith(e.slice(0, -1)) && spec.length > e.length - 1 : spec === e));
}

describe("M10 exit criterion — apps/desk is surface-only", () => {
  const files = walk(SRC);
  const bySpec = new Map<string, string[]>();
  for (const file of files) {
    for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
      const list = bySpec.get(spec) ?? [];
      list.push(file.slice(APP.length + 1));
      bySpec.set(spec, list);
    }
  }
  const allSpecs = [...bySpec.keys()];
  const where = (s: string): string => `${s}  (in ${(bySpec.get(s) ?? []).join(", ")})`;
  const engineSpecs = allSpecs.filter((s) => packageOf(s) !== undefined);

  it("finds source files and engine imports to inspect", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(engineSpecs.length).toBeGreaterThan(0); // the app really does consume the engine
  });

  it("no import specifier matches the forbidden (deep-import / raw-dep / climb) shapes", () => {
    const offenders = allSpecs.filter((s) => FORBIDDEN.test(s)).map(where);
    expect(offenders, `forbidden specifiers found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every engine import is an entry of THE SURFACE", () => {
    const bad = engineSpecs.filter((s) => entryOf(s) === undefined).map(where);
    expect(bad, `engine imports outside THE SURFACE:\n${bad.join("\n")}`).toEqual([]);
  });

  it("THE SURFACE is exactly what the app imports — no allowance nothing uses", () => {
    const used = new Set(engineSpecs.map(entryOf));
    const unused = SURFACE.filter((e) => !used.has(e));
    expect(unused, `allowances nothing imports (drop them from THE SURFACE):\n${unused.join("\n")}`).toEqual([]);
  });

  it("every entry of THE SURFACE is one its package publishes (its exports map)", () => {
    const unpublished = SURFACE.filter((e) => {
      const pkg = packageOf(e);
      if (pkg === undefined) return true;
      const sub = `.${e.slice(pkg.length)}`;
      return !Object.hasOwn(WORKSPACE.get(pkg) ?? {}, sub === "." ? "." : sub);
    });
    expect(unpublished, `entries no package publishes:\n${unpublished.join("\n")}`).toEqual([]);
  });
});
