/**
 * Scene & geometry catalog (design-001 §5.1).
 *
 * Pure components — "durable-eligible" is a property of the prefab that carries
 * them, never of the component (design-001 §2, rev 2). `Position` is reused by
 * cursor/chrome/pointer-adjacent runtime prefabs; that reuse is the point.
 *
 * Defaults policy (see catalog/index.ts): essential geometry that a prefab
 * always supplies stays bare (required at spawn — Position/Size/StackZ). The
 * optional-eligible `Rotation` carries its identity default so an ad-hoc attach
 * is ergonomic.
 */
import { field } from "@vibecook/strata-ecs";
import { defineComponent, defineRelation } from "../schema/meta";

/** Frame-local position, world units. f64 — the infinite canvas loses integer precision in f32 past ~16.7M. */
export const Position = defineComponent("Position", { x: "f64", y: "f64" });

/** Widget size, world units. f32 — sizes never need f64's range. */
export const Size = defineComponent("Size", { w: "f32", h: "f32" });

/** Optional-eligible rotation, radians. Identity default so a bare attach is ergonomic. */
export const Rotation = defineComponent("Rotation", { r: field("f32", { default: 0 }) });

/** Fractional stacking order — z-reorder is one cell write; midpoints jittered, ties break by key. */
export const StackZ = defineComponent("StackZ", { z: "f64" });

/**
 * child → parent frame (durable-eligible). Replaces the ParentFrame/ContainerChildren triad:
 * children-of-x = `Related(ChildOf, x)`; ancestor walk = forward `getRelation`; engine cascade
 * walks `getReverse(e, ChildOf)` (see ops/cascade.ts).
 */
export const ChildOf = defineRelation("ChildOf", { arity: "one" });
