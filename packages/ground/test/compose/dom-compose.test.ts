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

/**
 * The content ELEMENT per entity — a stable object, as the dom reflector's is, because the writer's
 * record is keyed by it (D-C4.8). `mount` is what a remount does: a NEW element under the same
 * entity id, which is what a React remount hands the same card.
 */
function rig() {
  const els = new Map<Entity, { style: FakeStyle }>();
  const alive = new Set<Entity>();
  const mount = (e: Entity): { style: FakeStyle } => { const el = { style: {} as FakeStyle }; els.set(e, el); alive.add(e); return el; };
  const contentOf = (e: Entity): HTMLElement | undefined => (alive.has(e) ? (els.get(e) as unknown as HTMLElement) : undefined);
  const writer = createDomHostWriter(shellProgram, contentOf);
  const card = { centre: [100, 60] as const, contentHalf: [100, 60] as const };
  const rest = resolveShell(card, REST);
  const held = resolveShell(card, { ...REST, held: 1, lift: 1.02 });
  const entry = (entity: Entity, G = rest, target: HostEntry["target"] = "dom"): HostEntry => ({ entity, G, w: 200, h: 120, target });
  return { els, alive, mount, writer, rest, held, entry, style: (e: Entity) => els.get(e)?.style ?? {} };
}

describe("DomCompose · the writer's target rule", () => {
  it("writes the lift and the hold onto a dom target, and NOTHING of either onto a gpu target", () => {
    const r = rig();
    const e = 7 as Entity;
    r.mount(e);
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
    r.mount(e);
    r.writer.write([r.entry(e, r.rest, "dom")]);
    expect(r.style(e).transform).toBeUndefined();
    expect(r.style(e).opacity).toBeUndefined();
  });

  it("drops its record of a card that is gone — the ELEMENT holds it, so it goes with the element", () => {
    const r = rig();
    const e = 11 as Entity;
    r.mount(e);
    expect(r.writer.write([r.entry(e)])).toBeGreaterThan(0); // origin + clip
    expect(r.writer.write([r.entry(e)])).toBe(0);
    r.alive.delete(e);
    r.writer.write([]); // the card is gone: nothing to write, and nothing to sweep
    r.mount(e); // a new element for a new card under the same id
    expect(r.writer.write([r.entry(e)])).toBeGreaterThan(0); // written afresh: nothing was remembered
  });

  // D-C4.8. The cache is what makes the write change-only, and B9 made it authoritative for the
  // transform and the opacity too — so an entity-keyed record survived a REMOUNT and suppressed
  // all three on the new element. The card was then unclipped, unlifted and unfaded for good.
  it("a REMOUNTED content element gets its boundary — the record is the element's, not the entity's", () => {
    const r = rig();
    const e = 5 as Entity;
    const a = r.mount(e);
    r.writer.write([r.entry(e, r.held, "dom")]);
    expect(a.style.clipPath).toMatch(/^polygon\(/);
    expect(a.style.transform).toBe(`scale(${r.held.scale.toFixed(5)})`);
    expect(a.style.opacity).toBe(r.held.frameAlpha.toFixed(4));

    // the same entity, a NEW element (React remounted the card's content) — with the same geometry,
    // so nothing about the card changed and the cache is the only thing that could refuse the write
    const b = r.mount(e);
    expect(b).not.toBe(a);
    const writes = r.writer.write([r.entry(e, r.held, "dom")]);
    expect(b.style.transformOrigin).toBe("50% 50%");
    expect(b.style.clipPath).toBe(a.style.clipPath);
    expect(b.style.transform).toBe(`scale(${r.held.scale.toFixed(5)})`);
    expect(b.style.opacity).toBe(r.held.frameAlpha.toFixed(4));
    expect(writes).toBe(4); // origin, clip, transform, opacity — every one of them, on the new element
  });
});
