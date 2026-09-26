#!/usr/bin/env node
// THE DOCS SAY WHAT THE CODE DOES (design-015 D7, the surface review's #10): each row is a contradiction the review found
// — a doc or a JSDoc presenting a retired door as current — pinned so it cannot come back, and the rows that must be
// PRESENT so a fix cannot be undone by deleting the sentence. A retired name may still appear where a doc says it left
// (the rows match the stale CLAIM, not the name). Run by the root `gen:check` (so `ci`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
];

const bad = [];
for (const [what, files, re, absent] of ROWS) {
  const hits = files.flatMap((f) => (read(f).match(re) ? [relative(root, resolve(root, f))] : []));
  if (absent && hits.length > 0) bad.push(`${what}: ${hits.join(", ")}`);
  if (!absent && hits.length === 0) bad.push(`${what}: missing from ${files.join(", ")}`);
}
for (const b of bad) console.error(`check-docs: ${b}`);
if (bad.length > 0) process.exit(1);
console.log(`check-docs: ${ROWS.length} rows — the docs and the JSDoc say what the code does`);
