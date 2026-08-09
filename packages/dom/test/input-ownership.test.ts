/**
 * The input-ownership predicate family (design-007 §4, petitions I1/I4):
 * the editable gate, the keyboard-claim marker walk, and the DYNAMIC wheel
 * cede (scroller-with-room inside an opt-out subtree; at-bounds falls through).
 */
import { describe, expect, it } from "vitest";
import {
  KEYBOARD_CLAIM_ATTR,
  isEditableTarget,
  keyboardClaimOf,
  wheelCede,
} from "../src/input-ownership";

/** A div with mocked scroll metrics (happy-dom computes no layout). */
function scroller(opts: {
  axis?: "y" | "x";
  size?: number; // client extent
  content?: number; // scroll extent
  pos?: number; // scrollTop/Left
  overflow?: string;
}): HTMLDivElement {
  const el = document.createElement("div");
  const axis = opts.axis ?? "y";
  if (axis === "y") el.style.overflowY = opts.overflow ?? "auto";
  else el.style.overflowX = opts.overflow ?? "auto";
  const size = opts.size ?? 100;
  const content = opts.content ?? 400;
  Object.defineProperty(el, axis === "y" ? "clientHeight" : "clientWidth", { value: size, configurable: true });
  Object.defineProperty(el, axis === "y" ? "scrollHeight" : "scrollWidth", { value: content, configurable: true });
  if (axis === "y") el.scrollTop = opts.pos ?? 0;
  else el.scrollLeft = opts.pos ?? 0;
  return el;
}

function claimHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute(KEYBOARD_CLAIM_ATTR, "");
  return host;
}

describe("isEditableTarget", () => {
  it("matches exactly the four editable classes", () => {
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const ce = document.createElement("div");
    ce.contentEditable = "true";
    expect(isEditableTarget(ce)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("keyboardClaimOf", () => {
  it("resolves the claim through the target chain and reads escape ownership", () => {
    const host = claimHost();
    const inner = document.createElement("span");
    host.appendChild(inner);
    document.body.appendChild(host);
    expect(keyboardClaimOf(inner)).toEqual({ claimed: true, ownsEscape: false });
    host.setAttribute(KEYBOARD_CLAIM_ATTR, "escape");
    expect(keyboardClaimOf(inner)).toEqual({ claimed: true, ownsEscape: true });
    expect(keyboardClaimOf(document.body)).toEqual({ claimed: false, ownsEscape: false });
    host.remove();
  });
});

describe("wheelCede (the dynamic crossesScrollable, design-007 §3.4/§4)", () => {
  it("cedes a wheel over a scroller-with-room inside a claim subtree", () => {
    const container = document.createElement("div");
    const host = claimHost();
    const list = scroller({ pos: 0 }); // top: room downward
    const row = document.createElement("div");
    list.appendChild(row);
    host.appendChild(list);
    container.appendChild(host);
    document.body.appendChild(container);
    expect(wheelCede(row, container, 0, 120)).toBe(true); // scroll down
    expect(wheelCede(row, container, 0, -120)).toBe(false); // at top — falls through
    container.remove();
  });

  it("falls through to canvas at the scroll bounds (the nested-scroll feel)", () => {
    const container = document.createElement("div");
    const host = claimHost();
    const list = scroller({ pos: 300 }); // 300 + 100 = 400 = scrollHeight: bottom
    host.appendChild(list);
    container.appendChild(host);
    document.body.appendChild(container);
    expect(wheelCede(list, container, 0, 120)).toBe(false); // no room down
    expect(wheelCede(list, container, 0, -120)).toBe(true); // room up
    container.remove();
  });

  it("does NOT cede over a scroller outside any opt-out subtree (F5 — undeclared unchanged)", () => {
    const container = document.createElement("div");
    const plainWidget = document.createElement("div"); // no marker, no data-canvas-interactive
    const list = scroller({ pos: 0 });
    plainWidget.appendChild(list);
    container.appendChild(plainWidget);
    document.body.appendChild(container);
    expect(wheelCede(list, container, 0, 120)).toBe(false);
    container.remove();
  });

  it("does NOT cede over non-scrollable claim content (F4 — a button must not kill zoom)", () => {
    const container = document.createElement("div");
    const host = claimHost();
    const button = document.createElement("button");
    host.appendChild(button);
    container.appendChild(host);
    document.body.appendChild(container);
    expect(wheelCede(button, container, 0, 120)).toBe(false);
    container.remove();
  });

  it("honors data-canvas-interactive as an opt-out root and the dominant axis", () => {
    const container = document.createElement("div");
    const widget = document.createElement("div");
    widget.setAttribute("data-canvas-interactive", "");
    const strip = scroller({ axis: "x", pos: 0 });
    widget.appendChild(strip);
    container.appendChild(widget);
    document.body.appendChild(container);
    expect(wheelCede(strip, container, 120, 0)).toBe(true); // horizontal, room right
    expect(wheelCede(strip, container, 0, 120)).toBe(false); // vertical wheel: no y-scroller
    container.remove();
  });

  it("requires a scrollable overflow mode (overflow visible never cedes)", () => {
    const container = document.createElement("div");
    const host = claimHost();
    const tall = scroller({ overflow: "visible", pos: 0 });
    host.appendChild(tall);
    container.appendChild(host);
    document.body.appendChild(container);
    expect(wheelCede(tall, container, 0, 120)).toBe(false);
    container.remove();
  });
});
