// @vitest-environment node
// THE IMPORT WALL (design-016 K8b · K-L1/K-L2): the desk clock is written the way an outside plugin is — every module it ships
// (src/, oracle/) imports ICE through the umbrella's PUBLISHED entries alone (`@vibecook/ice`, `/kernel`, `/desk`, `/desk/kit`,
// `/desk/engine` … — READ from packages/ice/package.json's exports map, so an entry the package does not ship cannot pass), and
// never another kind (`/desk/objects`, the reference six: no kind imports a kind). A workspace name (`@ice/desk`), a path out of
// the package (`../../packages/…`), a deep `src`/`dist` import, an npm package or a Node builtin is a violation; so is a relative
// import that climbs out of the package. The units under test/ may add the runner (`vitest`) and Node's builtins. The
// dependency-cruiser rule `examples-import-only-the-published-entries` is the same wall at the module graph (depcruise).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PKG = resolve(import.meta.dirname, "..");
const UMBRELLA = resolve(PKG, "../../packages/ice/package.json");

/** The umbrella's published specifiers, from its exports map (`@vibecook/ice`, `@vibecook/ice/desk`, …). */
function published(): string[] {
  const pkg = JSON.parse(readFileSync(UMBRELLA, "utf8")) as { name: string; exports: Record<string, unknown> };
  return Object.keys(pkg.exports).filter((sub) => sub !== "./package.json").map((sub) => `${pkg.name}${sub === "." ? "" : sub.slice(1)}`);
}
/** What a plugin kind may import: every published entry but the reference kinds' (K-L1 — a kind never imports another). */
const ALLOWED = new Set(published().filter((s) => s !== "@vibecook/ice/desk/objects"));
/** What its units may add. */
const TEST_ONLY = /^(vitest|node:[a-z/_]+)$/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mts|mjs|js)$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** Every static, re-export, type-only and dynamic specifier in a module (a vite query dropped). */
function specifiersOf(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/(?:^|[\s;{}])(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g)) specs.push(m[1] as string);
  for (const m of source.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) specs.push(m[1] as string);
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1] as string);
  return specs.map((s) => s.replace(/\?.*$/, ""));
}

/** Why a specifier in `file` is off the wall, or null when it is one the wall admits. */
function violation(file: string, spec: string, test: boolean): string | null {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(file), spec);
    return relative(PKG, target).startsWith("..") ? `"${spec}" climbs out of the package` : null;
  }
  if (ALLOWED.has(spec)) return null;
  if (test && TEST_ONLY.test(spec)) return null;
  if (spec === "@vibecook/ice/desk/objects") return `"${spec}" is the reference kinds' entry — a kind never imports another kind (K-L1)`;
  if (spec.startsWith("@ice/")) return `"${spec}" is a workspace-internal name — a plugin imports the umbrella's published entries`;
  return `"${spec}" is not one of the umbrella's published entries (${[...ALLOWED].join(", ")})`;
}

describe("the desk clock imports the umbrella's published entries alone (K8b)", () => {
  const shipped = [...walk(join(PKG, "src")), ...walk(join(PKG, "oracle"))];
  const units = walk(join(PKG, "test"));

  it("finds the package's modules, and they really consume ICE — through the four entries a kind is written against", () => {
    expect(shipped.length).toBeGreaterThan(5);
    expect(units.length).toBeGreaterThan(0);
    const ice = shipped.flatMap((f) => specifiersOf(readFileSync(f, "utf8"))).filter((s) => s.startsWith("@vibecook/ice"));
    expect(new Set(ice)).toEqual(new Set(["@vibecook/ice", "@vibecook/ice/desk", "@vibecook/ice/desk/kit", "@vibecook/ice/desk/engine"]));
  });

  it("every specifier its shipped modules name is a published entry or a module of its own", () => {
    const bad = shipped.flatMap((f) => specifiersOf(readFileSync(f, "utf8")).map((s) => violation(f, s, false)).filter((v) => v !== null).map((v) => `${relative(PKG, f)}: ${v}`));
    expect(bad).toEqual([]);
  });

  it("…and its units add only the runner and Node's builtins", () => {
    const bad = units.flatMap((f) => specifiersOf(readFileSync(f, "utf8")).map((s) => violation(f, s, true)).filter((v) => v !== null).map((v) => `${relative(PKG, f)}: ${v}`));
    expect(bad).toEqual([]);
  });

  it("the wall refuses what an insider would write: a workspace name, a path into packages/, a deep import, a raw dependency, the reference kinds", () => {
    const f = join(PKG, "src/index.ts");
    for (const spec of ["@ice/desk", "@ice/desk/kit", "../../../packages/desk/src/index", "@vibecook/ice/dist/desk.js", "@vibecook/strata-ecs", "loro-crdt", "@vibecook/ice/desk/objects", "node:fs", "vitest"]) {
      expect(violation(f, spec, false), spec).not.toBeNull();
    }
    for (const spec of ["@vibecook/ice/desk", "@vibecook/ice/desk/kit", "@vibecook/ice/desk/engine", "@vibecook/ice", "./law"]) expect(violation(f, spec, false), spec).toBeNull();
  });

  it("reads type-only, re-export, side-effect and dynamic specifiers alike", () => {
    // assembled at run time: this file's own text names no specifier the wall would read
    const imp = "imp" + "ort";
    const q = (s: string): string => `"${s}"`;
    const src = [`${imp} type { A } from ${q("x1")};`, `export { b } from ${q("x2")};`, `export * from ${q("x3")};`, `${imp} ${q("x4")};`, `const m = await ${imp}(${q("x5")});`, `${imp} {`, "  c,", "  type D,", `} from ${q("x6")};`].join("\n");
    expect(specifiersOf(src).sort()).toEqual(["x1", "x2", "x3", "x4", "x5", "x6"]);
  });
});
