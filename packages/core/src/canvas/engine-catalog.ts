/**
 * Immutable, engine-scoped definition authority.
 *
 * Global registries remain definition stores for authoring/HMR. Runtime code
 * resolves through the catalog bound to its World; unbound lower-level test
 * worlds retain the legacy registry fallback.
 */
import type { World } from "@vibecook/strata-ecs";
import { WirePrefab } from "../catalog/graph";
import { prefabs, type Prefab } from "../schema/prefab";
import { tools, type Tool } from "../tools/define-tool";
import { widgets, type WidgetType } from "../widget/define-widget";
import { schemaMeta } from "../schema/meta";
import {
  DefaultCanvasType,
  canvasPackId,
  canvasTypes,
  type CanvasCatalogContribution,
  type CanvasCatalogSection,
  type CanvasType,
} from "./define-canvas-type";
import {
  canvasRuntimeExtensions,
  frameBehaviorPackId,
  frameBehaviors,
  type CanvasReadFacet,
  type CanvasRuntimeExtension,
  type FrameBehavior,
} from "./extensions";
import {
  frameProjections,
  type FrameProjection,
} from "./frame-projection";

export interface EngineCatalogCompileOpts {
  readonly widgets?: readonly { readonly type: string }[];
  readonly tools?: readonly Tool[];
  readonly canvasTypes?: readonly CanvasType[];
  readonly rootCanvas?: CanvasType;
  readonly presentationFallback?: CanvasType;
  readonly catalogContributions?: readonly CanvasCatalogContribution[];
  readonly canvasRuntimeExtensions?: readonly CanvasRuntimeExtension[];
  readonly frameBehaviors?: readonly FrameBehavior[];
  readonly frameProjections?: readonly FrameProjection[];
}

export interface EngineCatalog {
  readonly typed: boolean;
  readonly rootCanvas: CanvasType;
  readonly presentationFallback: CanvasType;
  widget(id: string): WidgetType | undefined;
  widgetTypes(): readonly WidgetType[];
  tool(id: string): Tool | undefined;
  toolTypes(): readonly Tool[];
  canvasType(id: string): CanvasType | undefined;
  canvasTypeDefs(): readonly CanvasType[];
  runtimeExtension(id: string): CanvasRuntimeExtension | undefined;
  runtimeExtensionsFor(canvasTypeId: string): readonly CanvasRuntimeExtension[];
  frameBehavior(id: string): FrameBehavior | undefined;
  frameBehaviorsFor(canvasTypeId: string): readonly FrameBehavior[];
  frameProjection(id: string): FrameProjection | undefined;
  frameProjectionForContainer(widgetTypeId: string): FrameProjection | undefined;
  framePreviewRendererForContainer(widgetTypeId: string): unknown;
  framePreviewBackgroundForContainer(widgetTypeId: string): unknown;
  canvasForContainer(widgetTypeId: string): CanvasType | undefined;
  placementFor(canvasTypeId: string): ReadonlySet<string>;
  toolsFor(canvasTypeId: string): readonly Tool[];
  defaultToolFor(canvasTypeId: string): Tool;
  catalogFor(canvasTypeId: string): readonly CanvasCatalogSection[];
  /** Every pack/version this engine can interpret while opening a document. */
  localPacks(): Readonly<Record<string, number>>;
  /** Exact capability manifest granted to a newly created document. */
  initialPacks(): Readonly<Record<string, number>>;
  /** Semantic requirement closure keyed by the pack that introduces it. */
  packDependencies(): Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Requirement closure that must be stamped before this widget can be created. */
  requirementsForWidget(widgetTypeId: string): Readonly<Record<string, number>> | undefined;
}

function uniqueById<T>(label: string, values: readonly T[], idOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const id = idOf(value);
    if (seen.has(id)) throw new Error(`ice: createCanvasEngine — duplicate ${label} "${id}".`);
    seen.add(id);
    out.push(value);
  }
  return out;
}

function stableTopo<T extends { readonly id: string; readonly after: readonly string[]; readonly before: readonly string[] }>(
  owner: string,
  kind: string,
  values: readonly T[],
): readonly T[] {
  const byId = new Map(values.map((value) => [value.id, value] as const));
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const value of values) {
    outgoing.set(value.id, new Set());
    indegree.set(value.id, 0);
  }
  const edge = (from: string, to: string): void => {
    if (!byId.has(from) || !byId.has(to)) {
      throw new Error(
        `ice: CanvasType "${owner}" ${kind} ordering references uncompiled id ` +
          `"${byId.has(from) ? to : from}".`,
      );
    }
    const targets = outgoing.get(from) as Set<string>;
    if (targets.has(to)) return;
    targets.add(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };
  for (const value of values) {
    for (const prior of value.after) edge(prior, value.id);
    for (const later of value.before) edge(value.id, later);
  }
  const ready = [...values]
    .filter((value) => indegree.get(value.id) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const ordered: T[] = [];
  while (ready.length > 0) {
    const value = ready.shift() as T;
    ordered.push(value);
    for (const target of [...(outgoing.get(value.id) ?? [])].sort()) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        ready.push(byId.get(target) as T);
        ready.sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  }
  if (ordered.length !== values.length) {
    throw new Error(`ice: CanvasType "${owner}" ${kind} ordering contains a cycle.`);
  }
  return Object.freeze(ordered);
}

function validateFacet(owner: string, facet: CanvasReadFacet): void {
  if (
    schemaMeta.component(facet as never) === undefined &&
    schemaMeta.tagName(facet as never) === undefined &&
    schemaMeta.relation(facet as never) === undefined &&
    schemaMeta.resource(facet as never) === undefined
  ) {
    throw new Error(`ice: ${owner} declares an unknown read facet.`);
  }
}

function resolveWidgets(list: EngineCatalogCompileOpts["widgets"]): WidgetType[] {
  const source = list ?? widgets.all();
  return uniqueById("widget type", source, (w) => w.type).map((decl) => {
    const resolved = widgets.get(decl.type);
    if (resolved === undefined) {
      throw new Error(`ice: createCanvasEngine — widget type "${decl.type}" is not defined.`);
    }
    return resolved;
  });
}

function resolveTools(list: EngineCatalogCompileOpts["tools"], typed: boolean): Tool[] {
  const requested = list ?? tools.all();
  const source = typed ? requested : [tools.get("select"), tools.get("pan"), tools.get("connect"), ...requested];
  const resolved: Tool[] = [];
  const seen = new Set<string>();
  for (const candidate of source) {
    if (candidate === undefined || seen.has(candidate.id)) continue;
    const registered = tools.get(candidate.id);
    if (registered === undefined) {
      throw new Error(`ice: createCanvasEngine — tool "${candidate.id}" is not defined.`);
    }
    seen.add(candidate.id);
    resolved.push(registered);
  }
  if (!seen.has("select")) {
    throw new Error('ice: createCanvasEngine — typed Canvas SDK engines must explicitly compile tool "select".');
  }
  return resolved;
}

export function compileEngineCatalog(opts: EngineCatalogCompileOpts = {}): EngineCatalog {
  const typed =
    opts.canvasTypes !== undefined ||
    opts.rootCanvas !== undefined ||
    opts.presentationFallback !== undefined;
  if (typed && opts.widgets === undefined) {
    throw new Error("ice: createCanvasEngine — typed Canvas SDK mode requires an explicit widgets list.");
  }
  if (typed && opts.tools === undefined) {
    throw new Error("ice: createCanvasEngine — typed Canvas SDK mode requires an explicit tools list.");
  }
  if (typed && opts.presentationFallback === undefined) {
    throw new Error(
      "ice: createCanvasEngine — typed Canvas SDK mode requires an explicit presentationFallback.",
    );
  }

  const widgetList = resolveWidgets(opts.widgets);
  const toolList = resolveTools(opts.tools, typed);
  const widgetMap = new Map(widgetList.map((w) => [w.type, w] as const));
  const toolMap = new Map(toolList.map((t) => [t.id, t] as const));
  const extensionList = uniqueById(
    "CanvasRuntimeExtension",
    opts.canvasRuntimeExtensions ?? [],
    (extension) => extension.id,
  );
  const behaviorList = uniqueById(
    "FrameBehavior",
    opts.frameBehaviors ?? [],
    (behavior) => behavior.id,
  );
  const projectionList = uniqueById(
    "FrameProjection",
    opts.frameProjections ?? [],
    (projection) => projection.id,
  );
  const extensionMap = new Map(extensionList.map((extension) => [extension.id, extension] as const));
  const behaviorMap = new Map(behaviorList.map((behavior) => [behavior.id, behavior] as const));
  const projectionMap = new Map(
    projectionList.map((projection) => [projection.id, projection] as const),
  );
  for (const extension of extensionList) {
    if (canvasRuntimeExtensions.get(extension.id) !== extension) {
      throw new Error(
        `ice: createCanvasEngine — CanvasRuntimeExtension "${extension.id}" is not its registered definition.`,
      );
    }
    for (const facet of extension.reads) validateFacet(`CanvasRuntimeExtension "${extension.id}"`, facet);
    for (const component of extension.writesRuntime) {
      if (schemaMeta.component(component) === undefined) {
        throw new Error(
          `ice: CanvasRuntimeExtension "${extension.id}" declares an unknown runtime output.`,
        );
      }
      if (widgetList.some((widget) => widget.prefab.eligible.has(component))) {
        throw new Error(
          `ice: CanvasRuntimeExtension "${extension.id}" output is durable-eligible on a compiled widget.`,
        );
      }
    }
  }
  for (const behavior of behaviorList) {
    if (frameBehaviors.get(behavior.id) !== behavior) {
      throw new Error(
        `ice: createCanvasEngine — FrameBehavior "${behavior.id}" is not its registered definition.`,
      );
    }
    for (const facet of behavior.reads) validateFacet(`FrameBehavior "${behavior.id}"`, facet);
    for (const component of behavior.writesDurable) {
      if (schemaMeta.component(component) === undefined) {
        throw new Error(`ice: FrameBehavior "${behavior.id}" declares an unknown component output.`);
      }
    }
    for (const relation of behavior.writesRelations) {
      if (schemaMeta.relation(relation) === undefined) {
        throw new Error(`ice: FrameBehavior "${behavior.id}" declares an unknown relation output.`);
      }
    }
  }
  for (const projection of projectionList) {
    if (frameProjections.get(projection.id) !== projection) {
      throw new Error(
        `ice: createCanvasEngine — FrameProjection "${projection.id}" is not its registered definition.`,
      );
    }
    for (const component of projection.reads) {
      if (schemaMeta.component(component) === undefined) {
        throw new Error(`ice: FrameProjection "${projection.id}" declares an unknown component.`);
      }
    }
    for (const relation of projection.relations) {
      if (schemaMeta.relation(relation) === undefined) {
        throw new Error(`ice: FrameProjection "${projection.id}" declares an unknown relation.`);
      }
    }
  }

  const requestedCanvasTypes =
    opts.canvasTypes ??
    (typed
      ? [DefaultCanvasType]
      : [
          DefaultCanvasType,
          ...widgetList.flatMap((widget) => {
            const id = widget.container?.canvasTypeId;
            const canvas = id === undefined ? undefined : canvasTypes.get(id);
            return canvas === undefined ? [] : [canvas];
          }),
        ]);
  const normalizedCanvasList: CanvasType[] = [];
  const canvasSeen = new Set<string>();
  const userCanvasSeen = new Set<string>();
  if (opts.canvasTypes !== undefined) {
    for (const type of requestedCanvasTypes) {
      if (userCanvasSeen.has(type.id)) {
        throw new Error(`ice: createCanvasEngine — duplicate CanvasType "${type.id}".`);
      }
      userCanvasSeen.add(type.id);
    }
  }
  // The built-in default is an implicit compatibility dependency. Its one
  // explicit occurrence in the user list is therefore harmless.
  for (const type of [DefaultCanvasType, ...requestedCanvasTypes]) {
    if (canvasSeen.has(type.id)) continue;
    const registered = canvasTypes.get(type.id);
    if (registered !== type) {
      throw new Error(`ice: createCanvasEngine — CanvasType "${type.id}" is not the registered definition.`);
    }
    canvasSeen.add(type.id);
    normalizedCanvasList.push(type);
  }
  const canvasMap = new Map(normalizedCanvasList.map((c) => [c.id, c] as const));
  const contributionIds = new Set<string>();
  const contributions = new Map<string, CanvasCatalogContribution[]>();
  for (const contribution of opts.catalogContributions ?? []) {
    if (contributionIds.has(contribution.id)) {
      throw new Error(
        `ice: createCanvasEngine — duplicate catalog contribution "${contribution.id}".`,
      );
    }
    contributionIds.add(contribution.id);
    if (canvasMap.get(contribution.canvas.id) !== contribution.canvas) {
      throw new Error(
        `ice: catalog contribution "${contribution.id}" targets an uncompiled CanvasType.`,
      );
    }
    const list = contributions.get(contribution.canvas.id) ?? [];
    list.push(contribution);
    contributions.set(contribution.canvas.id, list);
  }
  const rootCanvas = opts.rootCanvas ?? DefaultCanvasType;
  const presentationFallback = opts.presentationFallback ?? DefaultCanvasType;
  if (canvasMap.get(rootCanvas.id) !== rootCanvas) {
    throw new Error(`ice: createCanvasEngine — root CanvasType "${rootCanvas.id}" is not listed.`);
  }
  if (canvasMap.get(presentationFallback.id) !== presentationFallback) {
    throw new Error(
      `ice: createCanvasEngine — presentation fallback CanvasType "${presentationFallback.id}" is not listed.`,
    );
  }

  const placement = new Map<string, ReadonlySet<string>>();
  const allowedTools = new Map<string, readonly Tool[]>();
  const defaultTools = new Map<string, Tool>();
  const catalogs = new Map<string, readonly CanvasCatalogSection[]>();
  const runtimeByCanvas = new Map<string, readonly CanvasRuntimeExtension[]>();
  const behaviorsByCanvas = new Map<string, readonly FrameBehavior[]>();
  const select = toolMap.get("select") as Tool;

  for (const canvas of normalizedCanvasList) {
    const canvasProjection = canvas.presentation?.preview?.projection;
    if (
      canvasProjection !== undefined &&
      projectionMap.get(canvasProjection.id) !== canvasProjection
    ) {
      throw new Error(
        `ice: CanvasType "${canvas.id}" references uncompiled FrameProjection "${canvasProjection.id}".`,
      );
    }
    const camera = canvas.presentation?.camera;
    if (
      (camera?.padding !== undefined &&
        (!Number.isFinite(camera.padding) || camera.padding < 0)) ||
      (camera?.minZoom !== undefined &&
        (!Number.isFinite(camera.minZoom) || camera.minZoom <= 0)) ||
      (camera?.maxZoom !== undefined &&
        (!Number.isFinite(camera.maxZoom) || camera.maxZoom <= 0)) ||
      (camera?.minZoom !== undefined &&
        camera.maxZoom !== undefined &&
        camera.minZoom > camera.maxZoom)
    ) {
      throw new Error(`ice: CanvasType "${canvas.id}" has invalid finite camera limits.`);
    }
    const groundProgram = canvas.presentation?.ground?.program;
    if (groundProgram !== undefined && groundProgram.length === 0) {
      throw new Error(`ice: CanvasType "${canvas.id}" has an empty ground program id.`);
    }
    const legal = new Set<string>();
    if (canvas.id === DefaultCanvasType.id) {
      for (const widget of widgetList) legal.add(widget.type);
    } else {
      for (const declared of canvas.semantic.placement.widgets ?? []) {
        if (widgetMap.get(declared.type) !== declared) {
          throw new Error(
            `ice: CanvasType "${canvas.id}" places uncompiled widget "${declared.type}".`,
          );
        }
        legal.add(declared.type);
      }
      const accepts = new Set(canvas.semantic.placement.accepts ?? []);
      if (accepts.size > 0) {
        for (const widget of widgetList) {
          if (widget.provides.some((key) => accepts.has(key))) legal.add(widget.type);
        }
      }
    }
    placement.set(canvas.id, legal);

    const toolDecl = canvas.presentation?.tools;
    const canvasTools =
      canvas.id === DefaultCanvasType.id && !typed
        ? toolList
        : toolDecl?.allowed ?? [select, ...(toolMap.get("pan") === undefined ? [] : [toolMap.get("pan") as Tool])];
    const normalizedTools = uniqueById("CanvasType tool", canvasTools, (tool) => tool.id).map((tool) => {
      const compiled = toolMap.get(tool.id);
      if (compiled === undefined) {
        throw new Error(`ice: CanvasType "${canvas.id}" allows uncompiled tool "${tool.id}".`);
      }
      if (compiled.draw !== undefined && !legal.has(compiled.draw.widgetType)) {
        throw new Error(
          `ice: CanvasType "${canvas.id}" tool "${compiled.id}" creates placement-illegal widget "${compiled.draw.widgetType}".`,
        );
      }
      return compiled;
    });
    const defaultTool = toolDecl?.default ?? select;
    if (!normalizedTools.some((tool) => tool.id === defaultTool.id)) {
      throw new Error(
        `ice: CanvasType "${canvas.id}" default tool "${defaultTool.id}" is not in its allowed set.`,
      );
    }
    allowedTools.set(canvas.id, Object.freeze(normalizedTools));
    defaultTools.set(canvas.id, toolMap.get(defaultTool.id) as Tool);

    const contributed = [...(contributions.get(canvas.id) ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const sections = [
      ...(canvas.presentation?.catalog?.sections ?? []),
      ...contributed.flatMap((contribution) => contribution.sections),
    ];
    const sectionIds = new Set<string>();
    const itemIds = new Set<string>();
    for (const section of sections) {
      if (sectionIds.has(section.id)) {
        throw new Error(`ice: CanvasType "${canvas.id}" has duplicate catalog section "${section.id}".`);
      }
      sectionIds.add(section.id);
      for (const item of section.items) {
        if (!widgetMap.has(item.type)) {
          throw new Error(
            `ice: CanvasType "${canvas.id}" catalog references uncompiled widget "${item.type}".`,
          );
        }
        if (!legal.has(item.type)) {
          throw new Error(
            `ice: CanvasType "${canvas.id}" catalog exposes placement-illegal widget "${item.type}".`,
          );
        }
        if (itemIds.has(item.type)) {
          throw new Error(`ice: CanvasType "${canvas.id}" catalog repeats widget "${item.type}".`);
        }
        itemIds.add(item.type);
      }
    }
    catalogs.set(
      canvas.id,
      Object.freeze(
        [...sections]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
          .map((section) => Object.freeze({ ...section, items: Object.freeze([...section.items]) })),
      ),
    );

    const runtimeExtensions = uniqueById(
      `CanvasType "${canvas.id}" runtime extension`,
      canvas.presentation?.runtimeExtensions ?? [],
      (extension) => extension.id,
    ).map((extension) => {
      if (extensionMap.get(extension.id) !== extension) {
        throw new Error(
          `ice: CanvasType "${canvas.id}" references uncompiled CanvasRuntimeExtension "${extension.id}".`,
        );
      }
      return extension;
    });
    const extensionOutputs = new Map<object, string>();
    for (const extension of runtimeExtensions) {
      for (const output of extension.writesRuntime) {
        const prior = extensionOutputs.get(output);
        if (prior !== undefined) {
          throw new Error(
            `ice: CanvasType "${canvas.id}" runtime extensions "${prior}" and ` +
              `"${extension.id}" claim the same exclusive output.`,
          );
        }
        extensionOutputs.set(output, extension.id);
      }
    }
    runtimeByCanvas.set(
      canvas.id,
      stableTopo(canvas.id, "runtime extension", runtimeExtensions),
    );

    const semanticBehaviors = uniqueById(
      `CanvasType "${canvas.id}" FrameBehavior`,
      canvas.semantic.frameBehaviors ?? [],
      (behavior) => behavior.id,
    ).map((behavior) => {
      if (behaviorMap.get(behavior.id) !== behavior) {
        throw new Error(
          `ice: CanvasType "${canvas.id}" references uncompiled FrameBehavior "${behavior.id}".`,
        );
      }
      return behavior;
    });
    const behaviorOutputs = new Map<object, string>();
    for (const behavior of semanticBehaviors) {
      for (const output of [...behavior.writesDurable, ...behavior.writesRelations]) {
        const prior = behaviorOutputs.get(output);
        if (prior !== undefined) {
          throw new Error(
            `ice: CanvasType "${canvas.id}" FrameBehaviors "${prior}" and ` +
              `"${behavior.id}" claim the same semantic output without a reducer.`,
          );
        }
        behaviorOutputs.set(output, behavior.id);
      }
    }
    behaviorsByCanvas.set(
      canvas.id,
      stableTopo(canvas.id, "FrameBehavior", semanticBehaviors),
    );

    for (const migration of canvas.migrations ?? []) {
      for (const facet of migration.reads ?? []) {
        validateFacet(`CanvasType "${canvas.id}" migration ${migration.from}→${migration.to}`, facet);
      }
      for (const output of migration.writes ?? []) {
        if (
          schemaMeta.component(output as never) === undefined &&
          schemaMeta.relation(output as never) === undefined
        ) {
          throw new Error(
            `ice: CanvasType "${canvas.id}" migration ${migration.from}→${migration.to} declares an unknown output.`,
          );
        }
      }
    }

  }

  const requiredCanvasIds = new Set<string>([rootCanvas.id]);
  for (const widget of widgetList) {
    const container = widget.container;
    if (container === undefined) continue;
    const bound = canvasMap.get(container.canvasTypeId);
    if (bound === undefined || bound.semanticVersion !== container.canvasSemanticVersion) {
      throw new Error(
        `ice: container widget "${widget.type}" binds unavailable CanvasType ` +
          `"${container.canvasTypeId}"@${container.canvasSemanticVersion}.`,
      );
    }
    requiredCanvasIds.add(bound.id);
    if (
      container.frameProjection !== undefined &&
      projectionMap.get(container.frameProjection.id) !== container.frameProjection
    ) {
      throw new Error(
        `ice: container widget "${widget.type}" references uncompiled FrameProjection ` +
          `"${container.frameProjection.id}".`,
      );
    }
    const insets = Object.values(container.portal);
    if (
      insets.some((value) => !Number.isFinite(value) || value < 0) ||
      container.portal.left + container.portal.right >= widget.defaultSize.w ||
      container.portal.top + container.portal.bottom >= widget.defaultSize.h
    ) {
      throw new Error(`ice: container widget "${widget.type}" has an invalid portal rectangle.`);
    }
    if (!container.inheritCanvasPlacement) {
      const ingress = new Set(container.widgetTypeIds);
      const accepts = new Set(container.accepts);
      for (const candidate of widgetList) {
        if (candidate.provides.some((key) => accepts.has(key))) ingress.add(candidate.type);
      }
      const legal = placement.get(bound.id) as ReadonlySet<string>;
      for (const id of ingress) {
        if (!legal.has(id)) {
          throw new Error(
            `ice: container widget "${widget.type}" admits "${id}" but CanvasType "${bound.id}" does not.`,
          );
        }
      }
    }
  }

  const localPacks: Record<string, number> = { [WirePrefab.id]: WirePrefab.version ?? 1 };
  for (const widget of widgetList) localPacks[widget.prefab.id] = widget.prefab.version ?? 1;
  for (const canvas of normalizedCanvasList) {
    localPacks[canvasPackId(canvas.id)] = canvas.semanticVersion;
  }
  for (const behavior of behaviorList) {
    localPacks[frameBehaviorPackId(behavior.id)] = behavior.version;
  }
  const initialPacks: Record<string, number> = { [WirePrefab.id]: WirePrefab.version ?? 1 };
  for (const widget of widgetList) initialPacks[widget.prefab.id] = widget.prefab.version ?? 1;
  for (const id of requiredCanvasIds) {
    const canvas = canvasMap.get(id) as CanvasType;
    initialPacks[canvasPackId(id)] = canvas.semanticVersion;
    for (const behavior of behaviorsByCanvas.get(id) ?? []) {
      initialPacks[frameBehaviorPackId(behavior.id)] = behavior.version;
    }
  }
  const frozenLocalPacks = Object.freeze({ ...localPacks });
  const frozenInitialPacks = Object.freeze({ ...initialPacks });
  const packDependencies: Record<string, Readonly<Record<string, number>>> = {};
  for (const canvas of normalizedCanvasList) {
    const dependencies: Record<string, number> = {};
    for (const behavior of behaviorsByCanvas.get(canvas.id) ?? []) {
      dependencies[frameBehaviorPackId(behavior.id)] = behavior.version;
    }
    packDependencies[canvasPackId(canvas.id)] = Object.freeze(dependencies);
  }
  for (const widget of widgetList) {
    if (widget.container === undefined) continue;
    const dependencies: Record<string, number> = {
      [canvasPackId(widget.container.canvasTypeId)]: widget.container.canvasSemanticVersion,
    };
    for (const behavior of behaviorsByCanvas.get(widget.container.canvasTypeId) ?? []) {
      dependencies[frameBehaviorPackId(behavior.id)] = behavior.version;
    }
    packDependencies[widget.prefab.id] = Object.freeze(dependencies);
  }
  const frozenPackDependencies = Object.freeze(packDependencies);
  const frozenWidgets = Object.freeze([...widgetList]);
  const frozenTools = Object.freeze([...toolList]);
  const frozenCanvases = Object.freeze([...normalizedCanvasList]);
  const emptyPlacement = new Set<string>() as ReadonlySet<string>;

  return Object.freeze({
    typed,
    rootCanvas,
    presentationFallback,
    widget: (id: string) => widgetMap.get(id),
    widgetTypes: () => frozenWidgets,
    tool: (id: string) => toolMap.get(id),
    toolTypes: () => frozenTools,
    canvasType: (id: string) => canvasMap.get(id),
    canvasTypeDefs: () => frozenCanvases,
    runtimeExtension: (id: string) => extensionMap.get(id),
    runtimeExtensionsFor: (canvasTypeId: string) => runtimeByCanvas.get(canvasTypeId) ?? [],
    frameBehavior: (id: string) => behaviorMap.get(id),
    frameBehaviorsFor: (canvasTypeId: string) => behaviorsByCanvas.get(canvasTypeId) ?? [],
    frameProjection: (id: string) => projectionMap.get(id),
    frameProjectionForContainer(widgetTypeId: string) {
      const widget = widgetMap.get(widgetTypeId);
      const binding = widget?.container;
      if (binding === undefined) return undefined;
      return (
        binding.frameProjection ??
        canvasMap.get(binding.canvasTypeId)?.presentation?.preview?.projection
      );
    },
    framePreviewRendererForContainer(widgetTypeId: string) {
      const widget = widgetMap.get(widgetTypeId);
      const binding = widget?.container;
      if (binding === undefined) return undefined;
      return (
        binding.framePreview ??
        canvasMap.get(binding.canvasTypeId)?.presentation?.preview?.renderer
      );
    },
    framePreviewBackgroundForContainer(widgetTypeId: string) {
      const binding = widgetMap.get(widgetTypeId)?.container;
      if (binding === undefined) return undefined;
      return canvasMap.get(binding.canvasTypeId)?.presentation?.preview?.background;
    },
    canvasForContainer(widgetTypeId: string) {
      const binding = widgetMap.get(widgetTypeId)?.container;
      return binding === undefined ? undefined : canvasMap.get(binding.canvasTypeId);
    },
    placementFor: (canvasTypeId: string) => placement.get(canvasTypeId) ?? emptyPlacement,
    toolsFor: (canvasTypeId: string) => allowedTools.get(canvasTypeId) ?? [select],
    defaultToolFor: (canvasTypeId: string) => defaultTools.get(canvasTypeId) ?? select,
    catalogFor: (canvasTypeId: string) => catalogs.get(canvasTypeId) ?? [],
    localPacks: () => frozenLocalPacks,
    initialPacks: () => frozenInitialPacks,
    packDependencies: () => frozenPackDependencies,
    requirementsForWidget(widgetTypeId: string) {
      const widget = widgetMap.get(widgetTypeId);
      if (widget === undefined) return undefined;
      const requirements: Record<string, number> = {
        [widget.prefab.id]: widget.prefab.version ?? 1,
      };
      if (widget.container !== undefined) {
        requirements[canvasPackId(widget.container.canvasTypeId)] =
          widget.container.canvasSemanticVersion;
        for (const behavior of behaviorsByCanvas.get(widget.container.canvasTypeId) ?? []) {
          requirements[frameBehaviorPackId(behavior.id)] = behavior.version;
        }
      }
      return Object.freeze(requirements);
    },
  });
}

const byWorld = new WeakMap<World, EngineCatalog>();

export function bindEngineCatalog(world: World, catalog: EngineCatalog): () => void {
  if (byWorld.has(world)) throw new Error("ice: a World already has an EngineCatalog.");
  byWorld.set(world, catalog);
  return () => {
    if (byWorld.get(world) === catalog) byWorld.delete(world);
  };
}

export function engineCatalogFor(world: World): EngineCatalog | undefined {
  return byWorld.get(world);
}

export function widgetTypeFor(world: World, id: string): WidgetType | undefined {
  const catalog = byWorld.get(world);
  if (catalog !== undefined) return catalog.widget(id);
  return widgets.get(id);
}

export function toolTypeFor(world: World, id: string): Tool | undefined {
  const catalog = byWorld.get(world);
  if (catalog !== undefined) return catalog.tool(id);
  return tools.get(id);
}

/** Unknown tools retain select semantics only in unbound legacy worlds. */
export function resolveToolFor(world: World, id: string): Tool {
  const catalog = byWorld.get(world);
  if (catalog !== undefined) return catalog.tool(id) ?? (catalog.tool("select") as Tool);
  return tools.resolve(id);
}

/** Engine-scoped durable prefab resolution for transaction/live-write guards. */
export function durablePrefabFor(world: World, id: string): Prefab | undefined {
  const catalog = byWorld.get(world);
  if (catalog !== undefined) {
    return catalog.widget(id)?.prefab ?? (id === WirePrefab.id ? WirePrefab : undefined);
  }
  return prefabs.get(id);
}
