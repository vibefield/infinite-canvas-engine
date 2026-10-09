#!/usr/bin/env node
// THE DOCS SAY WHAT THE CODE DOES (design-015 D7, the surface review's #10): each row is a contradiction the review found
// — a doc or a JSDoc presenting a retired door as current — pinned so it cannot come back, and the rows that must be
// PRESENT so a fix cannot be undone by deleting the sentence. A retired name may still appear where a doc says it left
// (the rows match the stale CLAIM, not the name). Run by the root `gen:check` (so `ci`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { kitPieces, structDocProblems, wgslDocProblems } from "./wgsl-docs.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
/** Every .ts/.tsx under a package's src/ — where the JSDoc lives. */
function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".gen.ts")) yield p;
  }
}
const jsdoc = [...sources(resolve(root, "packages"))].filter((p) => /^[^/]+\/src\//.test(relative(resolve(root, "packages"), p)));
/** The landing gate's rigs, counted off its own script, and the docs that name the number (K9: they said fifteen while it ran sixteen). */
const NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "twenty-one", "twenty-two"];
const gateRigs = NUMBERS[(JSON.parse(read("package.json")).scripts["gate:landing"].match(/ rig:[\w-]+/g) ?? []).length] ?? "more than twenty-two";
const RIG_COUNTED = ["README.md", "docs/api-reference.md"];

/** [what, files, pattern, absent?] — absent: the stale claim must not be there; else it must. */
const ROWS = [
  ["defineWidget's view fields are not documented as fields (they are refused since D5b)", ["docs/api.html"], /<tr><td>(surface|component)<span class="req">req<\/span>|<tr><td>(sizeMode|animated)<\/td>/, true],
  ["createCanvasEngine takes no measureQueue", ["docs/api.html", "docs/api-reference.md"], /createCanvasEngine\(\{[^)]*measureQueue\?/, true],
  ["the landing page shows no planes, islands, portals or keep-mounted LRU as current", ["docs/index.html"], /Six planes, one camera|<b>GL islands<\/b>|Cull ≠ unmount|MeasuredSize|GL router|React portals from one root|R3F components into canvas citizens/, true],
  ["the API page's quickstart and renderer entry are the desk's, not the hybrid's", ["docs/api.html"], /GL widgets are islands|keepMounted|pnpm --filter (glboard|cardboard|nodeboard)|&lt;<span class="tk-f">InfiniteCanvas<\/span> <span class="tk-p">engine/, true],
  ["no quickstart or intro says kinds are wired into node graphs (no kind has ports)", ["README.md", "packages/ice/README.md", "docs/index.html"], /wired into node graphs/, true],
  ["/desk/engine ships no pass and not the swap chain", ["README.md", "packages/ice/README.md", "docs/api-reference.md"], /\(device, surface, passes\)|engine: device, surface, passes/, true],
  ["defineTool's route row names canvasDragShift", ["docs/api-reference.md"], /route \{canvasDrag, canvasDragShift, widgetDrag, portDrag\}/, false],
  ["the JSDoc names no module that is not an entry (`@ice/desk/host`)", jsdoc, /`@ice\/desk\/host`/, true],
  ["the JSDoc points a caller at <Desk>/EngineProvider, not <InfiniteCanvas>, for the menu's engine", ["packages/react/src/selection-menu.tsx"], /`<InfiniteCanvas>` provides one|outside `<InfiniteCanvas>`/, true],
  ["the ground's device doc says no three adopts it", ["packages/desk/src/ground.ts"], /three adopts/, true],
  ["the plugin-parity list names the wakes a kind declares and what a missing one costs (K9)", ["docs/api-reference.md"], /`KindLocal\.due\(now\)`[\s\S]*desk never sleeps[\s\S]*`KindHost\.wake\(\)`[\s\S]*`KindPass\.idleAt\(ms\)`/, false],
  ...RIG_COUNTED.map((f) => [`${f} counts the landing gate's ${gateRigs} rigs (package.json's gate:landing, K9)`, [f], new RegExp(`\\b${gateRigs} rigs\\b`), false]),
  // (a count starts at no word's middle — `(?<![\w-])`, never `\b`: at twenty-one rigs, "one rigs" inside the true count is no stale
  // one; M24 LT1 found it, the first hyphenated count)
  [`no doc counts the landing gate's rigs as other than ${gateRigs} (K9)`, RIG_COUNTED, new RegExp(`(?<![\\w-])(?!${gateRigs} )(${NUMBERS.join("|")}) rigs\\b`), true],
  ["the desk's editor is the desk's, not one an object's DOM half made (K8a; K9)", ["docs/api-reference.md"], /the one focused editor an object's DOM half made/, true],
  ["the CHANGELOG's K8a renames name NoteEditorOptions beside NoteEditor and createNoteEditor (K9)", ["CHANGELOG.md"], /`NoteEditorOptions` → split in two/, false],
];

/**
 * The rows a pattern cannot hold, each a function answering its problems (none = it holds). THE KIT'S WGSL SAYS WHAT IT MEANS
 * (petition I31): every module the kit hands out — the pieces `kitWgsl` composes (read off kit/wgsl.ts's PIECES, so a new piece is
 * held from its first line) and every file under shaders/kit/ — documents each declaration (wgsl-docs.mjs: a `///` block naming
 * every parameter and saying the answer), and each kit record declared in TypeScript (the PIECES' `structs`) names every field in
 * its JSDoc. The same parser holds the SHIPPED text in pack:audit.
 */
const shaders = resolve(root, "packages/desk/shaders");
const kit = kitPieces(read("packages/desk/src/kit/wgsl.ts"));
const kitFiles = [...new Set([...kit.files, ...readdirSync(join(shaders, "kit")).filter((f) => f.endsWith(".wgsl")).map((f) => `kit/${f}`)])];
const recordAt = (name) => jsdoc.find((p) => p.startsWith(resolve(root, "packages/desk/src")) && readFileSync(p, "utf8").includes(`export const ${name} = defineStruct("${name}", [`));
const COMPUTED = [
  [`every declaration of the kit's WGSL (${kitFiles.join(", ")}) has a /// block naming each parameter and its answer, and each kit record's JSDoc (${kit.structs.join(", ")}) names every field (petition I31)`, () => [
    ...kitFiles.flatMap((f) => wgslDocProblems(readFileSync(join(shaders, f), "utf8"), f)),
    ...kit.structs.flatMap((n) => { const at = recordAt(n); return at === undefined ? [`no defineStruct for ${n} in packages/desk/src`] : structDocProblems(readFileSync(at, "utf8"), n, relative(root, at)); }),
  ]],
];

const bad = [];
for (const [what, problems] of COMPUTED) {
  const found = problems();
  if (found.length > 0) bad.push(`${what}: ${found.slice(0, 8).join(" · ")}${found.length > 8 ? ` (and ${found.length - 8} more)` : ""}`);
}
for (const [what, files, re, absent] of ROWS) {
  const hits = files.flatMap((f) => (read(f).match(re) ? [relative(root, resolve(root, f))] : []));
  if (absent && hits.length > 0) bad.push(`${what}: ${hits.join(", ")}`);
  if (!absent && hits.length === 0) bad.push(`${what}: missing from ${files.join(", ")}`);
}
for (const b of bad) console.error(`check-docs: ${b}`);
if (bad.length > 0) process.exit(1);
console.log(`check-docs: ${ROWS.length + COMPUTED.length} rows — the docs and the JSDoc say what the code does`);
