// The PHOTO print (PHOTO.md) as an OBJECT (design-015 §6; D3w): a 6×4 on the desk among its things. Durable
// props: its picture BY NAME — `blob`, the hash of its bytes in the app's BlobStore (D-D12; photo/blobs.ts),
// never the bytes — and the picture's size in pixels (`width` × `height`: its aspect, and a raw RGBA's rows),
// its white `border` (a fraction of the short side), and its `angle` — the turn it lies at (the prototype kept
// it on the body; the wheel turns it, a paste lays it ±6°). Its extent on the desk is the picture's aspect at
// the law's long side (`printExtent` — exact; `Size` is its f32 shadow for the index, the cull and the marks).
// Things, selectable; NOT core-movable: a print's CARRY is its own physics (objects/carry.ts over the photo
// kind's bodies — the kinematic pin, the flick, the glide, the grip), and its drop is ONE transaction when it
// comes to rest. Offered to a mini mat (`provides`) for D2b's nesting.

import { p } from "@ice/core";
import { photoKind, printExtent, type Prints } from "./kind";
import { defineObject } from "@ice/desk";
import { PHOTO } from "./photo";
import { createPhotoCarry } from "./carry";

/** The print's durable type id. */
export const PHOTO_TYPE = "desk.photo";
export { printExtent };

export const Photo = defineObject({
  type: PHOTO_TYPE,
  version: 1,
  props: {
    blob: p.string({ default: "" }),
    width: p.number({ default: 0 }),
    height: p.number({ default: 0 }),
    border: p.number({ default: PHOTO.border }),
    angle: p.number({ default: 0 }),
  },
  size: { w: printExtent(0, 0).w, h: printExtent(0, 0).h },
  kind: photoKind(),
  // on the pegboard tray (design-017 §8): a print, clipped
  tray: { label: "Print", category: "paper", order: 1, hang: { w: 150, h: 100, accessory: "clip", pegs: [[0, -0.5]] } },
  // the wheel TURNS a print held in a hand (PHOTO.md; D3t-a — core cedes that pointer's wheel to it, `PressWheel`)
  interaction: { selectable: true, movable: false, resizable: false, snap: "both", wheelTurns: true },
  provides: [PHOTO_TYPE],
  // the prints' CARRY (D3w): the hands onto the photo kind's bodies, each rest ONE transaction out of the frame (D-D7-A.3)
  drivers: (h) => createPhotoCarry({ world: h.world, docs: h.docs, prints: () => h.local as Prints | undefined, isPrint: h.isKind, refused: h.refused, props: Photo.groups[0]?.component }),
});
