/**
 * Catalog registration smoke tests — the definitions exist with the names, field
 * types, enum labels, relation arities, and default/required split that
 * design-001 §5 + design-003 §4 specify. These lock the vocabulary contract.
 */
import { type Component, createWorld, type Relation, type Resource, type Tag } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import * as cat from "../src/catalog";
import { schemaMeta } from "../src/schema/meta";
import { SNAP_DEFAULTS } from "../src/settings/defaults";

/** Declared scalar type of a field ("f64" | "f32" | …), or undefined for an enum field. */
function scalarType(comp: Component, name: string): string | undefined {
  const t = comp.fieldByName.get(name)?.spec.type;
  return typeof t === "string" ? t : undefined;
}

/** Declared default value of a field, or undefined if the field has none. */
function defaultOf(comp: Component | Resource, name: string): unknown {
  return comp.fieldByName.get(name)?.spec.default;
}

/** Enum labels of a field, in declaration order, or [] if the field is not an enum. */
function enumLabels(comp: Component, name: string): string[] {
  const t = comp.fieldByName.get(name)?.spec.type;
  return t !== undefined && typeof t === "object" ? [...t.labelToDisc.keys()] : [];
}

function requiredFields(comp: Component): string[] {
  return schemaMeta.component(comp)?.requiredFields ?? ["<no meta>"];
}

function arityOf(r: Relation): string | undefined {
  return schemaMeta.relation(r)?.arity;
}

describe("scene (§5.1)", () => {
  it("Position is f64/f64 and required at spawn", () => {
    expect(cat.Position.name).toBe("Position");
    expect(scalarType(cat.Position, "x")).toBe("f64");
    expect(scalarType(cat.Position, "y")).toBe("f64");
    expect(requiredFields(cat.Position)).toEqual(["x", "y"]);
  });

  it("Size is f32/f32", () => {
    expect(scalarType(cat.Size, "w")).toBe("f32");
    expect(scalarType(cat.Size, "h")).toBe("f32");
  });

  it("StackZ is fractional f64, required", () => {
    expect(scalarType(cat.StackZ, "z")).toBe("f64");
    expect(requiredFields(cat.StackZ)).toEqual(["z"]);
  });

  it("Rotation is f32 with an identity default (not required)", () => {
    expect(scalarType(cat.Rotation, "r")).toBe("f32");
    expect(requiredFields(cat.Rotation)).toEqual([]);
  });

  it("ChildOf is an arity-one relation", () => {
    expect(schemaMeta.relation(cat.ChildOf)?.name).toBe("ChildOf");
    expect(arityOf(cat.ChildOf)).toBe("one");
  });
});

describe("graph (§5.3, §5.8)", () => {
  it("Wire is a tag; WireFrom/WireTo are arity-one relations", () => {
    expect(schemaMeta.tagName(cat.Wire)).toBe("Wire");
    expect(arityOf(cat.WireFrom)).toBe("one");
    expect(arityOf(cat.WireTo)).toBe("one");
  });

  it("WirePorts binds two port-id strings, both required", () => {
    expect(scalarType(cat.WirePorts, "from")).toBe("string");
    expect(scalarType(cat.WirePorts, "to")).toBe("string");
    expect(requiredFields(cat.WirePorts)).toEqual(["from", "to"]);
  });

  it("Port.side enumerates n/e/s/w; index is a defaulted u8", () => {
    expect(enumLabels(cat.Port, "side")).toEqual(["n", "e", "s", "w"]);
    expect(scalarType(cat.Port, "index")).toBe("u8");
    expect(requiredFields(cat.Port)).toEqual(["id", "side"]);
  });

  it("PortOf is arity-one; PortAnchor is derive-owned f64 coords", () => {
    expect(arityOf(cat.PortOf)).toBe("one");
    expect(scalarType(cat.PortAnchor, "x")).toBe("f64");
  });

  it("Container is a tag; Accepts/Provides hold JSON string lists", () => {
    expect(schemaMeta.tagName(cat.Container)).toBe("Container");
    expect(scalarType(cat.Accepts, "list")).toBe("string");
    expect(scalarType(cat.Provides, "list")).toBe("string");
  });
});

describe("pointer (§5.4)", () => {
  it("Pointer.device enumerates mouse/touch/pen; owner is defaulted", () => {
    expect(enumLabels(cat.Pointer, "device")).toEqual(["mouse", "touch", "pen"]);
    expect(requiredFields(cat.Pointer)).toEqual(["id", "device"]);
  });

  it("PointerScreen is f32; PointerWorld is f64; PointerMods are all defaulted bools", () => {
    expect(scalarType(cat.PointerScreen, "x")).toBe("f32");
    expect(scalarType(cat.PointerWorld, "x")).toBe("f64");
    expect(scalarType(cat.PointerMods, "shift")).toBe("bool");
    expect(requiredFields(cat.PointerMods)).toEqual([]);
  });

  it("the one-tick + local tags exist with the right names", () => {
    const tags: [Tag, string][] = [
      [cat.WentDown, "WentDown"],
      [cat.WentUp, "WentUp"],
      [cat.WentCancelled, "WentCancelled"],
      [cat.HandledByWidget, "HandledByWidget"],
      [cat.LocalPointer, "LocalPointer"],
    ];
    for (const [t, name] of tags) expect(schemaMeta.tagName(t)).toBe(name);
  });

  it("Targets/TouchesExact are arity-one relations", () => {
    expect(arityOf(cat.Targets)).toBe("one");
    expect(arityOf(cat.TouchesExact)).toBe("one");
  });
});

describe("gesture (§5.5, design-003 §4.2)", () => {
  it("Drag carries the revised zoomAtClaim field and is fully defaulted", () => {
    expect(scalarType(cat.Drag, "zoomAtClaim")).toBe("f32");
    expect(scalarType(cat.Drag, "startX")).toBe("f64");
    expect(scalarType(cat.Drag, "totalX")).toBe("f32");
    expect(requiredFields(cat.Drag)).toEqual([]);
  });

  it("Pinch carries zoomAtClaim; Tap/LongPress have their tail fields", () => {
    expect(scalarType(cat.Pinch, "zoomAtClaim")).toBe("f32");
    expect(scalarType(cat.Tap, "downAt")).toBe("f64");
    expect(cat.LongPress.fieldByName.has("curX")).toBe(true);
    expect(cat.LongPress.fieldByName.has("curY")).toBe(true);
  });

  it("WheelPan has dx/dy/anchor; WheelZoom has pinch/anchor (no dx/dy)", () => {
    expect(cat.WheelPan.fieldByName.has("dx")).toBe(true);
    expect(cat.WheelPan.fieldByName.has("anchorX")).toBe(true);
    expect(cat.WheelZoom.fieldByName.has("pinch")).toBe(true);
    expect(cat.WheelZoom.fieldByName.has("dx")).toBe(false);
  });

  it("phase + route tags carry the exact contract names (incl. restored Pending)", () => {
    // Pending was dropped at M4 as dead machinery, then RESTORED with the v2
    // gesture port (multi-tap window / Sequence / RequiresFail parking).
    const tags: [Tag, string][] = [
      [cat.GesturePossible, "GesturePossible"],
      [cat.GestureActive, "GestureActive"],
      [cat.GesturePending, "GesturePending"],
      [cat.GestureRecognized, "GestureRecognized"],
      [cat.GestureEnded, "GestureEnded"],
      [cat.GestureFailed, "GestureFailed"],
      [cat.GestureCancelled, "GestureCancelled"],
      [cat.GestureSuspended, "GestureSuspended"],
      [cat.Simultaneous, "Simultaneous"],
      [cat.HadSequence, "HadSequence"],
      [cat.HadRequiresFail, "HadRequiresFail"],
      [cat.RoutedMove, "RoutedMove"],
      [cat.RoutedResize, "RoutedResize"],
      [cat.RoutedConnect, "RoutedConnect"],
      [cat.RoutedMarquee, "RoutedMarquee"],
      [cat.RoutedPan, "RoutedPan"],
    ];
    for (const [t, name] of tags) expect(schemaMeta.tagName(t)).toBe(name);
  });

  it("GesturePhases mints one-tick Just<Phase> markers with the contract names", () => {
    // The six phases are ONE PhaseSet; alongside each persistent phase tag it mints a
    // "GestureJust<Phase>" marker (plain concatenation, design-003 §4.2).
    const markers: [Tag, string][] = [
      [cat.GesturePhases.justTags.Possible, "GestureJustPossible"],
      [cat.GesturePhases.justTags.Active, "GestureJustActive"],
      [cat.GesturePhases.justTags.Recognized, "GestureJustRecognized"],
      [cat.GesturePhases.justTags.Ended, "GestureJustEnded"],
      [cat.GesturePhases.justTags.Failed, "GestureJustFailed"],
      [cat.GesturePhases.justTags.Cancelled, "GestureJustCancelled"],
    ];
    for (const [t, name] of markers) expect(schemaMeta.tagName(t)).toBe(name);
    // The named phase tags are the SAME handles the PhaseSet exposes (re-exports, not clones).
    expect(cat.GesturePossible).toBe(cat.GesturePhases.tags.Possible);
    expect(cat.GestureActive).toBe(cat.GesturePhases.tags.Active);
  });

  it("GesturePhases.set moves a recognizer Possible→Active and raises GestureJustActive exactly once", () => {
    const world = createWorld();
    const rec = world.spawn();

    cat.GesturePhases.set(world, rec, "Possible");
    expect(cat.GesturePhases.current(world, rec)).toBe("Possible");

    cat.GesturePhases.set(world, rec, "Active");
    // Exclusive persistent phase: Possible dropped for Active.
    expect(cat.GesturePhases.current(world, rec)).toBe("Active");
    expect(world.hasTag(rec, cat.GesturePossible)).toBe(false);
    expect(world.hasTag(rec, cat.GestureActive)).toBe(true);

    // EXACTLY ONE Just* marker is raised, and it is the entered phase's.
    const raised = cat.GesturePhases.phases.filter((p) => world.hasTag(rec, cat.GesturePhases.justTags[p]));
    expect(raised).toEqual(["Active"]);

    // The marker is one-tick: cleanup clears it while the persistent phase stays.
    cat.GesturePhases.clearMarkers(world, rec);
    expect(world.hasTag(rec, cat.GesturePhases.justTags.Active)).toBe(false);
    expect(world.hasTag(rec, cat.GestureActive)).toBe(true);
  });

  it("recognizer relations carry the right arities", () => {
    expect(arityOf(cat.Watches)).toBe("many");
    expect(arityOf(cat.Captures)).toBe("one");
    expect(arityOf(cat.Drags)).toBe("many");
    expect(arityOf(cat.ClaimedBy)).toBe("one");
    expect(arityOf(cat.DropTarget)).toBe("one");
  });

  it("Grab/Down latch real origins (bare); SnapState is zeroed (defaulted)", () => {
    expect(scalarType(cat.Grab, "x")).toBe("f64");
    expect(scalarType(cat.Grab, "w")).toBe("f32");
    // The order memo (petition 8): parent + nearest non-dragged predecessor
    // (eids; 0 = none) + the original sibling index.
    expect(scalarType(cat.Grab, "parent")).toBe("eid");
    expect(scalarType(cat.Grab, "prev")).toBe("eid");
    expect(scalarType(cat.Grab, "ord")).toBe("f64");
    expect(requiredFields(cat.Grab)).toEqual(["x", "y", "w", "h", "parent", "prev", "ord"]);
    expect(requiredFields(cat.Down)).toEqual(["x", "y", "ms"]);
    expect(requiredFields(cat.SnapState)).toEqual([]);
  });

  it("OverlapCandidate is a tag; TransformTween eases toward a supplied target", () => {
    expect(schemaMeta.tagName(cat.OverlapCandidate)).toBe("OverlapCandidate");
    expect(scalarType(cat.TransformTween, "toX")).toBe("f64");
    expect(scalarType(cat.TransformTween, "durationMs")).toBe("f32");
    expect(requiredFields(cat.TransformTween)).toEqual(["toX", "toY", "durationMs"]);
  });
});

describe("selection & presence (§5.6, §5.8)", () => {
  it("Selected + capability tags exist", () => {
    const tags: [Tag, string][] = [
      [cat.Selected, "Selected"],
      [cat.Selectable, "Selectable"],
      [cat.Movable, "Movable"],
      [cat.Resizable, "Resizable"],
      [cat.SnapSource, "SnapSource"],
      [cat.SnapTarget, "SnapTarget"],
    ];
    for (const [t, name] of tags) expect(schemaMeta.tagName(t)).toBe(name);
  });

  it("PresenceInfo identity is required; PresenceCursor.device enumerates devices", () => {
    expect(requiredFields(cat.PresenceInfo)).toEqual(["name", "color"]);
    expect(enumLabels(cat.PresenceCursor, "device")).toEqual(["mouse", "touch", "pen"]);
    expect(scalarType(cat.PresenceCursor, "x")).toBe("f64");
  });

  it("SelectionSummary is a capped summary (count u16, keys string)", () => {
    expect(scalarType(cat.SelectionSummary, "count")).toBe("u16");
    expect(scalarType(cat.SelectionSummary, "keys")).toBe("string");
  });
});

describe("camera / resources / derived / chrome / nav (§5.7, §5.8)", () => {
  it("Camera/Viewport/ActiveTool/SnapConfig are runtime resources", () => {
    const resources: [Resource, string][] = [
      [cat.Camera, "Camera"],
      [cat.Viewport, "Viewport"],
      [cat.ActiveTool, "ActiveTool"],
      [cat.SnapConfig, "SnapConfig"],
    ];
    for (const [r, name] of resources) {
      const meta = schemaMeta.resource(r);
      expect(meta?.name).toBe(name);
      expect(meta?.durable).toBe(false);
    }
  });

  it("SnapConfig defaults equal SNAP_DEFAULTS (single source of truth pin)", () => {
    expect(defaultOf(cat.SnapConfig, "enabled")).toBe(SNAP_DEFAULTS.enabled);
    expect(defaultOf(cat.SnapConfig, "thresholdPx")).toBe(SNAP_DEFAULTS.thresholdPx);
  });

  it("Camera fields have the right types; ContainerCamera is a component rider", () => {
    expect(scalarType(cat.Camera, "x")).toBe("f64");
    expect(scalarType(cat.Camera, "zoom")).toBe("f32");
    expect(scalarType(cat.Camera, "gesturing")).toBe("bool");
    // rider is a COMPONENT, not a resource
    expect(schemaMeta.resource(cat.ContainerCamera as unknown as Resource)).toBeUndefined();
    expect(schemaMeta.component(cat.ContainerCamera)?.name).toBe("ContainerCamera");
  });

  it("Active/Visible/Culled/CanvasSurface tags exist", () => {
    expect(schemaMeta.tagName(cat.Active)).toBe("Active");
    expect(schemaMeta.tagName(cat.Visible)).toBe("Visible");
    expect(schemaMeta.tagName(cat.Culled)).toBe("Culled");
    expect(schemaMeta.tagName(cat.CanvasSurface)).toBe("CanvasSurface");
  });

  it("WidgetBreakpoint has the 5-tier enum + u16 dims", () => {
    expect(enumLabels(cat.WidgetBreakpoint, "tier")).toEqual([
      "micro",
      "compact",
      "normal",
      "expanded",
      "detailed",
    ]);
    expect(scalarType(cat.WidgetBreakpoint, "w")).toBe("u16");
  });

  it("chrome enums match: HandleSpec 8 anchors, GuideLine axis, CursorVisual kind", () => {
    expect(enumLabels(cat.HandleSpec, "anchor")).toEqual([
      "nw",
      "n",
      "ne",
      "e",
      "se",
      "s",
      "sw",
      "w",
    ]);
    expect(requiredFields(cat.HandleSpec)).toEqual(["anchor"]);
    expect(enumLabels(cat.GuideLine, "axis")).toEqual(["x", "y"]);
    expect(enumLabels(cat.CursorVisual, "kind")).toEqual(["local", "remote"]);
  });

  it("SelectionBox/MarqueeBox/MeasuredSize field types", () => {
    expect(scalarType(cat.SelectionBox, "x")).toBe("f64");
    expect(scalarType(cat.SelectionBox, "w")).toBe("f32");
    expect(scalarType(cat.MarqueeBox, "y")).toBe("f64");
    expect(scalarType(cat.MeasuredSize, "w")).toBe("f32");
  });

  it("Follows/VisualOf/NavFrame are arity-one; NavDepth u8, NavCamera f64/f32", () => {
    expect(arityOf(cat.Follows)).toBe("one");
    expect(arityOf(cat.VisualOf)).toBe("one");
    expect(arityOf(cat.NavFrame)).toBe("one");
    expect(scalarType(cat.NavDepth, "d")).toBe("u8");
    expect(scalarType(cat.NavCamera, "x")).toBe("f64");
    expect(scalarType(cat.NavCamera, "zoom")).toBe("f32");
  });
});
