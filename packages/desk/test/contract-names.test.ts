// K4a (design-016 §5, K-L1): the kind contract is NAMEABLE. A kind outside `@ice/desk` — the six reference kinds once K4b
// moves them to their own package, a plugin's after K8 — implements `KindProgram`, `KindPass`, `ObjectKind` and friends
// against the public entries alone, so every type those signatures name must be exported by one of them; a type a
// signature names but no entry exports is a word a plugin cannot write. This is the d.ts check: the TypeScript checker
// walks every export of the contract modules (and, transitively, every desk type they name) and asks, for each type a
// SIGNATURE names — a member's type, a parameter, a return, a heritage clause, never a function body — whether a public
// entry exports that very symbol. Lib and dependency types (GPU*, the DOM, strata) are not the desk's to export; core's
// and kernel's are held to their own entries.
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const desk = resolve(import.meta.dirname, "..");
const repo = resolve(desk, "../..");
const src = resolve(desk, "src");

/** The public entries a consumer can import: `@ice/desk`, `/engine`, `/kit`, and core's and kernel's (the reference kinds are `@ice/objects` since K4b — a consumer of these, as a plugin is). */
const ENTRIES = [
  "src/index.ts",
  "src/engine/index.ts",
  "src/kit/index.ts",
].map((p) => resolve(desk, p)).concat([resolve(repo, "packages/core/src/index.ts"), resolve(repo, "packages/kernel/src/index.ts")]);

/** THE CONTRACT: what a kind implements and is handed (kind.ts, kinds/world.ts), the typed door (object.ts), and the kit. */
const CONTRACT = ["src/kind.ts", "src/kinds/world.ts", "src/object.ts", "src/kit/index.ts"].map((p) => resolve(desk, p));

/** A declaration the desk (or core, or kernel) owns — the only kind a public entry must export. */
const owned = (file: string): boolean => /\/packages\/(desk|core|kernel)\/src\//.test(file) && !file.includes("/node_modules/");
const deskOwned = (file: string): boolean => file.startsWith(`${src}/`);

function program(): ts.Program {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(desk, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
  });
  if (!config) throw new Error("contract-names: no tsconfig");
  return ts.createProgram({ rootNames: [...ENTRIES, ...CONTRACT].filter((f) => ts.sys.fileExists(f)), options: { ...config.options, noEmit: true } });
}

/** Unnameable types: `Name (declared at) ← named by`. */
function unnameable(): string[] {
  const prog = program();
  const checker = prog.getTypeChecker();
  const resolveAlias = (s: ts.Symbol): ts.Symbol => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
  const exportsOf = (file: string): ts.Symbol[] => {
    const sf = prog.getSourceFile(file);
    const mod = sf && checker.getSymbolAtLocation(sf);
    return mod ? checker.getExportsOfModule(mod).map(resolveAlias) : [];
  };
  const nameable = new Set<ts.Symbol>();
  for (const e of ENTRIES) for (const s of exportsOf(e)) nameable.add(s);

  const seen = new Set<ts.Symbol>();
  const queue: { sym: ts.Symbol; from: string }[] = [];
  const bad = new Map<string, string>();
  const where = (d: ts.Declaration): string => `${relative(repo, d.getSourceFile().fileName)}:${d.getSourceFile().getLineAndCharacterOfPosition(d.getStart()).line + 1}`;

  /** A type a signature names: owned ⇒ it must be nameable; the desk's own are walked in turn. */
  const named = (node: ts.Node, from: string): void => {
    let s = checker.getSymbolAtLocation(node);
    if (!s) return;
    s = resolveAlias(s);
    const d = s.declarations?.[0];
    if (!d || s.flags & ts.SymbolFlags.TypeParameter) return;
    const file = d.getSourceFile().fileName;
    if (!owned(file)) return;
    // a member of a namespace or an enum is named through its parent
    if (!nameable.has(s) && !(s.flags & (ts.SymbolFlags.EnumMember | ts.SymbolFlags.Property | ts.SymbolFlags.Method))) {
      const key = `${s.getName()} (${where(d)})`;
      if (!bad.has(key)) bad.set(key, from);
    }
    if (deskOwned(file) && !seen.has(s)) { seen.add(s); queue.push({ sym: s, from: s.getName() }); }
  };

  /** Walk a declaration's SIGNATURE — types, parameters, returns, heritage — never a body or an initialiser's code. */
  const walk = (node: ts.Node, from: string): void => {
    if (ts.isTypeReferenceNode(node)) named(node.typeName, from);
    else if (ts.isExpressionWithTypeArguments(node)) named(node.expression, from);
    else if (ts.isTypeQueryNode(node)) named(node.exprName, from);
    else if (ts.isImportTypeNode(node) && node.qualifier) named(node.qualifier, from);
    if (ts.isBlock(node)) return;   // a body is code, not a signature
    if ((ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) return;
    if ((ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) && node.name && ts.isPrivateIdentifier(node.name)) return;
    if (ts.isVariableDeclaration(node)) {
      if (node.type) walk(node.type, from);
      else if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) walk(node.initializer, from);
      return;
    }
    if (ts.isPropertyDeclaration(node) && !node.type) return;   // an inferred field names nothing a reader writes
    if (ts.isParameter(node)) { if (node.type) walk(node.type, from); return; }
    ts.forEachChild(node, (c) => walk(c, from));
  };

  for (const file of CONTRACT) for (const s of exportsOf(file)) if (!seen.has(s)) { seen.add(s); queue.push({ sym: s, from: `${relative(src, file)} ${s.getName()}` }); }
  while (queue.length) {
    const { sym, from } = queue.shift() as { sym: ts.Symbol; from: string };
    for (const d of sym.declarations ?? []) if (owned(d.getSourceFile().fileName)) walk(d, from);
  }
  return [...bad].map(([k, v]) => `${k} ← ${v}`).sort();
}

describe("the kind contract is nameable (K4a, design-016 §5)", () => {
  it("every type the contract's signatures name is exported by a public entry", () => {
    expect(unnameable()).toEqual([]);
  }, 120_000);
});

// the walker is proved to SEE: the entries and the contract resolve, so an empty answer is never an empty program
describe("the nameability walker", () => {
  it("resolves the entries and the contract", () => {
    const prog = program();
    for (const f of [...ENTRIES, ...CONTRACT].filter((p) => ts.sys.fileExists(p))) expect(prog.getSourceFile(f), relative(repo, dirname(f))).toBeDefined();
  }, 120_000);
});
