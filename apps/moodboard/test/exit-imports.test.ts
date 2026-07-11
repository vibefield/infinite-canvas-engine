/**
 * THE M10 exit test (implementation-plan M10): "a third-party-shaped sample app
 * builds against the published surface only (no deep imports)."
 *
 * It walks every source file under `apps/moodboard/src` and inspects each import
 * specifier. The exit is PINNED two ways:
 *   1. NO specifier may match the forbidden pattern — a deep import into an
 *      engine package (`@ice/x/src|dist`), a raw strata (`@vibecook/...`) or loro
 *      (`loro-crdt`) import, or a relative climb into `packages/`.
 *   2. EVERY `@ice/*` specifier must be exactly a published package ROOT:
 *      `@ice/core`, `@ice/react`, `@ice/dom`, or `@ice/devtools`.
 *
 * Test files live under `test/`, not `src/`, so this file (which necessarily
 * NAMES the forbidden strings) is not scanned by itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Locate this app's `src/` independent of where the runner is launched from
// (vitest's happy-dom env does not expose a file:// import.meta.url).
const SRC_DIR = [join(process.cwd(), "src"), join(process.cwd(), "apps/moodboard/src")].find((d) =>
  existsSync(d),
);
if (SRC_DIR === undefined) throw new Error("moodboard exit test: could not locate src/");

/** The forbidden specifier shapes (task-specified). Applied per-specifier so `^` anchors. */
const FORBIDDEN = /@ice\/(core|react|dom|devtools|kernel|r3f)\/(src|dist)|@vibecook|^\.\.\/\.\.\/packages|loro-crdt/;

/** The ONLY published engine roots a consumer may import. */
const ALLOWED_ICE_ROOTS = new Set(["@ice/core", "@ice/react", "@ice/dom", "@ice/devtools"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** Every import/export/dynamic-import specifier in a source file. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const staticRe = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(staticRe)) specs.push(m[1] as string);
  for (const m of source.matchAll(dynamicRe)) specs.push(m[1] as string);
  return specs;
}

describe("M10 exit criterion — moodboard is facade-only", () => {
  const files = walk(SRC_DIR);
  const bySpec = new Map<string, string[]>(); // specifier → files it appears in

  for (const file of files) {
    for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
      const list = bySpec.get(spec) ?? [];
      list.push(file);
      bySpec.set(spec, list);
    }
  }
  const allSpecs = [...bySpec.keys()];

  it("finds source files to inspect", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(allSpecs.length).toBeGreaterThan(0);
  });

  it("no import specifier matches the forbidden (deep-import / raw-dep) pattern", () => {
    const offenders = allSpecs
      .filter((s) => FORBIDDEN.test(s))
      .map((s) => `${s}  (in ${(bySpec.get(s) ?? []).join(", ")})`);
    expect(offenders, `forbidden specifiers found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every @ice/* import is a published package root", () => {
    const iceSpecs = allSpecs.filter((s) => s.startsWith("@ice/"));
    expect(iceSpecs.length).toBeGreaterThan(0); // the app really does consume the engine
    const bad = iceSpecs.filter((s) => !ALLOWED_ICE_ROOTS.has(s));
    expect(bad, `non-root @ice imports:\n${bad.join("\n")}`).toEqual([]);
  });
});
