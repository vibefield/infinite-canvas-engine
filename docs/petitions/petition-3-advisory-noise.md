# Petition 3 — Advisory-noise opt-outs (candidate; M4/M5/M6 field findings)

Two unrelated DEV warnings that are each CORRECT in general and each a
guaranteed false positive for this engine — so they fire on every boot /
every collab session forever. The cost is not the log line; it is alarm
fatigue: a warning that is always present trains everyone to ignore the
channel, which silently devalues every OTHER strata advisory. Both asks are
opt-outs with an attestation, not removals.

---

## 3a. Same-phase writer-pair advisory

### What strata does today (verified 0.3.0)

`validatePipelineAccess` (`core/access-diagnostics.ts:74`) runs once per
assembled pipeline object (WeakSet dedup, `:61`), DEV-only. For every phase
it collects each system's declared `access.write` set and warns when two or
more systems in ONE phase declare a write of the SAME component (`:91-97`):

> access: in phase "ctl:behave", systems "moveBehavior", "resizeBehavior"
> declare write of "Position" in the same phase — potential order-dependence
> (array order is execution order; order them deliberately or split the phase).

The rationale is sound: strata never reorders systems (array order IS
execution order), so two same-phase writers of one column can produce
different results depending on registration order — a real hazard the author
should confirm deliberately.

### Why it is a permanent false positive for the engine

`moveBehavior` declares `write: [Position, StackZ]` (`l3-behave.ts:210`);
`resizeBehavior` declares `write: [Position, Size]` (`l3-resize.ts:183`).
Both sit in `ctl:behave` — design-003 §5 pins the in-phase order
(select → snap → move → drop → resize → marquee → camera), so they are
co-located BY DESIGN, and the shared `Position` column is disjoint at the
ROW level by construction: `dragRoute` stamps a recognizer `RoutedMove` XOR
`RoutedResize`, so no entity's Position is ever written by both systems in
one frame. The advisory is column-granular; it cannot see row-disjointness,
and there is nothing we can restructure to satisfy it — splitting the phase
would violate the design's ordering contract for no semantic gain.

Result: the warning prints on every armed boot of every app, forever.

### Ask

An attestation hook, so a deliberate co-located writer pair can declare its
disjointness and silence exactly this pairing:

```ts
// preferred: per-system attestation
defineSystem(q, body, {
  name: "resizeBehavior",
  access: { write: [Position, Size], orderIndependent: [Position] },
});
```

Semantics: a same-phase writer pair is only warned if AT LEAST ONE member
did NOT attest the shared column. (Alternative shape: a pipeline-level
`suppressWriterPair(["moveBehavior", "resizeBehavior"], Position)` — works,
but the per-system form keeps the attestation next to the code it describes
and survives system-set refactors.)

Advisory (b) in the same validator ("read positioned before a same-phase
writer") is NOT part of this ask — we have no false positives there.

### Engine impact when shipped

Add the attestation to `moveBehavior`/`resizeBehavior`; the armed-boot
consoles of every demo/app go quiet; future REAL writer-pair mistakes become
visible again.

---

## 3b. Untagged-writer warn for embedder meta commits

### What strata does today (verified 0.3.0)

Strata's own durable writer tags every commit message with a `strata:<n>`
sequence. On REMOTE import, the adapter walks the imported changes and warns
once per instance for any change whose message lacks the tag
(`durable/loro-snapshot.ts:835-841`):

> durable adapter saw a commit with no strata tag — untagged commits may
> coalesce; batch boundaries are best-effort for this peer (005 §1.3).

Also sound in general: a foreign writer's commits may have coalesced in its
oplog, so strata's per-commit batch boundaries are best-effort for that peer
— worth one notice.

### Why the engine trips it on every collab session

The engine's version gate writes write-once marker keys
(`engine.schema.<n>`, `engine.pack.<id>.<v>`) into the doc's meta map at
document creation — `stampEngineMeta` (`core/src/doc/version-gate.ts`)
commits them with strata's own `META_ORIGIN` ("strata-meta") so they are
excluded from undo. But origin ≠ commit-message tag: the raw LoroDoc
transaction we use has no way to speak strata's `strata:<n>` message
protocol (it is internal to the durable writer). So every peer that imports
a doc containing our stamps sees exactly one untagged change and warns.

The warning is vacuous here twice over: (1) the change touches only the meta
map — no ECS cells, so batch-boundary quality is irrelevant; (2) the writer
is not foreign at all — it is the embedding ENGINE, i.e. strata's primary
customer doing the thing design-005 §6 tells it to do (stamp markers
pre-attach on the raw doc).

### Ask (either shape works)

1. **Sanctioned embedder meta commits**: export a helper (or a
   `store.metaTransaction(fn)`) that commits with `META_ORIGIN` AND the
   proper message tag (or a dedicated `strata-meta` message tag the import
   path recognizes). This is the better fix — it makes "embedder writes doc
   metadata" a supported operation instead of a tolerated trespass.
2. **Targeted suppression**: skip the warn for changes that carry
   `META_ORIGIN` and/or touch only the meta map.

### Engine impact when shipped

`stampEngineMeta` switches to the sanctioned helper (or nothing changes,
with option 2); collab session consoles go quiet; the warn regains meaning
for genuinely foreign writers.
