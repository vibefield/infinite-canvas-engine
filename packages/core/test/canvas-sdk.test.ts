import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { createWorld } from "@vibecook/strata-ecs";
import { attachDurable, createDurableStore } from "@vibecook/strata-ecs/durable";
import {
  Accepts,
  ActiveTool,
  Camera,
  ChildOf,
  DefaultCanvasType,
  ENGINE_SCHEMA_VERSION,
  PrefabId,
  Position,
  NavTransition,
  Selected,
  Size,
  Viewport,
  canvasPackId,
  compileEngineCatalog,
  contributeCanvasCatalog,
  createCanvasEngine,
  createDrawTool,
  createFramePreviewStore,
  decodeEnvelope,
  defineCanvasRuntimeExtension,
  defineResource,
  defineCanvasType,
  defineComponent,
  defineContainer,
  defineFrameBehavior,
  defineFrameProjection,
  defineQuery,
  defineWidget,
  encodeCanvasIdentity,
  encodeEnvelope,
  field,
  frameBehaviorPackId,
  instantiate,
  p,
  resolvePortal,
  tools,
  widgetSpawnInits,
  writeRuntimeResource,
  type CanvasEngine,
  type Entity,
} from "../src";
import { ensureBoardRoot } from "../src/doc/schema-migrate";

const Sticky = defineWidget({
  type: "canvas-sdk:sticky",
  surface: "dom",
  component: null,
  provides: ["whiteboard.item"],
});

const BoardCard = defineWidget({
  type: "canvas-sdk:board-card",
  surface: "dom",
  component: null,
  provides: ["board.item"],
});

function requireTool(id: string) {
  const tool = tools.get(id);
  if (tool === undefined) throw new Error(`built-in tool ${id} unavailable`);
  return tool;
}

const select = requireTool("select");
const pan = requireTool("pan");
const drawSticky = createDrawTool(Sticky.type, { id: "canvas-sdk:draw-sticky" });
const drawBoardCard = createDrawTool(BoardCard.type, { id: "canvas-sdk:draw-board-card" });

const WhiteboardCanvas = defineCanvasType({
  id: "canvas-sdk:whiteboard",
  semanticVersion: 1,
  semantic: { placement: { widgets: [Sticky] } },
  presentation: {
    tools: { allowed: [select, pan, drawSticky], default: select },
    ground: { program: "line-grid" },
    camera: { arrival: "fit", padding: 48, minZoom: 0.25, maxZoom: 2 },
  },
});

const WhiteboardContainer = defineContainer({
  type: "canvas-sdk:whiteboard-container",
  canvas: WhiteboardCanvas,
  component: null,
  defaultSize: { w: 360, h: 280 },
  portal: { top: 12, right: 12, bottom: 40, left: 12 },
  provides: ["board.item", "canvas-container"],
});

const BoardCanvas = defineCanvasType({
  id: "canvas-sdk:board",
  semanticVersion: 1,
  semantic: { placement: { widgets: [BoardCard, WhiteboardContainer] } },
  presentation: {
    catalog: {
      sections: [{ id: "board", order: 10, items: [BoardCard, WhiteboardContainer] }],
    },
    tools: { allowed: [select, pan, drawBoardCard], default: select },
    ground: { program: "dot-grid" },
  },
});

const whiteboardCatalog = contributeCanvasCatalog({
  id: "canvas-sdk:whiteboard-base",
  canvas: WhiteboardCanvas,
  sections: [{ id: "whiteboard", order: 10, items: [Sticky] }],
});

const BrokenCanvas = defineCanvasType({
  id: "canvas-sdk:broken",
  semanticVersion: 1,
  semantic: { placement: { widgets: [BoardCard] } },
});

const RuntimeMark = defineComponent("canvasSdkRuntimeMark", { marked: "bool" });
let runtimeExtensionRuns = 0;
const MarkWhiteboardChildren = defineCanvasRuntimeExtension({
  id: "canvas-sdk:mark-whiteboard-children",
  version: 1,
  writesRuntime: [RuntimeMark],
  run(ctx) {
    runtimeExtensionRuns += 1;
    for (const child of ctx.children) ctx.set(child, RuntimeMark, { marked: true });
  },
});
const RuntimeCanvas = defineCanvasType({
  id: "canvas-sdk:runtime-canvas",
  semanticVersion: 1,
  semantic: { placement: { widgets: [Sticky] } },
  presentation: {
    tools: { allowed: [select, pan, drawSticky], default: select },
    runtimeExtensions: [MarkWhiteboardChildren],
  },
});
const RuntimeContainer = defineContainer({
  type: "canvas-sdk:runtime-container",
  canvas: RuntimeCanvas,
  component: null,
});

/**
 * A runtime extension whose faults are scripted, reading ONE resource so a
 * single write is the whole frame's dirt — the dispatch after a faulting one
 * then carries nothing of its own, which is exactly the window the rollback
 * used to strand.
 */
const RuntimeDirt = defineResource("canvasSdkRuntimeDirt", {
  n: field("f64", { default: 0 }),
});
let faultingRuns = 0;
let faultingThrows = 0;
const FaultingRuntimeExtension = defineCanvasRuntimeExtension({
  id: "canvas-sdk:faulting-runtime-extension",
  version: 1,
  reads: [RuntimeDirt],
  writesRuntime: [RuntimeMark],
  run(ctx) {
    faultingRuns += 1;
    if (faultingThrows > 0) {
      faultingThrows -= 1;
      throw new Error("canvas-sdk scripted runtime extension fault");
    }
    for (const child of ctx.children) ctx.set(child, RuntimeMark, { marked: true });
  },
});
const FaultingRuntimeCanvas = defineCanvasType({
  id: "canvas-sdk:faulting-runtime-canvas",
  semanticVersion: 1,
  semantic: { placement: { widgets: [Sticky] } },
  presentation: {
    tools: { allowed: [select, pan, drawSticky], default: select },
    runtimeExtensions: [FaultingRuntimeExtension],
  },
});
const FaultingRuntimeContainer = defineContainer({
  type: "canvas-sdk:faulting-runtime-container",
  canvas: FaultingRuntimeCanvas,
  component: null,
});

const BehaviorSticky = defineWidget({
  type: "canvas-sdk:behavior-sticky",
  surface: "dom",
  component: null,
  props: { normalized: p.boolean({ default: false }) },
  instancePreview: { props: ["normalized"] },
});
const BehaviorStickyProps = BehaviorSticky.groups[0]?.component;
if (BehaviorStickyProps === undefined) throw new Error("missing generated behavior props group");
let frameBehaviorRuns = 0;
const NormalizeFrame = defineFrameBehavior({
  id: "canvas-sdk:normalize-frame",
  version: 1,
  reads: [PrefabId, BehaviorStickyProps],
  writesDurable: [BehaviorStickyProps],
  run(ctx) {
    frameBehaviorRuns += 1;
    for (const child of ctx.children) {
      if (ctx.read(child, PrefabId).id !== BehaviorSticky.type) continue;
      const current = ctx.read(child, BehaviorStickyProps) as { normalized: boolean };
      if (!current.normalized) ctx.set(child, BehaviorStickyProps, { normalized: true });
    }
  },
});
const BehaviorCanvas = defineCanvasType({
  id: "canvas-sdk:behavior-canvas",
  semanticVersion: 1,
  semantic: {
    placement: { widgets: [BehaviorSticky] },
    frameBehaviors: [NormalizeFrame],
  },
  presentation: { tools: { allowed: [select, pan], default: select } },
});
const BehaviorContainer = defineContainer({
  type: "canvas-sdk:behavior-container",
  canvas: BehaviorCanvas,
  component: null,
});
const EmptyCanvas = defineCanvasType({
  id: "canvas-sdk:empty-canvas",
  semanticVersion: 1,
  semantic: { placement: {} },
  presentation: { tools: { allowed: [select, pan], default: select } },
});
const EmptyContainer = defineContainer({
  type: "canvas-sdk:empty-container",
  canvas: EmptyCanvas,
  component: null,
});

let previewProjectionRuns = 0;
const PreviewProjection = defineFrameProjection({
  id: "canvas-sdk:preview-projection",
  reads: [BehaviorStickyProps],
  relations: [ChildOf],
  project(ctx) {
    previewProjectionRuns += 1;
    return {
      labels: ctx.children.map((child) => ({
        key: child.key,
        normalized: (ctx.get(child.key, BehaviorStickyProps) as { normalized: boolean } | undefined)
          ?.normalized,
      })),
      containment: ctx.relations(ChildOf),
    };
  },
});
const PreviewCanvas = defineCanvasType({
  id: "canvas-sdk:preview-canvas",
  semanticVersion: 1,
  semantic: { placement: { widgets: [BehaviorSticky] } },
  presentation: {
    tools: { allowed: [select, pan], default: select },
    preview: { projection: PreviewProjection },
  },
});
const PreviewContainer = defineContainer({
  type: "canvas-sdk:preview-container",
  canvas: PreviewCanvas,
  component: null,
  defaultSize: { w: 320, h: 240 },
  portal: { top: 10, right: 20, bottom: 30, left: 40 },
});

const AlwaysFaults = defineFrameBehavior({
  id: "canvas-sdk:always-faults",
  version: 1,
  run() {
    throw new Error("semantic fault");
  },
});
const FaultCanvas = defineCanvasType({
  id: "canvas-sdk:fault-canvas",
  semanticVersion: 1,
  semantic: {
    placement: { widgets: [BehaviorSticky] },
    frameBehaviors: [AlwaysFaults],
  },
  presentation: { tools: { allowed: [select, pan], default: select } },
});

let migrationRuns = 0;
const MigratingCanvas = defineCanvasType({
  id: "canvas-sdk:migrating",
  semanticVersion: 2,
  semantic: { placement: { widgets: [Sticky] } },
  migrations: [
    {
      from: 1,
      to: 2,
      existingPlacement: "preserve-and-warn",
      migrate(ctx) {
        migrationRuns += 1;
        expect(ctx.frame).toBeDefined();
      },
    },
  ],
  presentation: { tools: { allowed: [select, pan], default: select } },
});

/**
 * The legacy container sugar: `defineWidget({container})` with no `canvas`
 * binds to `ice.default@1` (define-widget's normalization default), so its
 * compiled dependency closure demands the canvas pack marker that only the
 * schema 2→3 step writes.
 */
const LegacyFolder = defineWidget({
  type: "canvas-sdk:legacy-folder",
  surface: "dom",
  component: null,
  container: { accepts: ["board.item"] },
});

const LegacyHostCanvas = defineCanvasType({
  id: "canvas-sdk:legacy-host",
  semanticVersion: 1,
  semantic: { placement: { widgets: [Sticky, LegacyFolder] } },
  presentation: { tools: { allowed: [select, pan], default: select } },
});

const widgetQ = defineQuery([PrefabId]);

function countType(engine: CanvasEngine, type: string): number {
  let count = 0;
  engine.world.query(widgetQ).each((batch) => {
    for (const row of batch) {
      if (engine.world.read(batch.entity(row), PrefabId).id === type) count += 1;
    }
  });
  return count;
}

function makeEngine(): CanvasEngine {
  return createCanvasEngine({
    widgets: [Sticky, BoardCard, WhiteboardContainer],
    tools: [select, pan, drawSticky, drawBoardCard],
    canvasTypes: [BoardCanvas, WhiteboardCanvas],
    rootCanvas: BoardCanvas,
    presentationFallback: DefaultCanvasType,
    catalogContributions: [whiteboardCatalog],
  });
}

function rootOnlyEnvelope(
  id: string,
  semanticVersion: number,
  extraPacks: Readonly<Record<string, number>> = {},
): Uint8Array {
  const world = createWorld();
  const loro = new LoroDoc();
  const store = createDurableStore(loro);
  store.metaTransaction((meta) => {
    meta.set("engine.schema.3", true);
    meta.set(`engine.pack.${canvasPackId(id)}.${semanticVersion}`, true);
    for (const [pack, version] of Object.entries(extraPacks)) {
      meta.set(`engine.pack.${pack}.${version}`, true);
    }
    meta.set("ice:rootCanvas", encodeCanvasIdentity({ id, semanticVersion }));
  });
  const attachment = attachDurable(world, store);
  ensureBoardRoot(world, store);
  const payload = store.exportSnapshot();
  attachment.detach();
  return encodeEnvelope(
    {
      engineSchema: 3,
      prefabVersions: { [canvasPackId(id)]: semanticVersion, ...extraPacks },
      rootCanvas: { id, semanticVersion },
    },
    payload,
  );
}

function contentWithoutRequirementEnvelope(): Uint8Array {
  const world = createWorld();
  const loro = new LoroDoc();
  const store = createDurableStore(loro);
  store.metaTransaction((meta) => {
    meta.set("engine.schema.3", true);
    meta.set(`engine.pack.${canvasPackId(DefaultCanvasType.id)}.1`, true);
    meta.set(
      "ice:rootCanvas",
      encodeCanvasIdentity({ id: DefaultCanvasType.id, semanticVersion: 1 }),
    );
  });
  const attachment = attachDurable(world, store);
  const root = ensureBoardRoot(world, store);
  const { prefab, overrides } = widgetSpawnInits(
    Sticky.type,
    { x: 0, y: 0, w: 100, h: 100 },
    Sticky,
  );
  store.transaction((tx) => {
    const entity = instantiate(prefab, { into: "tx", tx }, overrides);
    tx.setRelation(entity, ChildOf, root);
  });
  const payload = store.exportSnapshot();
  attachment.detach();
  return encodeEnvelope(
    {
      engineSchema: 3,
      prefabVersions: { [canvasPackId(DefaultCanvasType.id)]: 1 },
      rootCanvas: { id: DefaultCanvasType.id, semanticVersion: 1 },
    },
    payload,
  );
}

/**
 * A GENUINE pre-design-011 document: schema 2, no `ice:rootCanvas`, and no
 * canvas pack markers at all — the 2→3 structural step is the only writer of
 * either. `packVersions` are the durable prefab markers such a doc carries.
 */
function legacySchema2Envelope(packVersions: Readonly<Record<string, number>>): Uint8Array {
  const world = createWorld();
  const loro = new LoroDoc();
  const store = createDurableStore(loro);
  store.metaTransaction((meta) => {
    meta.set("engine.schema.2", true);
    for (const [pack, version] of Object.entries(packVersions)) {
      meta.set(`engine.pack.${pack}.${version}`, true);
    }
  });
  const attachment = attachDurable(world, store);
  ensureBoardRoot(world, store);
  const payload = store.exportSnapshot();
  attachment.detach();
  return encodeEnvelope({ engineSchema: 2, prefabVersions: { ...packVersions } }, payload);
}

describe("Canvas SDK compilation", () => {
  it("compiles immutable per-canvas placement, catalog, tool, and pack authority", () => {
    const catalog = compileEngineCatalog({
      widgets: [Sticky, BoardCard, WhiteboardContainer],
      tools: [select, pan, drawSticky, drawBoardCard],
      canvasTypes: [BoardCanvas, WhiteboardCanvas],
      rootCanvas: BoardCanvas,
      presentationFallback: DefaultCanvasType,
      catalogContributions: [whiteboardCatalog],
    });

    expect([...catalog.placementFor(WhiteboardCanvas.id)]).toEqual([Sticky.type]);
    expect(catalog.catalogFor(WhiteboardCanvas.id)[0]?.items).toEqual([Sticky]);
    expect(catalog.toolsFor(BoardCanvas.id).map((tool) => tool.id)).toContain(drawBoardCard.id);
    expect(catalog.toolsFor(WhiteboardCanvas.id).map((tool) => tool.id)).not.toContain(
      drawBoardCard.id,
    );
    expect(catalog.initialPacks()).toMatchObject({
      [canvasPackId(BoardCanvas.id)]: 1,
      [canvasPackId(WhiteboardCanvas.id)]: 1,
      [WhiteboardContainer.prefab.id]: 1,
    });
  });

  it("rejects a CanvasType whose placement references an uncompiled widget", () => {
    expect(() =>
      compileEngineCatalog({
        widgets: [Sticky],
        tools: [select, pan],
        canvasTypes: [BrokenCanvas],
        rootCanvas: BrokenCanvas,
        presentationFallback: DefaultCanvasType,
      }),
    ).toThrow(/uncompiled widget/);
  });

  it("rejects a preview byte budget smaller than the mandatory envelope", () => {
    expect(() =>
      createCanvasEngine({
        widgets: [Sticky, BoardCard, WhiteboardContainer],
        tools: [select, pan, drawSticky, drawBoardCard],
        canvasTypes: [BoardCanvas, WhiteboardCanvas],
        rootCanvas: BoardCanvas,
        presentationFallback: DefaultCanvasType,
        catalogContributions: [whiteboardCatalog],
        budgets: { framePreviewBytes: 511 },
      }),
    ).toThrow(/between 512 and 524288/);
  });

  it("keeps runtime authority isolated between simultaneous engines", () => {
    const whiteboard = createCanvasEngine({
      widgets: [Sticky],
      tools: [select, pan, drawSticky],
      canvasTypes: [WhiteboardCanvas],
      rootCanvas: WhiteboardCanvas,
      presentationFallback: DefaultCanvasType,
    });
    const board = createCanvasEngine({
      widgets: [BoardCard],
      tools: [select, pan, drawBoardCard],
      canvasTypes: [BrokenCanvas],
      rootCanvas: BrokenCanvas,
      presentationFallback: DefaultCanvasType,
    });
    try {
      whiteboard.docs.create();
      board.docs.create();
      expect(() => whiteboard.ops.spawnWidget(BoardCard.type, { x: 0, y: 0 })).toThrow(
        /not compiled/,
      );
      expect(() => board.ops.spawnWidget(Sticky.type, { x: 0, y: 0 })).toThrow(
        /not compiled/,
      );
      expect(whiteboard.ops.spawnWidget(Sticky.type, { x: 0, y: 0 })).toBeTypeOf("number");
      expect(board.ops.spawnWidget(BoardCard.type, { x: 0, y: 0 })).toBeTypeOf("number");
    } finally {
      whiteboard.dispose();
      board.dispose();
    }
  });
});

describe("typed frame navigation and placement", () => {
  it("switches catalog/tools, restores the parent tool, and ignores durable Accepts edits", () => {
    const engine = makeEngine();
    try {
      const doc = engine.docs.create();
      const header = decodeEnvelope(doc.exportEnvelope()).header;
      expect(header.rootCanvas).toEqual({ id: BoardCanvas.id, semanticVersion: 1 });
      expect(header.prefabVersions[canvasPackId(BoardCanvas.id)]).toBe(1);
      expect(engine.canvas.current()).toMatchObject({
        state: "attached",
        typeId: BoardCanvas.id,
        depth: 0,
      });

      const folder = engine.ops.spawnWidget(WhiteboardContainer.type, { x: 20, y: 30 });
      const boardCard = engine.ops.spawnWidget(BoardCard.type, { x: 400, y: 30 });
      engine.step(16);
      engine.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
      engine.ops.setSelection([folder]);
      engine.ops.setTool(drawBoardCard.id);
      engine.ops.enterContainer(folder, { transition: "none" });

      expect(engine.canvas.current()).toMatchObject({
        state: "attached",
        frame: folder,
        typeId: WhiteboardCanvas.id,
        depth: 1,
      });
      expect(engine.canvas.catalog()[0]?.items).toEqual([Sticky]);
      expect(engine.canvas.tools().map((tool) => tool.id)).not.toContain(drawBoardCard.id);
      expect(engine.world.getResource(ActiveTool)?.id).toBe("select");
      expect(engine.world.hasTag(folder, Selected)).toBe(false);
      expect(() => engine.ops.spawnWidget(BoardCard.type, { x: 0, y: 0 })).toThrow(
        /does not allow widget/,
      );
      const sticky = engine.ops.spawnWidget(Sticky.type, { x: 0, y: 0 });
      engine.step(16);
      expect(engine.world.getRelation(sticky, ChildOf)).toBe(folder);

      engine.ops.exitContainer({ transition: "none" });
      expect(engine.canvas.current()).toMatchObject({ typeId: BoardCanvas.id, depth: 0 });
      expect(engine.world.getResource(ActiveTool)?.id).toBe(drawBoardCard.id);

      doc.store.transaction((tx) => {
        tx.edit(folder).set(Accepts, { list: JSON.stringify(["board.item"]) });
      });
      expect(engine.placement.canIngress(BoardCard.type, folder)).toMatchObject({
        ok: false,
        reason: "widget-not-allowed",
      });
      expect(() =>
        engine.ops.spawnWidget(Sticky.type, { x: 0, y: 0, parent: boardCard }),
      ).toThrow(/neither BoardRoot nor a compiled container/);
    } finally {
      engine.dispose();
    }
  });

  it("forces an atomic cut while the required cross-ground adapter is unavailable", () => {
    const engine = makeEngine();
    try {
      engine.docs.create();
      const root = engine.canvas.current();
      if (root.state !== "attached") throw new Error("missing attached CanvasSession");
      const folder = engine.ops.spawnWidget(WhiteboardContainer.type, { x: 20, y: 30 });
      engine.step(16);
      engine.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
      engine.ops.enterContainer(folder);
      expect(engine.canvas.current()).toMatchObject({ typeId: WhiteboardCanvas.id });
      expect(engine.world.getResource(NavTransition)).toMatchObject({
        active: false,
        epoch: 1,
        documentEpoch: root.documentEpoch,
        fromFrame: root.frame,
        toFrame: folder,
        fromTypeId: BoardCanvas.id,
        toTypeId: WhiteboardCanvas.id,
      });

      engine.ops.exitContainer({ transition: "none" });
      expect(engine.world.getResource(NavTransition)).toMatchObject({
        active: false,
        epoch: 2,
        documentEpoch: root.documentEpoch,
        fromFrame: folder,
        toFrame: root.frame,
        fromTypeId: WhiteboardCanvas.id,
        toTypeId: BoardCanvas.id,
      });
    } finally {
      engine.dispose();
    }
  });

  it("permits cross-ground flight only after the required retained plane prepares", () => {
    const engine = makeEngine();
    const frames: number[] = [];
    const releases: string[] = [];
    const detach = engine.transitions.register({
      id: "test-ground-retainer",
      plane: "ground",
      prepare: () => ({
        update: (frame) => frames.push(frame.epoch),
        release: (reason) => releases.push(reason),
      }),
    });
    try {
      engine.docs.create();
      const folder = engine.ops.spawnWidget(WhiteboardContainer.type, { x: 20, y: 30 });
      engine.step(16);
      engine.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
      engine.ops.enterContainer(folder);
      expect(engine.world.getResource(NavTransition)).toMatchObject({
        active: true,
        epoch: 1,
        fromTypeId: BoardCanvas.id,
        toTypeId: WhiteboardCanvas.id,
      });
      expect(engine.transitions.stats()).toMatchObject({
        active: true,
        motion: "flight",
        retainers: 1,
      });
      expect(frames).toEqual([1]);

      const transition = engine.world.getResource(NavTransition);
      if (transition === undefined) throw new Error("missing retained nav transition");
      engine.world.setResource(NavTransition, { ...transition, active: false, p: 1, v: 0 });
      engine.step(32);
      expect(releases).toEqual(["settled"]);
      expect(engine.transitions.stats().active).toBe(false);
    } finally {
      detach();
      engine.dispose();
    }
  });

  it("rejects an intent captured before a CanvasSession epoch switch", () => {
    const engine = makeEngine();
    try {
      engine.docs.create();
      const folder = engine.ops.spawnWidget(WhiteboardContainer.type, { x: 0, y: 0 });
      engine.step(16);
      const captured = engine.canvas.current();
      if (captured.state !== "attached") throw new Error("missing attached CanvasSession");
      engine.ops.enterContainer(folder, { transition: "none" });
      const gesture = engine.world.spawn();
      const accepted = engine.stack.sink.commit({
        kind: "create",
        gesture,
        writes: [],
        scope: {
          documentEpoch: captured.documentEpoch,
          canvasEpoch: captured.epoch,
        },
        creates: [
          {
            type: BoardCard.type,
            x: 0,
            y: 0,
            w: 240,
            h: 160,
            parent: captured.frame,
          },
        ],
      });
      expect(accepted).toBe(false);
      expect(countType(engine, BoardCard.type)).toBe(0);
    } finally {
      engine.dispose();
    }
  });
});

describe("selection scope", () => {
  it("selects a widget spawned into the open frame before any derive tick", () => {
    const engine = makeEngine();
    try {
      engine.docs.create();
      // NO engine.step() between spawn and select: `Active` is stamped by the
      // derive-phase membership tick, and ops run outside the tick.
      const card = engine.ops.spawnWidget(BoardCard.type, { x: 0, y: 0 });
      engine.ops.setSelection([card]);
      expect(engine.world.hasTag(card, Selected)).toBe(true);

      // Same inside a nested canvas, immediately after entering it.
      const folder = engine.ops.spawnWidget(WhiteboardContainer.type, { x: 20, y: 30 });
      engine.step(16);
      engine.ops.enterContainer(folder, { transition: "none" });
      const sticky = engine.ops.spawnWidget(Sticky.type, { x: 0, y: 0 });
      engine.ops.setSelection([sticky]);
      expect(engine.world.hasTag(sticky, Selected)).toBe(true);
      engine.step(32);
      expect(engine.world.hasTag(sticky, Selected)).toBe(true); // survives the tick
    } finally {
      engine.dispose();
    }
  });

  it("keeps foreign-canvas entities out of scope, spawned into one or left behind in one", () => {
    const engine = makeEngine();
    try {
      engine.docs.create();
      const folder = engine.ops.spawnWidget(WhiteboardContainer.type, { x: 20, y: 30 });
      engine.step(16);

      // Spawned into ANOTHER canvas by explicit parent while the root is open —
      // never a member here, so the scope filter must drop it even pre-tick.
      const foreignSticky = engine.ops.spawnWidget(Sticky.type, {
        x: 0,
        y: 0,
        parent: folder,
      });
      engine.ops.setSelection([foreignSticky]);
      expect(engine.world.hasTag(foreignSticky, Selected)).toBe(false);

      // And left behind in a canvas the user has since exited.
      engine.ops.enterContainer(folder, { transition: "none" });
      const inner = engine.ops.spawnWidget(Sticky.type, { x: 40, y: 40 });
      engine.step(32);
      engine.ops.exitContainer({ transition: "none" });
      engine.step(48);
      engine.ops.setSelection([inner]);
      expect(engine.world.hasTag(inner, Selected)).toBe(false);

      // deleteSelection reads the same scope: an out-of-scope id survives.
      const before = countType(engine, Sticky.type);
      engine.world.addTag(inner, Selected);
      engine.ops.deleteSelection();
      engine.step(64);
      expect(countType(engine, Sticky.type)).toBe(before);
    } finally {
      engine.dispose();
    }
  });
});

describe("semantic frame previews", () => {
  it("includes malformed effective descendants without crossing into nested frames", () => {
    const catalog = compileEngineCatalog({
      widgets: [BehaviorSticky, PreviewContainer],
      tools: [select, pan],
      canvasTypes: [DefaultCanvasType, PreviewCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
      frameProjections: [PreviewProjection],
    });
    const world = createWorld();
    world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
    const frame = world.spawn({
      components: [
        [PrefabId, { id: PreviewContainer.type }],
        [Position, { x: 0, y: 0 }],
        [Size, { w: 360, h: 280 }],
      ],
    });
    const direct = world.spawn({
      components: [
        [PrefabId, { id: BehaviorSticky.type }],
        [Position, { x: 0, y: 0 }],
        [Size, { w: 100, h: 80 }],
        [BehaviorStickyProps, { normalized: false }],
      ],
    });
    const malformed = world.spawn({
      components: [
        [PrefabId, { id: BehaviorSticky.type }],
        [Position, { x: 500, y: 20 }],
        [Size, { w: 100, h: 80 }],
        [BehaviorStickyProps, { normalized: true }],
      ],
    });
    world.setRelation(direct, ChildOf, frame);
    world.setRelation(malformed, ChildOf, direct);
    const previews = createFramePreviewStore({
      world,
      catalog,
      session: () => ({ documentEpoch: 1 }),
      diagnostics: () => [
        {
          code: "malformed-parent",
          key: "malformed",
          entity: malformed,
          frame,
          canvasTypeId: PreviewCanvas.id,
          message: "test malformed owner",
          removesWriteAuthority: false,
        },
      ],
    });
    const unsubscribe = previews.subscribe(frame, () => {});
    const snapshot = previews.snapshot(frame);
    expect(snapshot.children.map((child) => child.key)).toEqual([`1:${direct}`, `1:${malformed}`]);
    expect(snapshot.children[1]?.validity).toBe("malformed-parent");
    expect(snapshot.bounds).toEqual({ x: 0, y: 0, width: 600, height: 100 });
    unsubscribe();
    expect(previews.stats().observers).toBe(0);
    previews.dispose();
  });

  it("is demand-driven, stable, bounded, and uses the shared portal resolver", async () => {
    previewProjectionRuns = 0;
    const engine = createCanvasEngine({
      widgets: [BehaviorSticky, PreviewContainer],
      tools: [select, pan],
      canvasTypes: [DefaultCanvasType, PreviewCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
      frameProjections: [PreviewProjection],
      budgets: { framePreviewChildren: 1 },
    });
    try {
      const doc = engine.docs.create();
      const frame = engine.ops.spawnWidget(PreviewContainer.type, { x: 20, y: 30 });
      engine.step(8);
      const first = engine.ops.spawnWidget(BehaviorSticky.type, {
        x: 5,
        y: 7,
        parent: frame,
      });
      engine.ops.spawnWidget(BehaviorSticky.type, { x: 80, y: 90, parent: frame });
      engine.step(16);

      // A read alone is inert: no query, child observer, or projection runs.
      const dormant = engine.previews.snapshot(frame);
      expect(dormant.revision).toBe(0);
      expect(engine.previews.stats()).toMatchObject({ activeFrames: 0, observers: 0 });
      expect(previewProjectionRuns).toBe(0);

      let notifications = 0;
      const unsubscribe = engine.previews.subscribe(frame, () => {
        notifications += 1;
      });
      const initial = engine.previews.snapshot(frame);
      expect(initial).toMatchObject({
        totalChildren: 2,
        truncated: true,
        portal: { x: 40, y: 10, width: 260, height: 200 },
      });
      expect(initial.portal).toEqual(
        resolvePortal(engine.world, frame, PreviewContainer.container)?.local,
      );
      expect(initial.children).toHaveLength(1);
      expect(initial.children[0]?.previewModel).toEqual({ normalized: false });
      expect(initial.facets).toMatchObject({
        labels: [{ normalized: false }],
        containment: [{ source: initial.children[0]?.key, target: initial.frameKey }],
      });
      expect(engine.previews.stats().observers).toBeGreaterThan(0);

      engine.step(32);
      await Promise.resolve();
      expect(engine.previews.snapshot(frame)).toBe(initial);

      doc.store.transaction((tx) => {
        tx.edit(first).set(BehaviorStickyProps, { normalized: true });
      });
      engine.step(48);
      await Promise.resolve();
      const changed = engine.previews.snapshot(frame);
      expect(changed).not.toBe(initial);
      expect(changed.revision).toBe(initial.revision + 1);
      expect(changed.facets).toMatchObject({ labels: [{ normalized: true }] });
      expect(changed.children[0]?.previewModel).toEqual({ normalized: true });
      expect(notifications).toBeGreaterThan(0);

      unsubscribe();
      const stopped = engine.previews.stats();
      expect(stopped).toMatchObject({ activeFrames: 0, observers: 0 });
      doc.store.transaction((tx) => {
        tx.edit(first).set(BehaviorStickyProps, { normalized: false });
      });
      engine.step(64);
      await Promise.resolve();
      expect(engine.previews.stats().rebuilds).toBe(stopped.rebuilds);
      expect(engine.previews.snapshot(frame)).toBe(changed);
    } finally {
      engine.dispose();
    }
  });

  it("isolates invalid or oversized projection output without hiding silhouettes", () => {
    const HugeProjection = defineFrameProjection({
      id: "canvas-sdk:huge-preview",
      project() {
        return { huge: "x".repeat(2_000) };
      },
    });
    const HugeCanvas = defineCanvasType({
      id: "canvas-sdk:huge-canvas",
      semanticVersion: 1,
      semantic: { placement: { widgets: [BehaviorSticky] } },
      presentation: {
        tools: { allowed: [select, pan], default: select },
        preview: { projection: HugeProjection },
      },
    });
    const HugeContainer = defineContainer({
      type: "canvas-sdk:huge-container",
      canvas: HugeCanvas,
      component: null,
    });
    const faults: unknown[] = [];
    const engine = createCanvasEngine({
      widgets: [BehaviorSticky, HugeContainer],
      tools: [select, pan],
      canvasTypes: [DefaultCanvasType, HugeCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
      frameProjections: [HugeProjection],
      budgets: { framePreviewBytes: 512 },
      onGuestFault: (_id, error) => faults.push(error),
    });
    try {
      engine.docs.create();
      const frame = engine.ops.spawnWidget(HugeContainer.type, { x: 0, y: 0 });
      engine.step(8);
      engine.ops.spawnWidget(BehaviorSticky.type, { x: 0, y: 0, parent: frame });
      engine.step(16);
      const unsubscribe = engine.previews.subscribe(frame, () => {});
      const snapshot = engine.previews.snapshot(frame);
      expect(snapshot.facets).toEqual({});
      expect(snapshot.children).toHaveLength(1);
      expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(512);
      expect(faults).toHaveLength(1);
      unsubscribe();
    } finally {
      engine.dispose();
    }
  });
});

describe("governed Canvas SDK logic", () => {
  it("runs only the active runtime extension on dirt and restores owned outputs on exit", () => {
    runtimeExtensionRuns = 0;
    const engine = createCanvasEngine({
      widgets: [Sticky, RuntimeContainer],
      tools: [select, pan, drawSticky],
      canvasTypes: [DefaultCanvasType, RuntimeCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
      canvasRuntimeExtensions: [MarkWhiteboardChildren],
    });
    try {
      engine.docs.create();
      const container = engine.ops.spawnWidget(RuntimeContainer.type, { x: 0, y: 0 });
      engine.step(16);
      engine.ops.enterContainer(container, { transition: "none" });
      const sticky = engine.ops.spawnWidget(Sticky.type, { x: 0, y: 0 });
      engine.step(32);
      expect(engine.world.get(sticky, RuntimeMark)).toEqual({ marked: true });
      engine.step(48);
      const settledRuns = runtimeExtensionRuns;
      engine.step(64);
      expect(runtimeExtensionRuns).toBe(settledRuns);

      engine.ops.exitContainer({ transition: "none" });
      expect(engine.world.get(sticky, RuntimeMark)).toBeUndefined();
    } finally {
      engine.dispose();
    }
  });

  function faultingRuntimeEngine(onGuestFault: (error: unknown) => void): CanvasEngine {
    return createCanvasEngine({
      widgets: [Sticky, FaultingRuntimeContainer],
      tools: [select, pan, drawSticky],
      canvasTypes: [DefaultCanvasType, FaultingRuntimeCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
      canvasRuntimeExtensions: [FaultingRuntimeExtension],
      onGuestFault: (_id, error) => onGuestFault(error),
    });
  }

  /**
   * Enter the faulting canvas with one child, settled and quiescent. The child
   * carries the extension's output component ALREADY, so a rollback is a value
   * restore rather than a component removal — the shape that genuinely strands:
   * a removal moves the entity's archetype, which journals it back into the
   * host's collector and would re-dispatch on its own.
   */
  function settledFaultingFrame(engine: CanvasEngine): Entity {
    engine.docs.create();
    const container = engine.ops.spawnWidget(FaultingRuntimeContainer.type, { x: 0, y: 0 });
    engine.step(16);
    engine.ops.enterContainer(container, { transition: "none" });
    const sticky = engine.ops.spawnWidget(Sticky.type, { x: 0, y: 0 });
    engine.world.addComponent(sticky, RuntimeMark, { marked: false });
    engine.step(32);
    engine.step(48);
    return sticky;
  }

  it("re-arms a runtime extension after a transient fault so its outputs recover", () => {
    faultingRuns = 0;
    faultingThrows = 0;
    const faults: unknown[] = [];
    const engine = faultingRuntimeEngine((error) => faults.push(error));
    try {
      const sticky = settledFaultingFrame(engine);
      expect(engine.world.get(sticky, RuntimeMark)).toEqual({ marked: true });

      // Quiescent: nothing dirty, so nothing dispatches.
      const settled = faultingRuns;
      engine.step(64);
      expect(faultingRuns).toBe(settled);

      // ONE scripted throw, driven by ONE resource write (the reactive notify
      // lands a frame after the write, so step until the fault is observed).
      faultingThrows = 1;
      writeRuntimeResource(engine.world, RuntimeDirt, { n: 1 });
      let now = 64;
      for (let i = 0; i < 8 && faults.length === 0; i++) {
        now += 16;
        engine.step(now);
      }
      expect(faults).toHaveLength(1);
      expect(faultingRuns).toBeGreaterThan(settled);
      const afterFault = faultingRuns;
      expect(engine.world.get(sticky, RuntimeMark)).toEqual({ marked: false });

      // Nothing has changed since that faulting dispatch — the collector was
      // drained before the throw and the value restore journals nothing. Only
      // the rollback's re-arm can dispatch again; without it the reverted
      // outputs stay stale indefinitely.
      now += 16;
      engine.step(now);
      expect(faultingRuns).toBe(afterFault + 1);
      expect(engine.world.get(sticky, RuntimeMark)).toEqual({ marked: true });
    } finally {
      engine.dispose();
    }
  });

  it("does not spin a runtime extension the breaker has suspended", () => {
    faultingRuns = 0;
    faultingThrows = 0;
    const faults: unknown[] = [];
    const engine = faultingRuntimeEngine((error) => faults.push(error));
    try {
      const sticky = settledFaultingFrame(engine);
      expect(engine.world.get(sticky, RuntimeMark)).toEqual({ marked: true });

      // Throw on every dispatch: the re-arm feeds the breaker's throw ladder
      // (GUEST_BUDGET.consecutiveThrows) rather than looping forever.
      faultingThrows = Number.MAX_SAFE_INTEGER;
      writeRuntimeResource(engine.world, RuntimeDirt, { n: 1 });
      for (let i = 0; i < 12; i++) engine.step(112 + i * 16);

      const guest = engine.engine.guests
        .list()
        .find((g) => g.id === `canvas-runtime:${FaultingRuntimeExtension.id}`);
      expect(guest?.status).toBe("suspended");
      expect(engine.world.get(sticky, RuntimeMark)).toEqual({ marked: false });

      // Suspended means the body never runs again, however many frames pass.
      const stopped = faultingRuns;
      const faultsWhenStopped = faults.length;
      for (let i = 0; i < 12; i++) engine.step(320 + i * 16);
      expect(faultingRuns).toBe(stopped);
      expect(faults).toHaveLength(faultsWhenStopped);
    } finally {
      engine.dispose();
    }
  });

  it("routes semantic frame dirt without CanvasSession dependence and quiesces change-only", () => {
    frameBehaviorRuns = 0;
    const engine = createCanvasEngine({
      widgets: [BehaviorSticky],
      tools: [select, pan],
      canvasTypes: [BehaviorCanvas],
      rootCanvas: BehaviorCanvas,
      presentationFallback: DefaultCanvasType,
      frameBehaviors: [NormalizeFrame],
    });
    try {
      const doc = engine.docs.create();
      expect(decodeEnvelope(doc.exportEnvelope()).header.prefabVersions).toMatchObject({
        [frameBehaviorPackId(NormalizeFrame.id)]: 1,
      });
      const sticky = engine.ops.spawnWidget(BehaviorSticky.type, { x: 0, y: 0 });
      engine.step(16);
      engine.step(32);
      expect(engine.world.read(sticky, BehaviorStickyProps)).toEqual({ normalized: true });
      const settledRuns = frameBehaviorRuns;
      engine.step(48);
      expect(frameBehaviorRuns).toBe(settledRuns);
    } finally {
      engine.dispose();
    }
  });

  it("runs semantic behavior for an inactive frame while the user views another canvas", () => {
    const engine = createCanvasEngine({
      widgets: [BehaviorSticky, BehaviorContainer, EmptyContainer],
      tools: [select, pan],
      canvasTypes: [DefaultCanvasType, BehaviorCanvas, EmptyCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
      frameBehaviors: [NormalizeFrame],
    });
    try {
      const doc = engine.docs.create();
      const behaviorFrame = engine.ops.spawnWidget(BehaviorContainer.type, { x: 0, y: 0 });
      const otherFrame = engine.ops.spawnWidget(EmptyContainer.type, { x: 400, y: 0 });
      engine.step(16);
      const child = engine.ops.spawnWidget(BehaviorSticky.type, {
        x: 0,
        y: 0,
        parent: behaviorFrame,
      });
      engine.step(32);
      engine.ops.enterContainer(otherFrame, { transition: "none" });
      doc.store.transaction((tx) => {
        tx.edit(child).set(BehaviorStickyProps, { normalized: false });
      });
      engine.step(48);
      expect(engine.canvas.current()).toMatchObject({
        frame: otherFrame,
        typeId: EmptyCanvas.id,
      });
      expect(engine.world.read(child, BehaviorStickyProps)).toEqual({ normalized: true });
    } finally {
      engine.dispose();
    }
  });

  it("removes write authority from a CanvasType after a semantic behavior fault", () => {
    const engine = createCanvasEngine({
      widgets: [BehaviorSticky],
      tools: [select, pan],
      canvasTypes: [FaultCanvas],
      rootCanvas: FaultCanvas,
      presentationFallback: DefaultCanvasType,
      frameBehaviors: [AlwaysFaults],
      onGuestFault: () => {},
    });
    try {
      engine.docs.create();
      engine.step(16);
      expect(() => engine.ops.spawnWidget(BehaviorSticky.type, { x: 0, y: 0 })).toThrow(
        /unavailable semantic FrameBehavior/,
      );
    } finally {
      engine.dispose();
    }
  });
});

describe("CanvasType semantic migration", () => {
  it("upgrades an old root CanvasType solo and stamps semantic identity last", () => {
    migrationRuns = 0;
    const engine = createCanvasEngine({
      widgets: [Sticky],
      tools: [select, pan],
      canvasTypes: [MigratingCanvas],
      rootCanvas: MigratingCanvas,
      presentationFallback: DefaultCanvasType,
    });
    try {
      const opened = engine.docs.open(rootOnlyEnvelope(MigratingCanvas.id, 1));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.session.readOnly).toBe(false);
      expect(opened.session.rootCanvas).toEqual({
        id: MigratingCanvas.id,
        semanticVersion: 2,
      });
      expect(migrationRuns).toBe(1);
      expect(decodeEnvelope(opened.session.exportEnvelope()).header).toMatchObject({
        rootCanvas: { id: MigratingCanvas.id, semanticVersion: 2 },
        prefabVersions: { [canvasPackId(MigratingCanvas.id)]: 2 },
      });
    } finally {
      engine.dispose();
    }
  });

  it("keeps a current CanvasType read-only when its semantic dependency is absent", () => {
    const engine = createCanvasEngine({
      widgets: [BehaviorSticky],
      tools: [select, pan],
      canvasTypes: [BehaviorCanvas],
      rootCanvas: BehaviorCanvas,
      presentationFallback: DefaultCanvasType,
      frameBehaviors: [NormalizeFrame],
    });
    try {
      const opened = engine.docs.open(rootOnlyEnvelope(BehaviorCanvas.id, 1));
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.session.readOnly).toBe(true);
      expect(opened.session.report?.dependencyIssues).toEqual([
        `${canvasPackId(BehaviorCanvas.id)} requires ${frameBehaviorPackId(NormalizeFrame.id)}@1`,
      ]);
    } finally {
      engine.dispose();
    }
  });

  it("lets a legacy schema-2 document reach the 2→3 migration that satisfies its closure", () => {
    const engine = createCanvasEngine({
      widgets: [Sticky, LegacyFolder],
      tools: [select, pan],
      presentationFallback: DefaultCanvasType,
    });
    try {
      const opened = engine.docs.open(
        legacySchema2Envelope({ [LegacyFolder.prefab.id]: LegacyFolder.prefab.version ?? 1 }),
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      // The container's closure demands @ice/canvas/ice.default@1, which ONLY
      // the 2→3 step writes: a dependency-issue readOnly ahead of the migrate
      // branch would strand this document read-only forever.
      expect(opened.session.readOnly).toBe(false);
      const report = opened.session.versionReport();
      expect(report.docSchema).toBe(ENGINE_SCHEMA_VERSION);
      expect(report.dependencyIssues).toEqual([]);
      expect(report.docPacks[canvasPackId(DefaultCanvasType.id)]).toBe(1);
      expect(opened.session.rootCanvas).toEqual({
        id: DefaultCanvasType.id,
        semanticVersion: 1,
      });
      // A real durable write lands: the pack the doc already enables.
      expect(engine.ops.spawnWidget(LegacyFolder.type, { x: 0, y: 0 })).toBeTypeOf("number");
    } finally {
      engine.dispose();
    }
  });

  it("still gates a CURRENT-schema document read-only on an unsatisfiable closure", () => {
    const engine = createCanvasEngine({
      widgets: [Sticky, LegacyFolder],
      tools: [select, pan],
      canvasTypes: [LegacyHostCanvas],
      rootCanvas: LegacyHostCanvas,
      presentationFallback: DefaultCanvasType,
    });
    try {
      // Schema 3, root satisfied, container marker present — but the canvas
      // pack that container depends on is absent and nothing is left to
      // migrate, so the closure is authoritative and the doc stays read-only.
      const opened = engine.docs.open(
        rootOnlyEnvelope(LegacyHostCanvas.id, 1, {
          [LegacyFolder.prefab.id]: LegacyFolder.prefab.version ?? 1,
        }),
      );
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.session.readOnly).toBe(true);
      expect(opened.session.report?.dependencyIssues).toEqual([
        `${LegacyFolder.prefab.id} requires ${canvasPackId(DefaultCanvasType.id)}@1`,
      ]);
    } finally {
      engine.dispose();
    }
  });
});

describe("durable root identity", () => {
  it("requires an explicit requirement-before-content capability upgrade", () => {
    const source = createCanvasEngine({
      widgets: [BoardCard],
      tools: [select, pan, drawBoardCard],
    });
    source.docs.create();
    const bytes = source.docs.current()?.exportEnvelope();
    source.dispose();
    if (bytes === undefined) throw new Error("missing capability source envelope");

    const reader = createCanvasEngine({
      widgets: [BoardCard, Sticky],
      tools: [select, pan, drawBoardCard, drawSticky],
    });
    try {
      const opened = reader.docs.open(bytes);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(() => reader.ops.spawnWidget(Sticky.type, { x: 0, y: 0 })).toThrow(
        /does not enable widget pack/,
      );
      const before = reader.canvas.current();
      expect(reader.docs.upgradeCapabilities([Sticky.type])).toBe(true);
      expect(reader.canvas.current().epoch).toBeGreaterThan(before.epoch);
      expect(reader.ops.spawnWidget(Sticky.type, { x: 0, y: 0 })).toBeTypeOf("number");
    } finally {
      reader.dispose();
    }
  });

  it("preserves content that arrived before its requirement and suspends local writes", () => {
    const reader = createCanvasEngine({ widgets: [Sticky], tools: [select, pan, drawSticky] });
    try {
      const opened = reader.docs.open(contentWithoutRequirementEnvelope());
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(reader.canvas.diagnostics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "content-without-requirement",
            removesWriteAuthority: true,
          }),
        ]),
      );
      expect(countType(reader, Sticky.type)).toBe(1);
      expect(() => reader.ops.spawnWidget(Sticky.type, { x: 0, y: 0 })).toThrow(/read-only/);
    } finally {
      reader.dispose();
    }
  });

  it("opens with an unknown root CanvasType read-only and uses presentation fallback only", () => {
    const source = makeEngine();
    source.docs.create();
    const bytes = source.docs.current()?.exportEnvelope();
    source.dispose();
    if (bytes === undefined) throw new Error("missing source envelope");

    const reader = createCanvasEngine({
      widgets: [Sticky, BoardCard, WhiteboardContainer],
      tools: [select, pan, drawSticky, drawBoardCard],
      canvasTypes: [WhiteboardCanvas],
      rootCanvas: DefaultCanvasType,
      presentationFallback: DefaultCanvasType,
    });
    try {
      const opened = reader.docs.open(bytes);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.session.readOnly).toBe(true);
      expect(opened.session.report?.rootIssue).toMatch(/not available/);
      expect(reader.canvas.current()).toMatchObject({ typeId: BoardCanvas.id });
      expect(reader.canvas.type()).toBe(DefaultCanvasType);
      expect(() => reader.ops.spawnWidget(BoardCard.type, { x: 0, y: 0 })).toThrow(
        /read-only/,
      );
    } finally {
      reader.dispose();
    }
  });
});

const NestingCanvas = defineCanvasType({
  id: "canvas-sdk:nesting",
  semanticVersion: 1,
  semantic: { placement: { accepts: ["nest.item"] } },
  presentation: { tools: { allowed: [select, pan], default: select } },
});

const NestingContainer = defineContainer({
  type: "canvas-sdk:nesting-container",
  canvas: NestingCanvas,
  component: null,
  defaultSize: { w: 360, h: 280 },
  provides: ["nest.item", "canvas-container"],
});

describe("frame depth limits", () => {
  it("refuses depth 65 at placement and navigation without partial NavEntry/session mutation", () => {
    const engine = createCanvasEngine({
      widgets: [NestingContainer],
      tools: [select, pan],
      canvasTypes: [NestingCanvas],
      rootCanvas: NestingCanvas,
      presentationFallback: DefaultCanvasType,
    });
    try {
      engine.docs.create();
      engine.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });

      const chain: Entity[] = [];
      let parent: Entity | undefined;
      for (let level = 0; level < 64; level += 1) {
        const container = engine.ops.spawnWidget(NestingContainer.type, {
          x: 20,
          y: 20,
          ...(parent === undefined ? {} : { parent }),
        });
        engine.step(16);
        chain.push(container);
        parent = container;
      }

      const deepest = chain[63];
      if (deepest === undefined) throw new Error("missing deepest container");
      // Placement refuses a container whose frame would be depth 65.
      expect(() =>
        engine.ops.spawnWidget(NestingContainer.type, { x: 20, y: 20, parent: deepest }),
      ).toThrow(/depth/);

      // Remote-shaped data can still be deeper: a runtime entity beyond placement.
      const remote = engine.world.spawn({
        components: [
          [PrefabId, { id: NestingContainer.type }],
          [Position, { x: 20, y: 20 }],
          [Size, { w: 360, h: 280 }],
        ],
      });
      engine.world.setRelation(remote, ChildOf, deepest);
      engine.step(16);

      for (const container of chain) {
        engine.ops.enterContainer(container, { transition: "none" });
        engine.step(16);
      }
      expect(engine.canvas.current()).toMatchObject({
        depth: 64,
        typeId: NestingCanvas.id,
      });

      const sessionBefore = engine.canvas.current();
      const navBefore = engine.world.getResource(NavTransition);
      expect(() => engine.ops.enterContainer(remote, { transition: "none" })).toThrow(
        /maximum CanvasFrame depth/,
      );
      expect(engine.canvas.current()).toEqual(sessionBefore);
      expect(engine.world.getResource(NavTransition)?.epoch).toBe(navBefore?.epoch);

      // The nav stack is uncorrupted: one exit lands on depth 63.
      engine.ops.exitContainer({ transition: "none" });
      expect(engine.canvas.current()).toMatchObject({ depth: 63 });
    } finally {
      engine.dispose();
    }
  });
});

describe("interrupted-flight camera save (§6.2 rev 2, §14 measurement 12)", () => {
  it("pins the root pose exactly across cycles that re-enter during a driving exit flight", () => {
    const engine = createCanvasEngine({
      widgets: [NestingContainer],
      tools: [select, pan],
      canvasTypes: [NestingCanvas],
      rootCanvas: NestingCanvas,
      presentationFallback: DefaultCanvasType,
    });
    try {
      engine.docs.create();
      engine.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
      const container = engine.ops.spawnWidget(NestingContainer.type, { x: 20, y: 20 });
      let clock = 0;
      const stepN = (n: number) => {
        for (let i = 0; i < n; i += 1) {
          clock += 16;
          engine.step(clock);
        }
      };
      stepN(1);
      engine.world.setResource(Camera, { x: 100, y: 50, zoom: 0.5, gesturing: false });

      for (let cycle = 0; cycle < 5; cycle += 1) {
        engine.ops.enterContainer(container, { transition: "none" });
        stepN(1);
        engine.ops.exitContainer({});
        stepN(3);
        const driving = engine.world.getResource(NavTransition);
        expect(driving?.active).toBe(true);
        expect(driving?.p ?? 1).toBeLessThan(1);

        // The critical save: this entry must record the driving flight's
        // ARRIVAL pose, never the instantaneous mid-flight camera.
        engine.ops.enterContainer(container, { transition: "none" });
        stepN(1);
        engine.ops.exitContainer({ transition: "none" });
        stepN(1);
        expect(engine.world.getResource(Camera)).toMatchObject({
          x: 100,
          y: 50,
          zoom: 0.5,
        });
      }
    } finally {
      engine.dispose();
    }
  });
});
