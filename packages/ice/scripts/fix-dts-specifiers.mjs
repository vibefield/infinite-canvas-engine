#!/usr/bin/env node
// Rewrite workspace `@ice/*` specifiers in the emitted d.ts tree to RELATIVE
// paths (pre-publish review, 2026-08-16). `tsc -p tsconfig.dts.json` preserves
// path-mapped specifiers in declaration output, so every emitted file whose
// SOURCE imported `@ice/core` shipped a specifier only this monorepo can
// resolve: consumers with `skipLibCheck: false` got TS2307 on six of the seven
// entry points, and the (default) `skipLibCheck: true` crowd silently got
// `any` for every symbol that crossed one of those imports — the published
// 0.2.0–0.7.0 artifacts all carry the defect. Every `@ice/<pkg>` maps to
// `dist/types/packages/<pkg>/src/index.d.ts`, which the same emit already
// contains, so the rewrite is purely mechanical.
//
// A SUBPATH (`@ice/desk/objects`, design-015 D7) maps through the workspace
// package's own exports map (`./objects` → `./src/objects/index.ts` →
// `dist/types/packages/desk/src/objects/index.d.ts`); until D7 the pattern
// named bare package names only, so a subpath was neither rewritten nor caught.
//
// Runs as the LAST step of `build`. Exits non-zero if a rewrite target is
// missing or any QUOTED `@ice/` specifier survives — bare or subpath — the
// guard that keeps this defect class out of every future artifact. Doc-comment
// mentions of `@ice/*` are prose, not specifiers, and deliberately survive.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const typesRoot = resolve(import.meta.dirname, "..", "dist", "types");
if (!existsSync(typesRoot)) {
  console.error(`fix-dts-specifiers: ${typesRoot} does not exist — run after tsc -p tsconfig.dts.json`);
  process.exit(1);
}

/** Every .d.ts under `dir`, depth-first. */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".d.ts")) yield p;
  }
}

// Quoted specifiers only — `from "@ice/core"` / `import("@ice/desk/objects")`;
// prose mentions in doc comments are unquoted and must survive.
const SPECIFIER = /(["'])@ice\/(kernel|core|dom|desk|react|devtools)(\/[^"']+)?\1/g;
/** The guard's pattern: ANY quoted private-scope specifier, whatever package or subpath it names. */
const ANY_PRIVATE = /(["'])@ice\/[^"']*\1/;

/** A specifier's d.ts target (without `.d.ts`): the package's index, or its exports map's subpath source. */
function targetOf(pkg, sub) {
  if (sub === undefined) return join(typesRoot, "packages", pkg, "src", "index");
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "..", pkg, "package.json"), "utf8"));
  const src = manifest.exports?.[`.${sub}`];
  if (typeof src !== "string" || !/\.tsx?$/.test(src)) return undefined;
  return join(typesRoot, "packages", pkg, src.replace(/^\.\//, "").replace(/\.tsx?$/, ""));
}

let rewrites = 0;
let failed = false;
for (const file of walk(typesRoot)) {
  const text = readFileSync(file, "utf8");
  if (!SPECIFIER.test(text)) continue;
  SPECIFIER.lastIndex = 0;
  const next = text.replace(SPECIFIER, (match, quote, pkg, sub) => {
    const target = targetOf(pkg, sub);
    if (target === undefined || !existsSync(`${target}.d.ts`)) {
      console.error(`fix-dts-specifiers: missing rewrite target ${target ?? "(no exports entry)"}.d.ts (for @ice/${pkg}${sub ?? ""} in ${file})`);
      failed = true;
      return match;
    }
    let rel = relative(dirname(file), target).split("\\").join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    rewrites++;
    return `${quote}${rel}${quote}`;
  });
  if (next !== text) writeFileSync(file, next);
}
if (failed) process.exit(1);

// The guard: no quoted private-scope specifier may survive.
const leftovers = [];
for (const file of walk(typesRoot)) {
  if (ANY_PRIVATE.test(readFileSync(file, "utf8"))) leftovers.push(file);
}
if (leftovers.length > 0) {
  console.error(
    `fix-dts-specifiers: ${leftovers.length} file(s) still carry a quoted @ice/* specifier:\n  ${leftovers.slice(0, 5).join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`fix-dts-specifiers: rewrote ${rewrites} specifier(s); dist/types resolves standalone.`);
