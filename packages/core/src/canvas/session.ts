/** Generation-safe local CanvasSession resource and its engine-owned writer. */
import { enumOf, field, type Entity, type World } from "@vibecook/strata-ecs";
import { defineComponent, defineResource } from "../schema/meta";

export const CanvasSession = defineResource("CanvasSession", {
  state: field(enumOf(["detached", "attached"]), { default: "detached" }),
  documentEpoch: field("u32", { default: 0 }),
  epoch: field("u32", { default: 0 }),
  /** Ignored while detached. Zero is a sentinel, never a retained entity API. */
  frame: field("eid", { default: 0 as Entity }),
  typeId: field("string", { default: "" }),
  depth: field("u8", { default: 0 }),
});

/** Gesture-start latch used to reject commits after a document/nav switch. */
export const CanvasIntentScope = defineComponent("CanvasIntentScope", {
  documentEpoch: field("u32", { default: 0 }),
  canvasEpoch: field("u32", { default: 0 }),
  frame: field("eid", { default: 0 as Entity }),
});

export type CanvasSessionValue = {
  readonly state: "detached" | "attached";
  readonly documentEpoch: number;
  readonly epoch: number;
  readonly frame: Entity;
  readonly typeId: string;
  readonly depth: number;
};

export interface CanvasSessionController {
  current(): CanvasSessionValue;
  attach(frame: Entity, typeId: string): CanvasSessionValue;
  detach(): CanvasSessionValue;
  switchFrame(frame: Entity, typeId: string, depth: number): CanvasSessionValue;
  bumpCapabilities(): CanvasSessionValue;
  /** Re-publish closure state after world.reset() clears runtime resources. */
  republish(): void;
}

const next = (value: number): number => (value + 1) >>> 0;

export function createCanvasSessionController(world: World): CanvasSessionController {
  let value: CanvasSessionValue = {
    state: "detached",
    documentEpoch: 0,
    epoch: 0,
    frame: 0 as Entity,
    typeId: "",
    depth: 0,
  };
  const publish = (): void => world.setResource(CanvasSession, value);
  publish();

  return {
    current: () => value,
    attach(frame, typeId) {
      value = {
        state: "attached",
        documentEpoch: next(value.documentEpoch),
        epoch: next(value.epoch),
        frame,
        typeId,
        depth: 0,
      };
      publish();
      return value;
    },
    detach() {
      value = {
        state: "detached",
        documentEpoch: next(value.documentEpoch),
        epoch: next(value.epoch),
        frame: 0 as Entity,
        typeId: "",
        depth: 0,
      };
      publish();
      return value;
    },
    switchFrame(frame, typeId, depth) {
      if (value.state !== "attached") {
        throw new Error("ice: cannot switch CanvasSession while no document is attached.");
      }
      value = { ...value, epoch: next(value.epoch), frame, typeId, depth };
      publish();
      return value;
    },
    bumpCapabilities() {
      value = { ...value, epoch: next(value.epoch) };
      publish();
      return value;
    },
    republish: publish,
  };
}
