#!/usr/bin/env node
// THE PUBLISHED-D.TS CHECK (design-016 K8b): the desk clock compiles against the umbrella's BUILT declarations — what an outside
// plugin gets from npm — and every name it imports from ICE resolves there. Two questions, both over packages/ice/dist/types (the
// `build` of `@vibecook/ice` makes it; `pack:audit` builds it first, so gate:landing runs this after it):
//   1. the clock's shipped modules (src/) — and its STILL (test/still.ts, petition I30: the clock drawn by `createStill`, the first
//      third-party still through the door; test/still.dawn.test.ts hands it Dawn) and test/held.types.ts (petition I36: the names a
//      host reads off the selection anchor — `HeldAnchor`, `HeldSlot`, `HeldGlyph`) — typecheck with `@vibecook/ice*` mapped to the
//      built entries' `.d.ts` — and with `skipLibCheck: false`, so a declaration that names a type the tree cannot resolve is an
//      error, never a quiet `any`;
//   2. every name each ICE import declaration of theirs names (types and values, `type`-only included) resolves, through the
//      entry's re-exports, to a DECLARATION in the published tree — dist/types, or a package the umbrella DEPENDS on (strata-ecs's
//      `Entity`, re-exported by `@vibecook/ice`, is installed with it) — never the checker's unknown symbol, never a source file.
// A dependency's OWN declarations are its own (loro-crdt's d.ts has strict-mode errors of its own): printed, never charged to ICE.
// Exit 0 = both hold; 1 = a violation (each printed); 2 = no build to check (the command that makes it is printed).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createRequire } from "node:module";

const pkg = resolve(import.meta.dirname, "..");
const repo = resolve(pkg, "../..");
const umbrella = resolve(repo, "packages/ice");
const types = resolve(umbrella, "dist/types");
const ts = createRequire(resolve(repo, "package.json"))("typescript");

/** The umbrella's published specifiers → their built entry's `.d.ts` (the exports map's `types`); the packages it depends on. */
const umbrellaPkg = JSON.parse(readFileSync(resolve(umbrella, "package.json"), "utf8"));
const exportsMap = umbrellaPkg.exports;
const deps = Object.keys(umbrellaPkg.dependencies ?? {});
const paths = {};
for (const [sub, target] of Object.entries(exportsMap)) {
  if (typeof target !== "object" || target.types === undefined) continue;
  paths[`@vibecook/ice${sub === "." ? "" : sub.slice(1)}`] = [resolve(umbrella, target.types)];
}
const missing = Object.values(paths).flat().filter((f) => !existsSync(f));
if (missing.length > 0) {
  console.log(`PREFLIGHT FAIL: the umbrella's declarations are not built (${relative(repo, missing[0])} …)\n  produce them with:  pnpm --filter @vibecook/ice build`);
  process.exit(2);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : []));
const roots = [...walk(resolve(pkg, "src")), resolve(pkg, "test/still.ts"), resolve(pkg, "test/held.types.ts")];
const base = JSON.parse(readFileSync(resolve(repo, "tsconfig.base.json"), "utf8")).compilerOptions;
const options = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: ["@webgpu/types"], typeRoots: [resolve(repo, "node_modules/@types"), resolve(repo, "node_modules")],
  strict: base.strict, noUncheckedIndexedAccess: base.noUncheckedIndexedAccess, exactOptionalPropertyTypes: base.exactOptionalPropertyTypes,
  isolatedModules: true, verbatimModuleSyntax: true, noEmit: true, skipLibCheck: false, baseUrl: pkg, paths,
};
const program = ts.createProgram(roots, options);
const checker = program.getTypeChecker();
const bad = [];

const inTypes = (f) => resolve(f).startsWith(`${types}/`);
/** A file of a package the umbrella depends on (pnpm's store path ends `…/node_modules/<name>/…`). */
const inDep = (f) => deps.some((d) => resolve(f).includes(`/node_modules/${d}/`));
const theirs = [];
let compileErrors = 0;
// 1. it compiles against the published declarations — every diagnostic of the clock's and of ICE's declarations (a dependency's own d.ts
//    errors are its own: printed, not charged)
for (const d of ts.getPreEmitDiagnostics(program)) {
  const where = d.file ? `${relative(repo, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : "(program)";
  const own = !(d.file !== undefined && inDep(d.file.fileName));
  if (own) compileErrors += 1;
  (own ? bad : theirs).push(`${where}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}
// …and the published specifiers resolved to the BUILD, never to a source file
for (const f of program.getSourceFiles()) if (!f.isDeclarationFile && !f.fileName.startsWith(`${pkg}/`)) bad.push(`${relative(repo, f.fileName)}: a SOURCE file joined the program — a published specifier resolved past the build`);

// 2. every name it imports from ICE resolves to a declaration in the published tree
let names = 0;
const entries = new Set();
const viaDep = new Set();
for (const file of roots.map((r) => program.getSourceFile(r))) {
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith("@vibecook/ice")) continue;
    entries.add(st.moduleSpecifier.text);
    const bindings = st.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) { bad.push(`${relative(pkg, file.fileName)}: import from "${st.moduleSpecifier.text}" names nothing by name`); continue; }
    for (const el of bindings.elements) {
      names += 1;
      const local = checker.getSymbolAtLocation(el.name);
      const target = local && local.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(local) : local;
      const decls = target?.declarations ?? [];
      const at = decls.map((d) => d.getSourceFile().fileName);
      if (target === undefined || target.flags === ts.SymbolFlags.None || decls.length === 0) bad.push(`${relative(pkg, file.fileName)}: "${el.name.text}" from "${st.moduleSpecifier.text}" resolves to NO declaration`);
      else if (!at.every((f) => inTypes(f) || inDep(f))) bad.push(`${relative(pkg, file.fileName)}: "${el.name.text}" from "${st.moduleSpecifier.text}" is declared outside the published tree (${relative(repo, at.find((f) => !inTypes(f) && !inDep(f)))})`);
      else if (!at.every(inTypes)) viaDep.add(el.name.text);
    }
  }
}

for (const t of theirs) console.log(`  note  a dependency's own declarations: ${t}`);
for (const b of bad) console.log(`  FAIL  ${b}`);
console.log(`${bad.length === 0 ? "PASS" : "FAIL"}  the desk clock against the umbrella's built declarations: ${roots.length} modules, ${compileErrors === 0 ? "they typecheck" : `${compileErrors} compile error(s)`} (skipLibCheck: false) · ${names} names imported from ${[...entries].sort().join(", ")} — each declared in dist/types${viaDep.size > 0 ? ` or, re-exported, in a dependency the umbrella declares (${[...viaDep].join(", ")})` : ""} · ${program.getSourceFiles().filter((f) => inTypes(f.fileName)).length} published .d.ts in the program${theirs.length > 0 ? ` · ${theirs.length} note(s) in dependencies' own d.ts` : ""}${bad.length ? ` · ${bad.length} violation(s)` : ""}`);
process.exit(bad.length === 0 ? 0 : 1);
