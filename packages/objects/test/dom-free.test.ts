// design-016 §5 · K-L2 (K4b): the reference kinds are DOM-free but each kind's DOM half — `src/<kind>/host/` (the note's editor,
// the calendar's input and print raster) — so the Node oracle imports every world half whole and a kind's laws run in Node, as
// they did in the desk. The cruiser holds the import half (`objects-dom-half-is-its-objects`: only a kind's object declaration
// reaches its host/); this is the API half — the desk's law (desk/test/dom-touch.ts, ONE regex for both packages) over this one.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { code, DOM_TOUCH } from "../../desk/test/dom-touch";

const src = resolve(import.meta.dirname, "../src");

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith(".ts")) yield p;
  }
}

/** A kind's DOM half: a file under its folder's `host/`. */
const isHost = (rel: string): boolean => /^[^/]+\/host\//.test(rel);

describe("objects-dom-free (design-016 K4b)", () => {
  it("nothing under src/ outside a kind's host/ touches the DOM at run time", () => {
    const offenders: string[] = [];
    let read = 0;
    for (const p of files(src)) {
      const rel = relative(src, p);
      if (isHost(rel) || rel === "shaders.gen.ts") continue;
      read += 1;
      code(readFileSync(p, "utf8")).split("\n").forEach((line, i) => { if (DOM_TOUCH.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`); });
    }
    expect(read).toBeGreaterThan(60);   // live: the walk reaches the six kinds' world halves
    expect(offenders).toEqual([]);
  });

  it("a host half DOES touch it — the calendar's print raster makes its canvas and its 2D context — so the regex is live here", () => {
    const touches = code(readFileSync(join(src, "calendar/host/print.ts"), "utf8")).split("\n").filter((l) => DOM_TOUCH.test(l));
    expect(touches.some((l) => /new\s+OffscreenCanvas/.test(l))).toBe(true);
    expect(touches.some((l) => /getContext\s*\(/.test(l))).toBe(true);
  });
});
