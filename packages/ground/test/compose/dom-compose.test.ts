// @vitest-environment node
// The DOM boundary's writer (B3b), and its target rule (B9 review blocker 3): the lift and the hold
// are written onto a `dom` target's content element and NEVER onto a `gpu` target's — that raster is
// copied from the element and the ground applies both to the sample, so a write here is applied twice,
// and the per-frame transform write paints the L1 source canvas past DomRender's self-write guard.
import type { Entity } from "@ice/core";
import { describe, expect, it } from "vitest";
import { REST, resolveShell } from "../../src/card/geometry";
import { shellProgram } from "../../src/card/program";
import { createDomHostWriter, type HostEntry } from "../../src/compose/dom-compose";

interface FakeStyle { transformOrigin?: string; clipPath?: string; transform?: string; opacity?: string }

function rig() {
  const styles = new Map<Entity, FakeStyle>();
  const alive = new Set<Entity>();
  const contentOf = (e: Entity): HTMLElement | undefined => {
    if (!alive.has(e)) return undefined;
    let s = styles.get(e);
    if (s === undefined) { s = {}; styles.set(e, s); }
    return { style: s } as unknown as HTMLElement;
  };
  const writer = createDomHostWriter(shellProgram, contentOf, (e) => alive.has(e));
  const card = { centre: [100, 60] as const, contentHalf: [100, 60] as const };
  const rest = resolveShell(card, REST);
  const held = resolveShell(card, { ...REST, held: 1, lift: 1.02 });
  const entry = (entity: Entity, G = rest, target: HostEntry["target"] = "dom"): HostEntry => ({ entity, G, w: 200, h: 120, target });
  return { styles, alive, writer, rest, held, entry, style: (e: Entity) => styles.get(e) ?? {} };
}

describe("DomCompose · the writer's target rule", () => {
  it("writes the lift and the hold onto a dom target, and NOTHING of either onto a gpu target", () => {
    const r = rig();
    const e = 7 as Entity;
    r.alive.add(e);
    expect(r.held.scale).not.toBe(1);
    expect(r.held.frameAlpha).not.toBe(1);
    r.writer.write([r.entry(e, r.held, "dom")]);
    expect(r.style(e).transform).toBe(`scale(${r.held.scale.toFixed(5)})`);
    expect(r.style(e).opacity).toBe(r.held.frameAlpha.toFixed(4));
    expect(r.style(e).clipPath).toMatch(/^polygon\(/);
    // promoted: the same geometry on a gpu target CLEARS both — the ground applies them to the sample
    const writes = r.writer.write([r.entry(e, r.held, "gpu")]);
    expect(r.style(e).transform).toBe("");
    expect(r.style(e).opacity).toBe("");
    expect(r.style(e).clipPath).toMatch(/^polygon\(/); // the shape is still the DOM's to cut
    expect(writes).toBe(2);
    // and nothing more while it stays promoted and lifted: no per-frame transform write to dirty the L1 canvas
    expect(r.writer.write([r.entry(e, r.held, "gpu")])).toBe(0);
    // demoted: restored
    r.writer.write([r.entry(e, r.held, "dom")]);
    expect(r.style(e).transform).toBe(`scale(${r.held.scale.toFixed(5)})`);
  });

  it("a card at rest on a dom target carries no transform and no opacity either", () => {
    const r = rig();
    const e = 3 as Entity;
    r.alive.add(e);
    r.writer.write([r.entry(e, r.rest, "dom")]);
    expect(r.style(e).transform).toBeUndefined();
    expect(r.style(e).opacity).toBeUndefined();
  });

  it("drops its record of a card that is gone, on its own tick (the entity-keyed store's sweep)", () => {
    const r = rig();
    const e = 11 as Entity;
    r.alive.add(e);
    expect(r.writer.write([r.entry(e)])).toBeGreaterThan(0); // origin + clip
    expect(r.writer.write([r.entry(e)])).toBe(0);
    r.alive.delete(e);
    r.writer.write([]); // the sweep
    r.alive.add(e);
    r.styles.delete(e); // a new element for a new card under the same id
    expect(r.writer.write([r.entry(e)])).toBeGreaterThan(0); // written afresh: nothing was remembered
  });
});
