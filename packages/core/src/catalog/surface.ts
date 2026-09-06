/**
 * Presentation vocabulary — the surface FACTS every widget carries in the world
 * (design-013 §5, added at A1a).
 *
 * ── The facts-vs-flux law (§3) ─────────────────────────────────────────────
 * design-013 amends design-002 §5 and design-004 §7 to let presentation facts
 * live in the world, and the older law that bounds the amendment is design-001
 * §7, unchanged: no per-frame component add/remove, no per-widget screen-space
 * recompute on pan, no render-loop ECS writes. A pan stays O(1) — the camera is
 * one transform per plane — and every write pays a stamping tax for the world's
 * life, because a reflector arms reactivity permanently. So the split is:
 *
 *   IN THE WORLD — DISCRETE facts, written CHANGE-ONLY, on events: which layer
 *   the kind chose, the cadence it requested, the band it holds, the effective
 *   demand after the clamp, the texture allocation, retention.
 *
 *   OUTSIDE THE WORLD — CONTINUOUS and HIGH-RATE state: paint and arrival dirt,
 *   lift eases, the card springs (reveal · hover · press · lock),
 *   camera-derived placement, per-slot residency STATUS. Those are runtime side
 *   tables owned by the profile and consumed by its reflectors; none of them
 *   belongs here, and putting one here is the defect, not an optimisation.
 *
 * ── One writer each (§5) ───────────────────────────────────────────────────
 * "One writer" is per component AND per entity — an entity has one kind, and
 * that kind's behaviour is the sole writer of its choice components:
 *
 *   SurfaceKind      the widget type, stamped once at equip     never changes
 *   SurfaceTarget    the KIND'S BEHAVIOUR (the door)            whenever it says
 *   RequestedDemand  the kind's behaviour / the app             on policy
 *   SurfaceDemand    the Demand system (the infra clamp)        Visible/Culled ∧ requested
 *   SurfaceBand      the Band system (infra)                    octave crossing
 *   TextureRef       the Residency system (infra)               allocate / re-slot / retire
 *   Retained         the nav crossfade                          crossfade begin / end
 *
 * A second writer of any row is the "two writers of one number" class the zoom
 * drift belonged to (§7). The infra trio runs in `present:infra`, its own
 * sub-phase AFTER every kind behaviour has spoken (D1) — a settle point, so a
 * pack's behaviour registered long after boot still reaches the clamp in the
 * same frame it writes.
 *
 * ── Why these are stamped at EQUIP, with these defaults (D2) ──────────────
 * design-001 §7 forbids interaction-rate component add/remove, and a
 * promote/demote cycle per drag would move the card's archetype twice per
 * gesture. So all six land ONCE, from the equip system — the capability-tag
 * path, a runtime rider, never durable — and are VALUE-written thereafter.
 * Equip stamps the prefab's default, which makes it not a second writer but the
 * `SnapState` discipline restated: essential at spawn, zeroed, so writers never
 * race an attach.
 *
 * Every default is the SAFE side — the state that claims nothing:
 *
 *   SurfaceKind.kind = the widget type's own `surface` (a fact, not a default)
 *   SurfaceTarget.target = by kind: `dom` → dom, everything else → gpu, which
 *     is the only target a gl or video card HAS (see `effectiveTarget`)
 *   RequestedDemand = live/60/false — a kind that has said nothing wants what
 *     it would have got before demand existed
 *   SurfaceDemand = paused/0/false — the CLAMP starts owing nothing. A card is
 *     not visible until cull says so, and a default of live would upload a
 *     board's worth of pixels for the frame between equip and the first clamp
 *   SurfaceBand.band = 0 — "never banded". Not band 1: 1 is a real band the
 *     hysteresis would then hold, and a card would sit at the wrong resolution
 *     rather than obviously at none
 *   TextureRef.texture = 0 = {@link NO_TEXTURE} — "no destination", the
 *     `NO_ENTITY` precedent (catalog/gesture.ts). §5's "ABSENT = no
 *     destination" and §6.4's "a dom card with SurfaceTarget = dom holds none"
 *     both read as `texture === 0`, because the component is never absent.
 */
import { enumOf, field } from "@vibecook/strata-ecs";
import { defineComponent, defineTag } from "../schema/meta";

/**
 * The kind of pixels this widget has — the widget type's declared `surface`,
 * stamped at equip. Static: a type does not change kind at runtime, and the
 * prefab must not carry it (the prefab is durable, and the kind is derivable
 * from `PrefabId → widgets.get(type).surface`, so putting it in the document
 * would sync a fact every peer can compute — D4).
 *
 * `video` never arrives from `defineWidget` (whose `surface` is `dom | gl`); it
 * comes from a producer that registers a stable texture.
 */
export const SurfaceKind = defineComponent("SurfaceKind", {
  kind: field(enumOf(["dom", "gl", "video"]), { default: "dom" }),
});

/**
 * Which layer presents this card RIGHT NOW — the kind behaviour's choice, and
 * the only thing that swaps when a card promotes (the chrome does not: one
 * frame pass draws it always, §7).
 *
 * Read it through {@link effectiveTarget}, never raw: a non-dom kind has no dom
 * mode at all, and the coercion lives in one function so no reader has to
 * remember (D5).
 */
export const SurfaceTarget = defineComponent("SurfaceTarget", {
  target: field(enumOf(["dom", "gpu"]), { default: "dom" }),
});

/**
 * What the kind ASKS for. Two components on purpose (§5): a request the kind
 * owns, and a clamp infra owns, so "what did this card want" survives being
 * off-screen and does not have to be reconstructed when it comes back.
 *
 * `mode` is here as well as on the clamp because a kind must be able to request
 * PAUSED — the old `picture` mode is `alwaysGpu.with({ paused: true })`, and
 * picture is not a mode (D3, §5).
 */
export const RequestedDemand = defineComponent("RequestedDemand", {
  mode: field(enumOf(["live", "paused"]), { default: "live" }),
  fpsBucket: field("u8", { default: 60 }),
  interactive: field("bool", { default: false }),
});

/**
 * The effective demand after the clamp — `foldDemand(requested, facts)`,
 * verbatim, from `surface/contract.ts` (the plain shape there is
 * `SurfaceDemandValue`; D3). Culled ⇒ paused ⇒ the producer stops capturing,
 * which is what makes an off-screen animating card genuinely free rather than
 * merely cheap.
 */
export const SurfaceDemand = defineComponent("SurfaceDemand", {
  mode: field(enumOf(["live", "paused"]), { default: "paused" }),
  fpsBucket: field("u8", { default: 0 }),
  interactive: field("bool", { default: false }),
});

/**
 * The zoom band this card's pixels are held at — a power of two from
 * `ZOOM_BANDS`, changed only when the live zoom leaves `[band × 0.5, band × 2]`.
 * `0` means NEVER BANDED, which is both the equip default and the standing
 * state of every card that does not present on the GPU.
 *
 * It is the residency retention key under BOTH raster strategies (§6.2) — the
 * strategy changes what is rastered (`kernel/surface-geometry.ts`), never how
 * the slot is keyed.
 */
export const SurfaceBand = defineComponent("SurfaceBand", {
  band: field("f32", { default: 0 }),
});

/**
 * Where this card's pixels live — a runtime-local handle into the profile's
 * texture table, plus the sub-rect inside it.
 *
 * `texture === 0` ({@link NO_TEXTURE}) is "no destination". The component is
 * present from equip and never removed, so the design's "ABSENT" is read as
 * this sentinel; `layer` and the uv are meaningless while it holds.
 *
 * The uv is `written` mapped into the layer — from the SAME `geometry()` call
 * that gave the copy size, which is the whole point (§7 row one).
 */
export const TextureRef = defineComponent("TextureRef", {
  texture: field("u32", { default: 0 }),
  layer: field("u16", { default: 0 }),
  u0: field("f32", { default: 0 }),
  v0: field("f32", { default: 0 }),
  u1: field("f32", { default: 0 }),
  v1: field("f32", { default: 0 }),
});

/**
 * Held across a nav crossfade — the ONE tag that replaces both pools' pin
 * refcounts (§4). Residency's LRU never evicts a `Retained` key, and a retained
 * card keeps its slot while it is culled.
 *
 * Written by the nav crossfade (B7). A2 honours it; nothing in Phase A sets it.
 */
export const Retained = defineTag("Retained");

/** `TextureRef.texture` sentinel: no destination. The `NO_ENTITY` precedent. */
export const NO_TEXTURE = 0;

/**
 * The target a card ACTUALLY presents on, given its kind (D5).
 *
 * A `gl` island and a `video` surface ARE GPU textures — they have no live-DOM
 * mode to fall back to, and design-012 plan §2 gives them empty L1 hosts
 * precisely because there is nothing to paint natively. `SurfaceKind` therefore
 * refuses `dom` for them, and it refuses it HERE, in one function every reader
 * goes through (Band, Demand, Residency, `domWidgets`, the surface view), rather
 * than as a per-kind gate in the behaviours framework — which has no such gate,
 * and adding one is not this design's business.
 *
 * Production coerces and never blanks; the Band system carries the dev throw
 * that names the entity, its kind and the offending value, so the mistake is
 * loud where a developer can see it and harmless where a user is.
 */
export function effectiveTarget(
  kind: "dom" | "gl" | "video",
  target: "dom" | "gpu",
): "dom" | "gpu" {
  return kind === "dom" ? target : "gpu";
}
