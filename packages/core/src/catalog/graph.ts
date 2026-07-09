/**
 * Node graph — wires, ports, and containment contracts (design-001 §5.3, §5.8).
 *
 * Wires bind to widgets + port *ids* (durable); port *entities* are runtime and
 * materialize on demand (never per-visible-widget). Wire geometry comes from the
 * kernel's pure `portAnchor(...)`, so rendering never reads a port entity and
 * culled endpoints resolve by construction (design-001 §5.3 decision).
 *
 * Defaults policy (see catalog/index.ts): identity/essential fields a wire or
 * derive system always supplies stay bare (WirePorts.from/to, Port.id/side).
 * Derive-owned anchors and the container JSON lists carry ergonomic defaults.
 */
import { enumOf, field } from "@vibecook/strata-ecs";
import { defineComponent, defineRelation, defineTag } from "../schema/meta";

// --- durable wire prefab: a reified edge entity (relations carry no data) ---

/** Marks an entity as a wire. */
export const Wire = defineTag("Wire");

/** wire → source widget (durable-eligible). */
export const WireFrom = defineRelation("WireFrom", { arity: "one" });

/** wire → target widget (durable-eligible). */
export const WireTo = defineRelation("WireTo", { arity: "one" });

/** The port ids (from each widget's port schema) the wire binds to. */
export const WirePorts = defineComponent("WirePorts", { from: "string", to: "string" });

// --- runtime port prefab: materializes on demand, derive-owned ---

/** A widget port descriptor — spawned only for interaction (connect tool / hover proximity). */
export const Port = defineComponent("Port", {
  id: "string",
  side: enumOf(["n", "e", "s", "w"]),
  index: field("u8", { default: 0 }),
});

/** port → widget. */
export const PortOf = defineRelation("PortOf", { arity: "one" });

/** Derive-owned world coordinates of a port anchor. */
export const PortAnchor = defineComponent("PortAnchor", {
  x: field("f64", { default: 0 }),
  y: field("f64", { default: 0 }),
});

// --- containment contracts (durable-eligible on container widget prefabs, RFC-004) ---

/** Marks a widget as a container (accepts children via the drop system). */
export const Container = defineTag("Container");

/** JSON list of provides-keys this container accepts. */
export const Accepts = defineComponent("Accepts", { list: field("string", { default: "[]" }) });

/** JSON list of provides-keys this widget offers to containers. */
export const Provides = defineComponent("Provides", { list: field("string", { default: "[]" }) });
