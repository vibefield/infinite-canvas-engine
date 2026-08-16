/**
 * `defineBehavior` — definition, validation, and the process-global registry
 * (design-009 §4.1).
 *
 * Compile output is one generated component per behavior (`behavior:<name>`),
 * which is also the CONFLICT UNIT: one behavior = one component = one
 * committer-wins cell. The guidance line for authors, worth repeating here
 * because it is the rule that keeps collaboration sane: *would two peers
 * plausibly edit these fields concurrently? Then they are two behaviors.*
 *
 * Everything in this file is definition-time. The compiler (compile.ts) owns
 * the checks that need a populated world — above all the durable-eligibility
 * refusal, which cannot run here: at module-eval time the prefab registry may
 * not yet hold the widget whose Position the behavior writes, and a check that
 * depends on import order is a check that reports differently on a good day.
 */
import type { Component, Relation, Resource, Tag } from "@vibecook/strata-ecs";
import { devGuardsEnabled } from "../guards/dev";
import { ensureComponent, schemaMeta } from "../schema/meta";
import {
  defaultValueOf,
  type JsonShape,
  type JsonSpec,
  type PropSpec,
} from "../widget/props";
import { isPublicRead } from "./public-reads";
import { field } from "@vibecook/strata-ecs";
import { enumOf } from "@vibecook/strata-ecs";
import {
  BEHAVIOR_DEFAULT_PHASE,
  BEHAVIOR_PHASES,
  type AnyBehaviorDef,
  type BehaviorDescription,
  type BehaviorHandle,
  type BehaviorHookName,
  type BehaviorHooks,
  type BehaviorPropDescription,
  type BehaviorRead,
  type BehaviorSchema,
  type BehaviorSpec,
  type BehaviorStore,
  type DataOf,
} from "./types";

const STORES: readonly BehaviorStore[] = ["durable", "runtime", "ephemeral"];

/**
 * `<namespace>:<name>` — exactly one colon, both halves non-empty, and no
 * whitespace. The namespace is what a plugin host validates against the
 * declaring plugin id (the harness precedent): without that check two
 * colliding same-shape names would silently share one component with BOTH
 * hook sets running.
 */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The generated component's name. Prefixed so a behavior can never collide
 * with `defineWidget`'s `<type>:<group>` components — and, because this string
 * is the DURABLE key that projection is driven by, it is a permanent wire
 * format decision, not an implementation detail. A collision anywhere is loud
 * (`ensureComponent` throws on same-name/different-shape), never silent.
 */
export function behaviorComponentName(name: string): string {
  return `behavior:${name}`;
}

const registry = new Map<string, AnyBehaviorDef>();
const byComponent = new Map<Component, AnyBehaviorDef>();

export const behaviors = {
  get(name: string): AnyBehaviorDef | undefined {
    return registry.get(name);
  },
  all(): AnyBehaviorDef[] {
    return [...registry.values()];
  },
  /** The behavior that owns a generated data component, if any. */
  forComponent(c: Component): AnyBehaviorDef | undefined {
    return byComponent.get(c);
  },
  /** Is `c` a behavior's own data component? (the BF-D6 eligibility branch). */
  isBehaviorComponent(c: Component): boolean {
    return byComponent.has(c);
  },
};

// --- reads classification ----------------------------------------------------

export type ReadKind = "component" | "tag" | "relation" | "resource" | "behavior";

/**
 * Classify a `reads:` entry. Handles are opaque and structurally ambiguous
 * (Component and Resource have IDENTICAL shapes), so classification goes
 * through ICE's own schema registries — which doubles as the §4.1 rule that
 * reads must name REGISTERED schema: anything defined outside the `@ice/core`
 * wrappers is unclassifiable here and is rejected rather than guessed at.
 */
export function classifyRead(r: BehaviorRead): { kind: ReadKind; name: string } | undefined {
  if (typeof r === "object" && r !== null && (r as AnyBehaviorDef).__behavior === true) {
    return { kind: "behavior", name: (r as AnyBehaviorDef).name };
  }
  const c = schemaMeta.component(r as Component);
  if (c !== undefined) return { kind: "component", name: c.name };
  const t = schemaMeta.tagName(r as Tag);
  if (t !== undefined) return { kind: "tag", name: t };
  const rel = schemaMeta.relation(r as Relation);
  if (rel !== undefined) return { kind: "relation", name: rel.name };
  const res = schemaMeta.resource(r as Resource);
  if (res !== undefined) return { kind: "resource", name: res.name };
  return undefined;
}

/** The read component a `reads:` entry contributes, if it contributes one. */
export function readComponentOf(r: BehaviorRead): Component | undefined {
  if (typeof r === "object" && r !== null && (r as AnyBehaviorDef).__behavior === true) {
    return (r as AnyBehaviorDef).component as Component;
  }
  return schemaMeta.component(r as Component) !== undefined ? (r as Component) : undefined;
}

// --- schema compilation ------------------------------------------------------

function strataFieldOf(behavior: string, name: string, spec: PropSpec) {
  switch (spec.kind) {
    case "string":
      return field("string", { default: spec.default ?? "" });
    case "entityKey":
      return field("string", { default: spec.default ?? "" });
    case "number":
      return field("f64", { default: spec.default ?? 0 });
    case "boolean":
      return field("bool", { default: spec.default ?? false });
    case "enum": {
      const fallback = spec.default ?? spec.options[0] ?? "";
      return field(enumOf([...spec.options]), { default: fallback });
    }
    case "json":
      return field("string", { default: (spec as JsonSpec).default ?? "null" });
    default:
      throw new Error(
        `ice: defineBehavior("${behavior}") field "${name}" is not a p.* spec — behavior data is declared with the same DSL as widget props.`,
      );
  }
}

/** The whole-value default record (the attach fill; also the cell defaults). */
function defaultsOf(schema: BehaviorSchema): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, spec] of Object.entries(schema)) out[name] = defaultValueOf(spec);
  return out;
}

// --- the definition-shape signature (re-definition compare) ------------------

/**
 * What "the same declaration" means for the ensure-cache. Hooks are
 * DELIBERATELY excluded: a hot reload hands us new function identities for the
 * same behavior, and refusing that would make HMR throw — so a matching
 * signature refreshes the hooks on the cached handle instead (see below).
 */
function signatureOf(spec: BehaviorSpec<BehaviorStore, BehaviorSchema>, phase: string): string {
  const schema = spec.schema ?? {};
  return JSON.stringify({
    store: spec.store,
    derived: spec.derived === true,
    deriveDuringGesture: spec.deriveDuringGesture === true,
    version: spec.version ?? 1,
    phase,
    tickWhile: spec.tick?.while ?? "all",
    // Field ORDER is part of the shape: it is the generated component's column
    // order, which the durable cell layout depends on.
    schema: Object.entries(schema).map(([k, s]) => [k, s.kind, defaultValueOf(s)]),
    reads: (spec.reads ?? []).map((r) => classifyRead(r)?.name ?? "<unregistered>"),
    writes: (spec.writes ?? []).map((c) => schemaMeta.component(c)?.name ?? "<unregistered>"),
    migrate: Object.keys(spec.migrate ?? {}).sort(),
  });
}

const signatures = new Map<string, string>();

// --- validation --------------------------------------------------------------

function fail(name: string, message: string): never {
  throw new Error(`ice: defineBehavior("${name}") — ${message}`);
}

function validate(name: string, spec: BehaviorSpec<BehaviorStore, BehaviorSchema>, phase: string): void {
  if (!NAME_RE.test(name)) {
    fail(
      name,
      'names are "<namespace>:<name>" (letters, digits, dot, dash, underscore; exactly one colon) — the namespace is what a plugin host validates against the declaring plugin id.',
    );
  }
  if (!STORES.includes(spec.store)) {
    fail(name, `store must be one of ${STORES.join(" | ")} — it is REQUIRED and it routes everything (§3).`);
  }

  const durableOnly: readonly [string, unknown][] = [
    ["derived", spec.derived],
    ["version", spec.version],
    ["migrate", spec.migrate],
  ];
  if (spec.store !== "durable") {
    for (const [key, value] of durableOnly) {
      if (value !== undefined) {
        fail(name, `"${key}" is durable-only — a ${spec.store} behavior has no document cells to derive, version, or migrate.`);
      }
    }
  }
  if (spec.deriveDuringGesture !== undefined && spec.derived !== true) {
    fail(name, '"deriveDuringGesture" opts OUT of claim-scoped suppression, which only derived behaviors are subject to (§5.3).');
  }

  const legal = BEHAVIOR_PHASES[spec.store];
  if (!legal.includes(phase as (typeof legal)[number])) {
    fail(
      name,
      `phase "${phase}" is not legal for a ${spec.store} behavior — legal: ${legal.join(" | ")}.${
        spec.store === "durable"
          ? " Durable is derive-only because its sole write path is transactional and derive is the settled-input phase (§3)."
          : ""
      }`,
    );
  }

  if (spec.budgetMs !== undefined && (!Number.isFinite(spec.budgetMs) || spec.budgetMs <= 0)) {
    fail(name, `budgetMs must be a positive number (got ${String(spec.budgetMs)}).`);
  }

  // Schema: every field must be a recognized p.* spec. That single check
  // carries two of the design's rules for free — the DSL has no `eid` spec at
  // all (Law 7's ban is structural, not policed), and every spec kind yields a
  // default (`defaultValueOf` is total), so "every field defaulted" holds by
  // construction rather than by inspection.
  for (const [fieldName, s] of Object.entries(spec.schema ?? {})) {
    if (fieldName.length === 0) fail(name, "schema field names must be non-empty.");
    if (typeof s !== "object" || s === null || typeof (s as PropSpec).kind !== "string") {
      fail(name, `schema field "${fieldName}" is not a p.* spec (use p.string/number/boolean/enum/json/entityKey).`);
    }
    if ((s as PropSpec).kind === "json" && (s as JsonSpec).inner === undefined) {
      fail(name, `schema field "${fieldName}" is a p.json with no declared shape — json cells are BOUNDED, never free-form.`);
    }
  }

  for (const r of spec.reads ?? []) {
    const kind = classifyRead(r);
    if (kind === undefined) {
      fail(
        name,
        "every reads: entry must be a component, tag, relation, resource, or behavior defined through @ice/core — an unregistered handle cannot be routed to a change mechanism.",
      );
    }
    // The engine catalog is exposed DELIBERATELY (design-009 §9): the curated
    // list is a published contract, everything else is engine vocabulary whose
    // shape moves whenever the interaction stack does. Warn rather than throw —
    // engine-grade code legitimately reaches past the list, and turning that
    // into an error would make the escape hatch a wall.
    if (kind.kind !== "behavior" && !isPublicRead(r as Component)) {
      console.warn(
        `ice: defineBehavior("${name}") reads "${kind.name}", which is not on the published behavior read surface (design-009 §9). It works, but its shape is engine vocabulary and may change without notice.`,
      );
    }
  }
  for (const c of spec.writes ?? []) {
    if (schemaMeta.component(c) === undefined) {
      fail(name, "every writes: entry must be a component defined through @ice/core (tags and relations are not value-write targets).");
    }
  }
  if (spec.store === "ephemeral" && (spec.writes?.length ?? 0) > 0) {
    fail(
      name,
      "an ephemeral behavior writes only its OWN facet through ctx.write(patch) — it has no cross-entity write vocabulary (strata's eph partition is absolute: every mutator refuses entities this peer did not mint).",
    );
  }

  for (const [hook, fn] of Object.entries(spec.on ?? {})) {
    if (typeof fn !== "function") fail(name, `hook "${hook}" is not a function.`);
  }
  if (spec.tick?.while !== undefined && spec.on?.tick === undefined) {
    fail(name, '"tick.while" scopes the tick hook, but no on.tick is declared.');
  }

  // Migration chain: contiguous 1..version-1. Unlike defineWidget (which warns
  // — its docs predate the check), a gap here THROWS: behaviors are a new
  // surface with no legacy chains to be kind to, and a gap means documents at
  // the uncovered version silently keep stale derived state.
  const version = spec.version ?? 1;
  const migrate = spec.migrate ?? {};
  const keys = Object.keys(migrate).map(Number);
  if (keys.length > 0) {
    const gaps: number[] = [];
    for (let v = 1; v < version; v++) if (typeof migrate[v] !== "function") gaps.push(v);
    if (gaps.length > 0) {
      fail(name, `migrate chain has gaps at fromVersion(s) [${gaps.join(", ")}] — docs written there cannot reach v${version}.`);
    }
    const stray = keys.filter((v) => v <= 0 || v >= version);
    if (stray.length > 0) {
      fail(name, `migrate declares transform(s) for fromVersion(s) [${stray.join(", ")}] outside the migratable range 1..${version - 1}.`);
    }
  }
}

// --- defineBehavior ----------------------------------------------------------

function cloneJsonShape(shape: JsonShape): JsonShape {
  switch (shape.kind) {
    case "string":
    case "number":
    case "boolean":
      return { kind: shape.kind };
    case "enum":
      return { kind: "enum", options: [...shape.options] };
    case "array":
      return { kind: "array", item: cloneJsonShape(shape.item) };
    case "object":
      return {
        kind: "object",
        fields: Object.fromEntries(
          Object.entries(shape.fields).map(([name, field]) => [name, cloneJsonShape(field)]),
        ),
      };
  }
}

function describeProp(spec: PropSpec): BehaviorPropDescription {
  switch (spec.kind) {
    case "string":
      return {
        kind: "string",
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case "number":
      return {
        kind: "number",
        ...(spec.default === undefined ? {} : { default: spec.default }),
        ...(spec.min === undefined ? {} : { min: spec.min }),
        ...(spec.max === undefined ? {} : { max: spec.max }),
      };
    case "boolean":
      return {
        kind: "boolean",
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case "enum":
      return {
        kind: "enum",
        options: [...spec.options],
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case "json":
      return {
        kind: "json",
        inner: cloneJsonShape(spec.inner),
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
    case "entityKey":
      return {
        kind: "entityKey",
        ...(spec.default === undefined ? {} : { default: spec.default }),
      };
  }
}

const DESCRIPTION_HOOK_ORDER: readonly BehaviorHookName[] = [
  "init",
  "update",
  "changed",
  "tick",
  "dispose",
];

export function describeBehavior(behavior: AnyBehaviorDef): BehaviorDescription {
  const reads = behavior.reads.map((read) => {
    const description = classifyRead(read);
    if (description === undefined) {
      throw new Error("ice: describeBehavior cannot classify a declared read");
    }
    return description;
  });
  const writes = behavior.writes.map((component) => {
    const meta = schemaMeta.component(component);
    if (meta === undefined) {
      throw new Error("ice: describeBehavior cannot classify a declared write");
    }
    return meta.name;
  });
  return {
    id: behavior.name,
    store: behavior.store,
    derived: behavior.derived,
    deriveDuringGesture: behavior.deriveDuringGesture,
    version: behavior.version,
    phase: behavior.phase,
    ...(behavior.budgetMs === undefined ? {} : { budgetMs: behavior.budgetMs }),
    tickWhile: behavior.tickWhile,
    schema: Object.entries(behavior.schema).map(([name, spec]) => ({
      name,
      spec: describeProp(spec),
    })),
    reads,
    writes,
    migrationFrom: Object.keys(behavior.migrate)
      .map(Number)
      .sort((left, right) => left - right),
    hooks: DESCRIPTION_HOOK_ORDER.filter(
      (hook) => typeof behavior.on[hook] === "function",
    ),
  };
}

export function defineBehavior<const S extends BehaviorStore, const Sch extends BehaviorSchema = BehaviorSchema>(
  name: string,
  spec: BehaviorSpec<S, Sch>,
): BehaviorHandle<DataOf<Sch>> {
  const phase = spec.phase ?? BEHAVIOR_DEFAULT_PHASE[spec.store];
  if (devGuardsEnabled()) validate(name, spec as BehaviorSpec<BehaviorStore, BehaviorSchema>, phase);

  const signature = signatureOf(spec as BehaviorSpec<BehaviorStore, BehaviorSchema>, phase);
  const existing = registry.get(name);
  if (existing !== undefined) {
    if (signatures.get(name) !== signature) {
      throw new Error(
        `ice: defineBehavior("${name}") — a behavior with this name is already defined with a DIFFERENT shape. Behavior names are process-global; namespace yours.`,
      );
    }
    // Same declaration, re-evaluated (hot reload, a test re-importing a
    // module). Reuse the handle — its component, its collector and every
    // attached instance stay valid — but adopt the NEW hooks: keeping the old
    // ones is how a framework ends up running yesterday's code after a reload.
    existing.on = (spec.on ?? {}) as BehaviorHooks<BehaviorStore, unknown>;
    return existing as BehaviorHandle<DataOf<Sch>>;
  }

  const schema = (spec.schema ?? {}) as BehaviorSchema;
  const raw: Record<string, ReturnType<typeof strataFieldOf>> = {};
  for (const [fieldName, s] of Object.entries(schema)) raw[fieldName] = strataFieldOf(name, fieldName, s);
  const component = ensureComponent(behaviorComponentName(name), raw);

  const handle: BehaviorHandle<DataOf<Sch>> = {
    name,
    namespace: name.slice(0, name.indexOf(":")),
    store: spec.store,
    derived: spec.derived === true,
    deriveDuringGesture: spec.deriveDuringGesture === true,
    version: spec.version ?? 1,
    phase,
    budgetMs: spec.budgetMs,
    schema,
    component: component as Component<Record<string, string | number | boolean>>,
    defaults: defaultsOf(schema) as unknown as Readonly<DataOf<Sch>>,
    reads: spec.reads ?? [],
    writes: spec.writes ?? [],
    migrate: spec.migrate ?? {},
    tickWhile: spec.tick?.while ?? "all",
    on: (spec.on ?? {}) as BehaviorHooks<BehaviorStore, DataOf<Sch>>,
    with(data) {
      return { behavior: handle, data };
    },
    __behavior: true,
  };

  registry.set(name, handle as AnyBehaviorDef);
  byComponent.set(component, handle as AnyBehaviorDef);
  signatures.set(name, signature);
  return handle;
}

/**
 * TEST-ONLY registry wipe (mirrors `__resetPrefabsForTests`; deliberately NOT
 * on the barrel). strata's schema registry has no reset, so a test that wipes
 * this must still use file-unique behavior names.
 */
export function __resetBehaviorsForTests(): void {
  registry.clear();
  byComponent.clear();
  signatures.clear();
}
