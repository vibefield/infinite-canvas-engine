import {
  contributeCanvasCatalog,
  defineCanvasType,
  tools,
  type CanvasCatalogContribution,
  type Tool,
} from "@ice/core";
import { WIDGETS } from "./widgets";
import { WhiteboardCanvas } from "./whiteboard-canvas";

function builtin(id: string): Tool {
  const tool = tools.get(id);
  if (tool === undefined) throw new Error(`missing built-in tool ${id}`);
  return tool;
}

export const WIDGETLAB_DOT_GROUND = "widgetlab.board.magnet";
export const WIDGETLAB_TOOLS = [builtin("select"), builtin("pan"), builtin("connect")] as const;

export const BoardCanvas = defineCanvasType({
  id: "widgetlab.board",
  semanticVersion: 1,
  semantic: { placement: { widgets: WIDGETS } },
  presentation: {
    catalog: { sections: [{ id: "all", order: 0, items: WIDGETS }] },
    tools: { allowed: WIDGETLAB_TOOLS, default: WIDGETLAB_TOOLS[0] },
    ground: { program: WIDGETLAB_DOT_GROUND, wires: true, guides: true },
  },
});

const whiteboardItems = WIDGETS.filter(
  (widget) => !widget.type.endsWith("-node") && widget.type !== "card-container",
);

export const WhiteboardCatalog: CanvasCatalogContribution = contributeCanvasCatalog({
  id: "widgetlab.whiteboard.catalog",
  canvas: WhiteboardCanvas,
  sections: [{ id: "whiteboard", order: 0, items: whiteboardItems }],
});

export const WIDGETLAB_CANVASES = [BoardCanvas, WhiteboardCanvas] as const;
