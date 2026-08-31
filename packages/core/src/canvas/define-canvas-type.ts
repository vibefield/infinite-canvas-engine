/**
 * CanvasType definitions — the semantic/presentation profile for one frame.
 *
 * Definitions are immutable handles. The process registry is discovery and
 * duplicate-id diagnostics only; an EngineCatalog decides which definitions
 * have authority in a particular engine.
 */
import type { Tool } from "../tools/define-tool";
import type { WidgetType } from "../widget/define-widget";
import type {
  CanvasRuntimeExtension,
  CanvasSemanticMigration,
  FrameBehavior,
} from "./extensions";
import type { CanvasPreviewDeclaration } from "./frame-projection";

export interface CanvasPlacementDef {
  /** Exact capability keys matched against normalized WidgetType.provides. */
  readonly accepts?: readonly string[];
  /** Explicit widget handles admitted independently of capability keys. */
  readonly widgets?: readonly WidgetType[];
}

export interface CanvasCatalogSection {
  readonly id: string;
  readonly order?: number;
  readonly items: readonly WidgetType[];
}

export interface CanvasCatalogContribution {
  readonly id: string;
  readonly canvas: CanvasType;
  readonly sections: readonly CanvasCatalogSection[];
}

export interface CanvasTypeDef {
  readonly id: string;
  readonly semanticVersion: number;
  readonly semantic: {
    readonly placement: CanvasPlacementDef;
    readonly frameBehaviors?: readonly FrameBehavior[];
  };
  /** Consecutive, view-independent semantic upgrades into semanticVersion. */
  readonly migrations?: readonly CanvasSemanticMigration[];
  readonly presentation?: {
    readonly catalog?: { readonly sections: readonly CanvasCatalogSection[] };
    readonly tools?: {
      readonly allowed: readonly Tool[];
      readonly default: Tool;
    };
    readonly ground?: {
      readonly program: string;
      readonly wires?: boolean;
      readonly guides?: boolean;
    };
    readonly camera?: {
      readonly arrival?: "fit" | "identity";
      readonly padding?: number;
      readonly minZoom?: number;
      readonly maxZoom?: number;
    };
    readonly runtimeExtensions?: readonly CanvasRuntimeExtension[];
    readonly preview?: CanvasPreviewDeclaration;
  };
}

export interface CanvasType extends CanvasTypeDef {
  readonly __canvasType: true;
}

export interface CanvasTypeIdentity {
  readonly id: string;
  readonly semanticVersion: number;
}

export const ROOT_CANVAS_META_KEY = "ice:rootCanvas";

/** Existing pack-gate namespace reserved for CanvasType semantics. */
export function canvasPackId(id: string): string {
  return `@ice/canvas/${id}`;
}

export function canvasIdentityOf(type: CanvasType): CanvasTypeIdentity {
  return { id: type.id, semanticVersion: type.semanticVersion };
}

export function sameCanvasIdentity(
  a: CanvasTypeIdentity | undefined,
  b: CanvasTypeIdentity | undefined,
): boolean {
  return a?.id === b?.id && a?.semanticVersion === b?.semanticVersion;
}

export function encodeCanvasIdentity(identity: CanvasTypeIdentity): string {
  return JSON.stringify(identity);
}

export function parseCanvasIdentity(value: unknown): CanvasTypeIdentity | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<CanvasTypeIdentity> | null;
    if (
      parsed === null ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0 ||
      !Number.isSafeInteger(parsed.semanticVersion) ||
      (parsed.semanticVersion as number) < 1
    ) {
      return undefined;
    }
    return { id: parsed.id, semanticVersion: parsed.semanticVersion as number };
  } catch {
    return undefined;
  }
}

const registry = new Map<string, CanvasType>();

export const canvasTypes = {
  get(id: string): CanvasType | undefined {
    return registry.get(id);
  },
  all(): CanvasType[] {
    return [...registry.values()];
  },
};

function uniqueStrings(owner: string, label: string, values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
      throw new Error(`ice: defineCanvasType("${owner}") ${label} contains invalid key "${String(value)}".`);
    }
    if (seen.has(value)) {
      throw new Error(`ice: defineCanvasType("${owner}") ${label} contains duplicate "${value}".`);
    }
    seen.add(value);
    out.push(value);
  }
  return Object.freeze(out);
}

export function defineCanvasType(def: CanvasTypeDef): CanvasType {
  if (typeof def.id !== "string" || def.id.length === 0 || /\s/.test(def.id)) {
    throw new Error("ice: defineCanvasType — id must be a non-empty stable id without whitespace.");
  }
  if (!Number.isSafeInteger(def.semanticVersion) || def.semanticVersion < 1) {
    throw new Error(
      `ice: defineCanvasType("${def.id}") semanticVersion must be a positive integer.`,
    );
  }
  if (registry.has(def.id)) {
    throw new Error(`ice: canvas type "${def.id}" is already defined.`);
  }

  const explicit = [...(def.semantic.placement.widgets ?? [])];
  const explicitIds = new Set<string>();
  for (const widget of explicit) {
    if (explicitIds.has(widget.type)) {
      throw new Error(
        `ice: defineCanvasType("${def.id}") placement.widgets contains duplicate "${widget.type}".`,
      );
    }
    explicitIds.add(widget.type);
  }

  const presentation = def.presentation;
  const migrations = [...(def.migrations ?? [])].sort((a, b) => a.from - b.from);
  const migrationFrom = new Set<number>();
  for (const migration of migrations) {
    if (
      !Number.isSafeInteger(migration.from) ||
      !Number.isSafeInteger(migration.to) ||
      migration.from < 1 ||
      migration.to !== migration.from + 1 ||
      migration.to > def.semanticVersion
    ) {
      throw new Error(
        `ice: defineCanvasType("${def.id}") migration ${migration.from}→${migration.to} must be one positive consecutive step into semanticVersion ${def.semanticVersion}.`,
      );
    }
    if (migrationFrom.has(migration.from)) {
      throw new Error(
        `ice: defineCanvasType("${def.id}") repeats migration from version ${migration.from}.`,
      );
    }
    migrationFrom.add(migration.from);
  }
  for (let index = 1; index < migrations.length; index++) {
    if (migrations[index]?.from !== migrations[index - 1]?.to) {
      throw new Error(`ice: defineCanvasType("${def.id}") migration chain contains a gap.`);
    }
  }
  if (migrations.length > 0 && migrations[migrations.length - 1]?.to !== def.semanticVersion) {
    throw new Error(
      `ice: defineCanvasType("${def.id}") migration chain must end at semanticVersion ${def.semanticVersion}.`,
    );
  }
  const type: CanvasType = Object.freeze({
    __canvasType: true as const,
    id: def.id,
    semanticVersion: def.semanticVersion,
    semantic: Object.freeze({
      placement: Object.freeze({
        accepts: uniqueStrings(def.id, "placement.accepts", def.semantic.placement.accepts ?? []),
        widgets: Object.freeze(explicit),
      }),
      frameBehaviors: Object.freeze([...(def.semantic.frameBehaviors ?? [])]),
    }),
    migrations: Object.freeze(
      migrations.map((migration) =>
        Object.freeze({
          ...migration,
          reads: Object.freeze([...(migration.reads ?? [])]),
          writes: Object.freeze([...(migration.writes ?? [])]),
        }),
      ),
    ),
    ...(presentation === undefined
      ? {}
      : {
          presentation: Object.freeze({
            ...presentation,
            ...(presentation.catalog === undefined
              ? {}
              : {
                  catalog: Object.freeze({
                    sections: Object.freeze(
                      presentation.catalog.sections.map((section) =>
                        Object.freeze({ ...section, items: Object.freeze([...section.items]) }),
                      ),
                    ),
                  }),
                }),
            ...(presentation.tools === undefined
              ? {}
              : {
                  tools: Object.freeze({
                    allowed: Object.freeze([...presentation.tools.allowed]),
                    default: presentation.tools.default,
                  }),
                }),
            ...(presentation.runtimeExtensions === undefined
              ? {}
              : { runtimeExtensions: Object.freeze([...presentation.runtimeExtensions]) }),
            ...(presentation.ground === undefined
              ? {}
              : { ground: Object.freeze({ ...presentation.ground }) }),
            ...(presentation.camera === undefined
              ? {}
              : { camera: Object.freeze({ ...presentation.camera }) }),
            ...(presentation.preview === undefined
              ? {}
              : { preview: Object.freeze({ ...presentation.preview }) }),
          }),
        }),
  });
  registry.set(type.id, type);
  return type;
}

/** Immutable, explicitly compiled presentation-only catalog contribution. */
export function contributeCanvasCatalog(
  contribution: CanvasCatalogContribution,
): CanvasCatalogContribution {
  if (
    typeof contribution.id !== "string" ||
    contribution.id.length === 0 ||
    /\s/.test(contribution.id)
  ) {
    throw new Error("ice: contributeCanvasCatalog — id must be a stable non-empty id.");
  }
  return Object.freeze({
    ...contribution,
    sections: Object.freeze(
      contribution.sections.map((section) =>
        Object.freeze({ ...section, items: Object.freeze([...section.items]) }),
      ),
    ),
  });
}

/** Legacy/default CanvasType. Engine compilation expands placement/catalog. */
export const DefaultCanvasType = defineCanvasType({
  id: "ice.default",
  semanticVersion: 1,
  semantic: { placement: {} },
});
