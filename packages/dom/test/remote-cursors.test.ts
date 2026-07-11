/**
 * P5 remote-cursors reflector (M9): pooled nodes track remote CursorVisual
 * entities in screen space; peer identity styles them; despawn reaps.
 */
import { describe, expect, it } from "vitest";
import {
  Camera,
  CursorVisual,
  Follows,
  Position,
  PresenceInfo,
  createWorld,
} from "@ice/core";
import { createCanvasHost } from "../src/host";
import { createRemoteCursorsReflector } from "../src/reflectors/remote-cursors";

function makeRig() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 2, gesturing: false });
  const rc = createRemoteCursorsReflector(host, world);
  const plane = container.lastElementChild as HTMLElement;
  return { world, rc, plane };
}

describe("remote cursors (P5)", () => {
  it("renders a pooled node at worldToScreen, styled from the peer, reaped on despawn", () => {
    const { world, rc, plane } = makeRig();
    const peer = world.spawn({ components: [[PresenceInfo, { name: "Ada", color: "#e91e63" }]] });
    const cursor = world.spawn({
      components: [
        [Position, { x: 100, y: 50 }],
        [CursorVisual, { kind: "remote", pressed: false }],
      ],
    });
    world.setRelation(cursor, Follows, peer);

    rc.reflector.flush(world);
    expect(plane.children.length).toBe(1);
    const node = plane.children[0] as HTMLElement;
    expect(node.style.transform).toBe("translate(200px, 100px)"); // ×zoom 2
    expect(node.style.color).toBe("#e91e63");
    expect(node.textContent).toContain("Ada");

    // Local cursors are never rendered here.
    world.spawn({
      components: [
        [Position, { x: 0, y: 0 }],
        [CursorVisual, { kind: "local", pressed: false }],
      ],
    });
    rc.reflector.flush(world);
    expect(plane.children.length).toBe(1);

    world.destroy(cursor);
    rc.reflector.flush(world);
    expect(plane.children.length).toBe(0);

    rc.destroy();
  });
});
