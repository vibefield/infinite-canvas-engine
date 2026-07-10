/**
 * The engine props DSL (design-005 §2, amending design-001 §5.2).
 *
 * Standard Schema is validation-only — it exposes `validate()` but no
 * introspectable shape, so arbitrary schemas cannot compile to typed
 * components. This DSL is the compiler's input: it (a) maps 1:1 onto strata
 * field types plus explicit `p.json` string cells, (b) implements the
 * Standard Schema v1 interface so it plugs into ecosystem tooling, and
 * (c) enforces the definition-time rules — every top-level field defaulted
 * (json derives an empty default from its root shape), enums additive-only
 * across versions (checked by the M9 migrator against pack history; recorded
 * here), `p.json` as the ONLY nesting escape hatch (visibly conflict-coarse:
 * one string cell, last-writer-wins whole-value).
 */

// --- Standard Schema v1 (interface only — no runtime dependency) ---

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => { value: Output } | { issues: readonly { message: string }[] };
  };
}

// --- spec kinds ---

export type PropSpec =
  | StringSpec
  | NumberSpec
  | BooleanSpec
  | EnumSpec
  | JsonSpec;

export interface StringSpec extends StandardSchemaV1<unknown, string> {
  readonly kind: "string";
  readonly default?: string;
}
export interface NumberSpec extends StandardSchemaV1<unknown, number> {
  readonly kind: "number";
  readonly default?: number;
  readonly min?: number;
  readonly max?: number;
}
export interface BooleanSpec extends StandardSchemaV1<unknown, boolean> {
  readonly kind: "boolean";
  readonly default?: boolean;
}
export interface EnumSpec extends StandardSchemaV1<unknown, string> {
  readonly kind: "enum";
  readonly options: readonly string[];
  readonly default?: string;
}
/** One conflict-coarse string cell; `inner` validates the PARSED value. */
export interface JsonSpec extends StandardSchemaV1<unknown, unknown> {
  readonly kind: "json";
  readonly inner: JsonShape;
  /** Serialized default (derived from the inner root when not given). */
  readonly default?: string;
}

/** Shapes legal only INSIDE p.json (validation-only, never components). */
export type JsonShape =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "enum"; readonly options: readonly string[] }
  | { readonly kind: "array"; readonly item: JsonShape }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, JsonShape>> };

export interface ObjectSpec {
  readonly kind: "object";
  readonly fields: Readonly<Record<string, PropSpec>>;
}

// --- validators ---

function fail(message: string): { issues: readonly { message: string }[] } {
  return { issues: [{ message }] };
}

function validateShape(shape: JsonShape, v: unknown, path: string): { message: string } | null {
  switch (shape.kind) {
    case "string":
      return typeof v === "string" ? null : { message: `${path}: expected string` };
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : { message: `${path}: expected number` };
    case "boolean":
      return typeof v === "boolean" ? null : { message: `${path}: expected boolean` };
    case "enum":
      return typeof v === "string" && shape.options.includes(v)
        ? null
        : { message: `${path}: expected one of ${shape.options.join("|")}` };
    case "array": {
      if (!Array.isArray(v)) return { message: `${path}: expected array` };
      for (let i = 0; i < v.length; i++) {
        const err = validateShape(shape.item, v[i], `${path}[${i}]`);
        if (err) return err;
      }
      return null;
    }
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return { message: `${path}: expected object` };
      }
      for (const [k, f] of Object.entries(shape.fields)) {
        const err = validateShape(f, (v as Record<string, unknown>)[k], `${path}.${k}`);
        if (err) return err;
      }
      return null;
    }
  }
}

function std<T>(validate: (v: unknown) => { value: T } | { issues: readonly { message: string }[] }) {
  return { version: 1 as const, vendor: "ice", validate };
}

/** Empty value for a json root shape (the derived default). */
function emptyOf(shape: JsonShape): unknown {
  switch (shape.kind) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "enum":
      return shape.options[0];
    case "array":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(shape.fields)) out[k] = emptyOf(f);
      return out;
    }
  }
}

// --- the public DSL ---

export const p = {
  string(opts: { default?: string } = {}): StringSpec {
    return {
      kind: "string",
      ...(opts.default !== undefined ? { default: opts.default } : {}),
      "~standard": std((v) => (typeof v === "string" ? { value: v } : fail("expected string"))),
    };
  },

  number(opts: { default?: number; min?: number; max?: number } = {}): NumberSpec {
    return {
      kind: "number",
      ...(opts.default !== undefined ? { default: opts.default } : {}),
      ...(opts.min !== undefined ? { min: opts.min } : {}),
      ...(opts.max !== undefined ? { max: opts.max } : {}),
      "~standard": std((v) => {
        if (typeof v !== "number" || !Number.isFinite(v)) return fail("expected number");
        if (opts.min !== undefined && v < opts.min) return fail(`min ${opts.min}`);
        if (opts.max !== undefined && v > opts.max) return fail(`max ${opts.max}`);
        return { value: v };
      }),
    };
  },

  boolean(opts: { default?: boolean } = {}): BooleanSpec {
    return {
      kind: "boolean",
      ...(opts.default !== undefined ? { default: opts.default } : {}),
      "~standard": std((v) => (typeof v === "boolean" ? { value: v } : fail("expected boolean"))),
    };
  },

  enum(options: readonly string[], opts: { default?: string } = {}): EnumSpec {
    if (options.length === 0) throw new Error("ice: p.enum needs at least one option.");
    if (opts.default !== undefined && !options.includes(opts.default)) {
      throw new Error(`ice: p.enum default "${opts.default}" is not among its options.`);
    }
    return {
      kind: "enum",
      options,
      ...(opts.default !== undefined ? { default: opts.default } : {}),
      "~standard": std((v) =>
        typeof v === "string" && options.includes(v) ? { value: v } : fail(`expected one of ${options.join("|")}`),
      ),
    };
  },

  json(inner: JsonShape, opts: { default?: unknown } = {}): JsonSpec {
    const fallback = opts.default !== undefined ? opts.default : emptyOf(inner);
    const err = validateShape(inner, fallback, "$default");
    if (err) throw new Error(`ice: p.json default does not match its shape — ${err.message}`);
    return {
      kind: "json",
      inner,
      default: JSON.stringify(fallback),
      "~standard": std((v) => {
        const e = validateShape(inner, v, "$");
        return e ? { issues: [e] } : { value: v };
      }),
    };
  },

  // json-only inner shapes (validation, never components):
  array(item: JsonShape): JsonShape {
    return { kind: "array", item };
  },
  object(fields: Readonly<Record<string, JsonShape>>): JsonShape {
    return { kind: "object", fields };
  },
};

/** A widget props declaration: top-level named specs (the compiler's input). */
export type PropsDecl = Readonly<Record<string, PropSpec>>;
