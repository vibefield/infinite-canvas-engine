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
// Runs as the LAST step of `build`. Exits non-zero if a rewrite target is
// missing or any QUOTED `@ice/` specifier survives — the guard that keeps this
// defect class out of every future artifact. Doc-comment mentions of `@ice/*`
// are prose, not specifiers, and deliberately survive.
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

// Quoted specifiers only — `from "@ice/core"` / `import("@ice/core")`; prose
// mentions in doc comments are unquoted and must survive.
const SPECIFIER = /(["'])@ice\/(kernel|core|dom|react|r3f|ground|devtools)\1/g;

let rewrites = 0;
let failed = false;
for (const file of walk(typesRoot)) {
  const text = readFileSync(file, "utf8");
  if (!SPECIFIER.test(text)) continue;
  SPECIFIER.lastIndex = 0;
  const next = text.replace(SPECIFIER, (match, quote, pkg) => {
    const target = join(typesRoot, "packages", pkg, "src", "index");
    if (!existsSync(`${target}.d.ts`)) {
      console.error(`fix-dts-specifiers: missing rewrite target ${target}.d.ts (for @ice/${pkg} in ${file})`);
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
  SPECIFIER.lastIndex = 0;
  if (SPECIFIER.test(readFileSync(file, "utf8"))) leftovers.push(file);
}
if (leftovers.length > 0) {
  console.error(
    `fix-dts-specifiers: ${leftovers.length} file(s) still carry a quoted @ice/* specifier:\n  ${leftovers.slice(0, 5).join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`fix-dts-specifiers: rewrote ${rewrites} specifier(s); dist/types resolves standalone.`);
