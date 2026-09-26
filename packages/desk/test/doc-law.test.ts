// @vitest-environment node
// THE DOCUMENT'S DOORS (D7 #1, #9): the desk commits into a document only through `writable(docs)` (objects/typing.ts — the
// version gate's verdict asked at every write surface) and core's guardedTransaction / setWidgetProps; its history moves only
// through the facade's `docs.undo` / `docs.redo` (`historyStep`: the tween retarget, the read-only posture). Strata's store has
// no read-only mode and no law of its own, so a raw `store.undo()`, `store.redo()` or `store.transaction(` anywhere in desk/src
// is a hole in both — the grep a cruiser cannot be (editor-law.test.ts's precedent).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = resolve(import.meta.dirname, "../src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
/** Every line of desk/src whose CODE (its comment stripped) names a raw store history call or a raw store transaction. */
const offenders = (): string[] =>
  walk(src).flatMap((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .map((l, i) => ({ at: `${p.slice(src.length + 1)}:${i + 1}`, code: (l.split("//")[0] ?? "").trim() }))
      .filter((l) => /\.store\.(undo|redo)\(|\.store\.transaction\(/.test(l.code))
      .map((l) => `${l.at}: ${l.code}`),
  );

describe("the document's doors (D7 #1, #9)", () => {
  it("no desk module moves the store's history or opens a raw transaction — the facade's docs.undo/redo and guardedTransaction are the doors", () => {
    expect(walk(src).length).toBeGreaterThan(50);   // live: the walk reaches the sources
    expect(offenders()).toEqual([]);
  });
});
