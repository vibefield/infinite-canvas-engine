/**
 * Schema metadata registry (design-001 §2, design-005 §1).
 *
 * Components/tags/relations stay PURE (rev-2 sovereignty) — but prefab
 * validation (eid ban, required-field defaults) and devtools badges need to
 * know what a component's fields look like. strata does not expose schema
 * introspection publicly, so ALL engine + userland definitions go through
 * these thin wrappers: they record the raw schema in a side registry, then
 * delegate to strata unchanged. The returned handles are strata's own.
 */
import {
  defineComponent as strataDefineComponent,
  defineRelation as strataDefineRelation,
  defineResource as strataDefineResource,
  defineTag as strataDefineTag,
  type Component,
  type FieldInput,
  type Relation,
  type Resource,
  type Tag,
} from "@vibecook/strata-ecs";

export type RawSchema = Record<string, FieldInput>;

export interface ComponentMeta {
  name: string;
  schema: RawSchema;
  /** Field names whose type is `eid` (runtime-local handles — banned in durable cells). */
  eidFields: string[];
  /** Field names with no default (strata requires them at spawn). */
  requiredFields: string[];
}

export interface RelationMeta {
  name: string;
  arity: "one" | "many";
}

export interface ResourceMeta {
  name: string;
  /** design-001 §2 rule 7: resources declare durable|runtime at definition. */
  durable: boolean;
}

const componentMeta = new Map<Component, ComponentMeta>();
const componentsByIceName = new Map<string, Component>();
const tagNames = new Map<Tag, string>();
const relationMeta = new Map<Relation, RelationMeta>();
const resourceMeta = new Map<Resource, ResourceMeta>();

function isEidField(input: FieldInput): boolean {
  if (input === "eid") return true;
  return (
    typeof input === "object" &&
    input !== null &&
    (input as { type?: unknown }).type === "eid"
  );
}

function hasDefault(input: FieldInput): boolean {
  // Bare string types ("f32", "string", …) and bare EnumTypes carry no default;
  // field(type, { default }) specs carry a `default` key.
  return typeof input === "object" && input !== null && "default" in input;
}

export function defineComponent<const Sch extends RawSchema>(
  name: string,
  schema: Sch,
): ReturnType<typeof strataDefineComponent<Sch>> {
  const c = strataDefineComponent(name, schema);
  const fields = Object.entries(schema);
  componentMeta.set(c as Component, {
    name,
    schema,
    eidFields: fields.filter(([, f]) => isEidField(f)).map(([k]) => k),
    requiredFields: fields.filter(([, f]) => !hasDefault(f)).map(([k]) => k),
  });
  componentsByIceName.set(name, c as Component);
  return c;
}

/**
 * Reuse-or-define by NAME (design-008 §3.1): strata's schema registry throws
 * on duplicate identifiers (its registry.ts:38), and rename legacy components
 * (`<oldType>:<group>`) can legitimately re-enter the process — a test that
 * defined the old widget before resetting ice registries, or a hot-reload
 * double-eval — while strata's global registry survives. An existing
 * SAME-SHAPED component is the same component: reuse its handle. A mismatched
 * shape under the same name is a real collision: throw. The shape compare is
 * JSON-stringify over the recorded raw schema — sound here because both sides
 * are built by the same `strataFieldOf` constructors in the same field order.
 */
export function ensureComponent<const Sch extends RawSchema>(
  name: string,
  schema: Sch,
): Component {
  const existing = componentsByIceName.get(name);
  if (existing === undefined) return defineComponent(name, schema) as Component;
  const recorded = componentMeta.get(existing);
  if (recorded === undefined || JSON.stringify(recorded.schema) !== JSON.stringify(schema)) {
    throw new Error(`ice: ensureComponent("${name}") — a component with this name exists with a DIFFERENT shape.`);
  }
  return existing;
}

export function defineTag(name: string): Tag {
  const t = strataDefineTag(name);
  tagNames.set(t, name);
  return t;
}

export function defineRelation(
  name: string,
  opts?: { arity?: "one" | "many"; ordered?: boolean },
): Relation {
  const r = strataDefineRelation(name, opts);
  relationMeta.set(r, { name, arity: opts?.arity ?? "one" });
  return r;
}

export function defineResource<const Sch extends RawSchema>(
  name: string,
  schema: Sch,
  opts?: { durable?: boolean },
): ReturnType<typeof strataDefineResource<Sch>> {
  const res = strataDefineResource(name, schema);
  resourceMeta.set(res as Resource, { name, durable: opts?.durable ?? false });
  return res;
}

export const schemaMeta = {
  component(c: Component): ComponentMeta | undefined {
    return componentMeta.get(c);
  },
  tagName(t: Tag): string | undefined {
    return tagNames.get(t);
  },
  relation(r: Relation): RelationMeta | undefined {
    return relationMeta.get(r);
  },
  resource(r: Resource): ResourceMeta | undefined {
    return resourceMeta.get(r);
  },
};
