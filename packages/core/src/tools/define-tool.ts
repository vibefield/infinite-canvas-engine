/**
 * `defineTool` — tools are PURE CONFIGURATION (design-005 §3): a tool
 * introduces no new code paths, it only parameterizes L2 spawn (which
 * recognizer kinds a pointer-down mints), L4 cursor, the L3 dragRoute
 * policy, and capability gates. Custom behaviors register systems via the
 * engine's extension slot — same contract as built-ins (design-003 §5.0).
 *
 * Built-ins ship as configs of this same primitive:
 *  - select: tap/longPress/drag; canvas drag → marquee (pan on touch /
 *    space / middle-button — device conventions, honored ABOVE tool policy).
 *  - pan: hand cursor; every drag pans.
 *  - connect: crosshair; widget/port drags connect (design-003 §5.8).
 *  - draw(widgetType): factory — canvas drag creates ONE widget from the
 *    drag rect at JustEnded (one tx via the create intent; min-size floor;
 *    drag preview is recorded polish, not v1 — design-001 §3's full
 *    draft→promote protocol remains the vNext shape).
 *
 * Switching tools runs `cancelActiveGestures()` first (design-003 §8) —
 * `ops.setTool` owns that; nothing here touches the world.
 */
import type { SingleKindName } from "../systems/l2-recognize";

export type CanvasDragRoute = "marquee" | "pan" | "connect" | "draw" | "none";
export type WidgetDragRoute = "move" | "pan" | "connect" | "none";

export interface ToolRoute {
  /** Drag starting on empty canvas (after device overrides: touch/space/middle → pan). */
  readonly canvasDrag?: CanvasDragRoute;
  /** Drag starting on a widget body. */
  readonly widgetDrag?: WidgetDragRoute;
  /** Drag starting on a port entity ("connect" | "none"). */
  readonly portDrag?: "connect" | "none";
}

export interface ToolGates {
  /** false ⇒ widget drags never route to move while this tool is active. */
  readonly movable?: boolean;
  /** false ⇒ resize-handle grabs are suppressed while this tool is active. */
  readonly resizable?: boolean;
}

export interface ToolDef {
  readonly id: string;
  /** L4 cursor while active (OS cursor string; design-003 §7). */
  readonly cursor?: string;
  /** Recognizer kinds minted per pointer-down (design-003 §4.1). */
  readonly spawnProfile?: readonly SingleKindName[];
  readonly route?: ToolRoute;
  readonly gates?: ToolGates;
  /** Default keymap entry (the react keymap consumes; app-overridable). */
  readonly shortcut?: string;
  /** draw tools: the widget type the drag rect creates. */
  readonly draw?: { readonly widgetType: string };
}

export interface Tool extends Required<Pick<ToolDef, "id">> {
  readonly cursor: string | undefined;
  readonly spawnProfile: readonly SingleKindName[];
  readonly route: Required<ToolRoute>;
  readonly gates: Required<ToolGates>;
  readonly shortcut: string | undefined;
  readonly draw: { readonly widgetType: string } | undefined;
}

/** The select tool's canonical shape — also every unknown tool's fallback. */
const SELECT_DEFAULTS: Omit<Tool, "id" | "shortcut"> = {
  cursor: undefined,
  spawnProfile: ["tap", "longPress", "drag"],
  route: { canvasDrag: "marquee", widgetDrag: "move", portDrag: "connect" },
  gates: { movable: true, resizable: true },
  draw: undefined,
};

const registry = new Map<string, Tool>();

export function defineTool(def: ToolDef): Tool {
  if (registry.has(def.id)) {
    throw new Error(`ice: tool "${def.id}" is already defined.`);
  }
  const tool: Tool = {
    id: def.id,
    cursor: def.cursor,
    spawnProfile: def.spawnProfile ?? SELECT_DEFAULTS.spawnProfile,
    route: { ...SELECT_DEFAULTS.route, ...def.route },
    gates: { ...SELECT_DEFAULTS.gates, ...def.gates },
    shortcut: def.shortcut,
    draw: def.draw,
  };
  registry.set(def.id, tool);
  return tool;
}

export const tools = {
  get(id: string): Tool | undefined {
    return registry.get(id);
  },
  all(): Tool[] {
    return [...registry.values()];
  },
  /** The active tool's policy, with select semantics for unknown ids. */
  resolve(id: string): Tool {
    return registry.get(id) ?? { ...SELECT_DEFAULTS, id, shortcut: undefined };
  },
};

/** TEST-ONLY wipe (mirrors __resetWidgetsForTests; not on the barrel). */
export function __resetToolsForTests(): void {
  registry.clear();
  registerBuiltinTools();
}

/** Idempotent — runs at module load (built-ins are the engine's canonical
 *  vocabulary, DEFAULT_SPAWN_PROFILES precedent); safe under HMR. */
export function registerBuiltinTools(): void {
  if (!registry.has("select")) {
    defineTool({ id: "select", shortcut: "v" });
  }
  if (!registry.has("pan")) {
    defineTool({
      id: "pan",
      cursor: "grab",
      spawnProfile: ["drag"],
      route: { canvasDrag: "pan", widgetDrag: "pan", portDrag: "none" },
      gates: { movable: false, resizable: false },
      shortcut: "h",
    });
  }
  if (!registry.has("connect")) {
    defineTool({
      id: "connect",
      cursor: "crosshair",
      spawnProfile: ["drag"],
      route: { canvasDrag: "pan", widgetDrag: "connect", portDrag: "connect" },
      gates: { movable: false, resizable: false },
      shortcut: "c",
    });
  }
}

/** Factory (design-005 §3): a drag on canvas creates `widgetType` from the rect. */
export function createDrawTool(widgetType: string, opts: { id?: string; shortcut?: string } = {}): Tool {
  return defineTool({
    id: opts.id ?? `draw:${widgetType}`,
    cursor: "crosshair",
    spawnProfile: ["drag"],
    route: { canvasDrag: "draw", widgetDrag: "none", portDrag: "none" },
    gates: { movable: false, resizable: false },
    ...(opts.shortcut !== undefined ? { shortcut: opts.shortcut } : {}),
    draw: { widgetType },
  });
}

registerBuiltinTools();
