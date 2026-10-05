// THE KIT'S WGSL SAYS WHAT IT MEANS (petition I31) — what `check-docs` holds the source to and `pack:audit` the SHIPPED text to.
// A kit WGSL file's every top-level declaration — function, struct, const, override, binding — carries a `///` block directly
// above it (above its attributes): a function's names each of its parameters in backticks (its units and range) and says its
// answer on a `/// →` line; a struct's names each of its members (or a member carries its own `///` line). A kit record declared
// in TypeScript (`defineStruct`) carries a JSDoc block naming every field in backticks. The words are reviewed; the SHAPE — every
// input and the output said, nothing undocumented — is held here.

/** Every top-level declaration of a WGSL module: its kind, name and line. */
const DECL = /^((?:@\w+(?:\([^)]*\))?\s+)*)(fn|struct|const|override|var(?:<[^>]*>)?|alias)\s+(\w+)/;
/** A line of attributes alone (`@vertex`, `@compute @workgroup_size(64)`), which a declaration's doc block sits above. */
const ATTRS_ONLY = /^@\w+(?:\([^)]*\))?(?:\s+@\w+(?:\([^)]*\))?)*\s*$/;

/** A function's parameter names, read from its signature (`text` from the `(` after its name). */
function paramsOf(text) {
  let depth = 0;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) { end = i; break; }
  }
  const list = end < 0 ? "" : text.slice(1, end);
  return { names: [...list.matchAll(/(?:^|,)\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:/g)].map((m) => m[1]), answers: end >= 0 && /^\s*->/.test(text.slice(end + 1)) };
}

/** What `text` (a kit WGSL module, labelled `label`) leaves unsaid — one line a problem; none = every declaration documented. */
export function wgslDocProblems(text, label) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (m === null) continue;
    const [, , kind, name] = m;
    let j = i - 1;
    while (j >= 0 && ATTRS_ONLY.test(lines[j])) j--;
    const doc = [];
    for (; j >= 0 && lines[j].startsWith("///"); j--) doc.unshift(lines[j]);
    const said = doc.join("\n");
    if (doc.length === 0) { out.push(`${label}: \`${name}\` (${kind.split("<")[0]}) has no /// block`); continue; }
    if (kind === "fn") {
      const sig = paramsOf(lines[i].slice(lines[i].indexOf("(", lines[i].indexOf(name))));
      for (const p of sig.names) if (!said.includes(`\`${p}\``)) out.push(`${label}: \`${name}\` says nothing of its parameter \`${p}\``);
      if (sig.answers && !doc.some((l) => l.replace(/^\/\/\/\s*/, "").startsWith("→"))) out.push(`${label}: \`${name}\` has no /// → line (its answer)`);
    } else if (kind === "struct") {
      const body = lines[i].includes("}") ? lines[i].slice(lines[i].indexOf("{") + 1, lines[i].indexOf("}")) : "";
      // a one-line struct's members are said in its block; a multi-line one's may each carry a `///` line of their own instead
      const members = body !== "" ? [...body.matchAll(/(?:^|,)\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:/g)].map((x) => [x[1], -1]) : [];
      if (body === "") for (let k = i + 1; k < lines.length && !lines[k].startsWith("}"); k++) { const x = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:/.exec(lines[k]); if (x) members.push([x[1], k]); }
      for (const [mem, at] of members) if (!said.includes(`\`${mem}\``) && !(at > 0 && (lines[at - 1] ?? "").trim().startsWith("///"))) out.push(`${label}: struct \`${name}\` says nothing of its member \`${mem}\``);
    }
  }
  return out;
}

/** The `///` lines of a WGSL text — how many a module carries. */
export const docLines = (text) => text.split("\n").filter((l) => l.startsWith("///")).length;

/**
 * What a TypeScript kit record leaves unsaid: `source` declares `export const <name> = defineStruct("<name>", [ … ])` with a
 * JSDoc block directly above, which must name every field in backticks. Problems as above; the record not found is one.
 */
export function structDocProblems(source, name, label) {
  const at = source.indexOf(`export const ${name} = defineStruct("${name}", [`);
  if (at < 0) return [`${label}: no \`export const ${name} = defineStruct("${name}", [\``];
  const before = source.slice(0, at).trimEnd();
  const jsdoc = before.endsWith("*/") ? before.slice(before.lastIndexOf("/**")) : "";
  const list = source.slice(at, source.indexOf("] as const)", at));
  const fields = [...list.matchAll(/\["(\w+)",/g)].map((m) => m[1]);
  if (jsdoc === "") return [`${label}: \`${name}\` has no JSDoc block`];
  return fields.filter((f) => !jsdoc.includes(`\`${f}\``)).map((f) => `${label}: \`${name}\`'s JSDoc says nothing of its field \`${f}\``);
}

/** The kit's pieces as packages/desk/src/kit/wgsl.ts declares them: the module files and the records (TypeScript structs). */
export function kitPieces(wgslTs) {
  const block = wgslTs.slice(wgslTs.indexOf("const PIECES = {"), wgslTs.indexOf("} as const satisfies"));
  return {
    files: [...block.matchAll(/file: "([^"]+)"/g)].map((m) => m[1]),
    structs: [...block.matchAll(/structs: \[([^\]]*)\]/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()).filter((x) => x !== "")),
  };
}

/**
 * What a kit record's DECLARATION (a built d.ts, `export declare const <name>: …`) leaves unsaid: the JSDoc above it must name
 * each of `fields` — the shipped record's own (`record.fields`) — in backticks.
 */
export function dtsRecordProblems(dts, name, fields, label) {
  const at = dts.indexOf(`export declare const ${name}:`);
  if (at < 0) return [`${label}: no \`export declare const ${name}\``];
  const before = dts.slice(0, at).trimEnd();
  const jsdoc = before.endsWith("*/") ? before.slice(before.lastIndexOf("/**")) : "";
  if (jsdoc === "") return [`${label}: \`${name}\` ships no JSDoc`];
  return fields.filter((f) => !jsdoc.includes(`\`${f}\``)).map((f) => `${label}: \`${name}\`'s JSDoc says nothing of its field \`${f}\``);
}
