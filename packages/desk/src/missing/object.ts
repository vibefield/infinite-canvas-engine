// THE MISSING FACE as a kind (petition I24) — the desk's OWN, the one face for "nothing can draw this": an object whose kind is
// missing (refused at create, quarantined at three strikes — faults.ts) and an object whose type has no kind on this desk (a
// type no catalog holds — a document from a desk with more kinds — or one declared with no `object` binding: VibeField's ghost
// stubs). Its world half is the builder's for those objects (their geometry is their box; their record the face; their pick the box
// itself — `content`, so a tap selects it and a drag moves it); its pass is the ground's (`SlotSet.missing`). A missing KIND's
// objects keep their kind's name and stratum — the ground draws the face in that kind's entry — so they lie where the kind's lay;
// an object with no kind lies with the things, under `MISSING_KIND`.

import type { ObjectContext, ObjectKind, ObjectRect } from "../kinds/world";
import { type MissingRecord, missingFace, missingHit } from "./layout";
import { MissingPass } from "./pass";

/** The name an object whose type has no kind is drawn under (a kind may not take it — ground.ts). */
export const MISSING_KIND = "desk.missing";

/** The missing face's kind: its program (the ground's own — never registered) and its world half. */
export const MISSING_OBJECT: ObjectKind<ObjectRect, MissingRecord> = {
  name: MISSING_KIND,
  stratum: "things",
  reach: 0,
  create: async (device, format, mat) => MissingPass.make(device, format, mat),
  resolve: (ctx: ObjectContext): ObjectRect => ctx.rect,
  record: (g: ObjectRect, ctx: ObjectContext): MissingRecord => missingFace(g, ctx.theme, ctx.flux.fade),
  hit: (g: ObjectRect, wx: number, wy: number) => missingHit(g, wx, wy),
};
