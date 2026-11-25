// Which oracle stills rig:world can draw FROM THE WORLD, and why not the others (scripts/world.mjs). A still whose moment is the
// oracle desk's own clock has no door in the live app — a note the world spawns is first SEEN as it stands, its words written and its
// marks made: so a still MID-WRITING (petition I59 — a note's words `arrive` a moment before it) and a still MID-MARKING (petition
// I60 — its marks were made, `inked`, a moment before it: a stroke being pulled through, a word being re-inked) are held in Chrome by
// rig:parity alone (the oracle's frame code, which owns that clock). Each is NAMED in the run's output with its reason — never a silent skip.

/** The reason a still cannot be drawn from the world, or undefined when it can. */
export function notFromTheWorld(sc) {
  const notes = [...(sc.scene.notes ?? []), ...(sc.scene.things ?? []).filter((t) => t.kind === "note")];
  if (notes.some((n) => n.arrive !== undefined)) return "mid-writing: its words `arrive` on the oracle desk's clock, and the world's are first seen written";
  if (notes.some((n) => n.inked !== undefined)) return "mid-marking: its marks were made (`inked`) on the oracle desk's clock, and the world's are first seen made";
  return undefined;
}
