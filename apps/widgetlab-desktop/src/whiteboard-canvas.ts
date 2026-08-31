import { defineCanvasType, tools } from "@ice/core";

const select = tools.get("select");
const pan = tools.get("pan");
if (select === undefined || pan === undefined) throw new Error("missing built-in canvas tools");

export const WIDGETLAB_LINE_GROUND = "widgetlab.whiteboard.lines";

export const WhiteboardCanvas = defineCanvasType({
  id: "widgetlab.whiteboard",
  semanticVersion: 1,
  semantic: { placement: { accepts: ["widget"] } },
  presentation: {
    tools: { allowed: [select, pan], default: select },
    ground: { program: WIDGETLAB_LINE_GROUND, wires: false, guides: true },
    camera: { arrival: "fit", padding: 64, minZoom: 0.25, maxZoom: 2 },
    preview: {
      background: {
        css: "linear-gradient(rgba(150,158,210,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(150,158,210,.1) 1px, transparent 1px)",
        size: 20,
      },
    },
  },
});
