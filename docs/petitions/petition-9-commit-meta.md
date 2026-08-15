# Petition 9 — Per-commit user metadata: `transaction(fn, { undoable, meta })`

**Filed:** 2026-08-13 · **Status:** OPEN (drafted with VibeField's plugin ECS door rev 3
§7-U3; awaiting James's bless) · **Scope:** additive, opt-in, zero cost when unused.

Evidence pinned at strata-ecs 0.11.0 source, re-verified 2026-08-13 by the door rev-3
cross-layer review. Re-check line numbers on posting if the repo moved.

## The field impact that motivates it

VibeField's plugin door commits durable transactions ON BEHALF OF plugins
(`ctx.canvas.tx(label, fn)` → ICE `guardedTransaction` → strata `transaction`). PA-27
promises a "provenance-stamping view": which plugin made THIS change must be answerable —
for the doctor, for audit, and eventually for peers. Today the only possible provenance is
a harness-side log (pluginId, label, tick) that dies with the process and never reaches
the doc. ICE itself has the same latent need for its engine-owned commits (migrations,
rename runners, arrange) — "who wrote this" is currently unanswerable from bytes.

## Current behavior (source-verified)

- `transaction<R>(fn, opts?: { undoable?: boolean })` is the entire options surface —
  `src/durable/durable-store.ts:239`.
- **The commit-message channel is reserved by the durable layer on any attached doc**
  (`src/durable/loro-snapshot.ts:37`): every seal writes `strata:<n>` — `MSG_PREFIX`
  `:300`, minted `:594-597`, written at ordinary/non-undoable seals `:939-943`,
  metaTransaction `:1500`, ensureMeta `:1417`, and before undo/redo self-commits
  `:1118-1131`. Purpose: anti-coalescing (distinct messages split batches) + per-peer
  commit-seq seeding (`:582-592`).
- **`origin` is not a viable channel**: reserved prefixes exist only on meta/non-undoable
  commits (`:265`, `:287`, excluded from undo via prefix match `:523`); ordinary undoable
  commits carry NO origin at all (`:939-942`, reasoning `:900-902`) — and decisively,
  Loro's `origin` is LOCAL-ONLY and never reaches peers (`:282-285`). Cross-wire
  provenance cannot ride it regardless.
- **`metaTransaction` is the wrong granularity**: doc-level LWW keys on the reserved
  "meta" root, excluded from undo, invisible to the change stream (`:1430-1431`,
  `:1477-1500`) — usable for "which plugin touched this doc", never "who made THIS
  change".
- **Exactly ONE parser consumes the message**: `strataMsgSeq` (`:303-307` — requires
  `startsWith("strata:")` and an integer suffix), called from `seedCommitSeq`
  (`:583-592`) and a DEV untagged-writer warn in `applyRemote` (`:1044-1054`). The
  receive path already holds `change.msg` in hand at the warn site. Remote batches
  already carry `commitId: change.id` (`:1813`); local batches pass `undefined`
  (`:1536`).

## The ask

1. **`transaction(fn, { undoable?, meta? })`** — `meta`: a small JSON-serializable
   record. When present, the seal multiplexes it into the commit message beside the
   anti-coalescing tag (e.g. `strata:<n>;<json>`); when absent, the message is
   byte-identical to today. Anti-coalescing needs only uniqueness — a payload increases
   it.
2. **Extend the one parser**: `strataMsgSeq` tolerates (and strips) the suffix; the
   integer contract is unchanged.
3. **Surface it on the receive path**: expose the parsed meta on `ChangeBatch` (reuse
   the existing `commitId` slot's sibling — a Part-II "frozen ladder" interface change,
   named as such) so consumers can attribute remote batches. Peer-controlled input:
   parse with the `tryCanon` never-throws discipline (`src/substrate/canon.ts:123-141`
   precedent).
4. **Define the self-commit policy**: undo/redo seals mint messages too (`:1118-1131`) —
   v1: inverse edits carry NO meta (the undone commit's meta is history's to answer).
5. **Budget enforced in code, not docs** (settled 2026-08-14 pre-flight): the cap lives
   at `transaction()` entry — DEV-warn at ~256B serialized, hard throw at ~1KB — so the
   failure is at the caller, never a docs promise. Meta is ids-not-payloads; it lives in
   every update forever.
6. **Local-echo threading** (settled): local batches receive meta THREADED DIRECTLY from
   the seal opts (the object is in hand at `flushLocal` — no parsing on the local path);
   only the receive path parses. Consumers see ONE shape regardless of origin.
7. **Paperwork in scope, not optional** (settled): `ChangeBatch` growth is a Part-II
   frozen-ladder change — the 005 §10 as-built amendment and the conformance-suite touch
   ride this petition, and the full durable gate applies (headless-host cross-seam,
   stress, consumer smoke — `loro-snapshot.ts` is touched).

## Compatibility

- Old docs / meta-absent commits: byte-identical behavior, nothing to parse.
- Mixed versions: an OLD build parsing a suffixed message fails the integer parse and
  classifies the writer as foreign — effects are a DEV warn plus commit-seq reseed on
  restart (`:583-592`, `:1044-1054`). The house exact-pin discipline covers it; stated,
  not hidden.
- Fits strata's own grain: opt-in field on an existing per-commit channel, dormant until
  used, dev-diagnosable, one parser touched.

## Engine adoption (what retires)

ICE threads `meta` through `guardedTransaction` (the passthrough at
`guards/guarded-tx.ts:146` is already verbatim; `GuardedTxOpts` + the structural `TxDoc`
signature grow the field — 8 caller sites enumerated in the door review: spawn, set-props,
facade ×2, doc-commit-sink, arrange, use-commit, keymap). VibeField's door stamps
`{plugin, label}` in-CRDT at W2d — PA-27's "provenance-stamping view" becomes literally
true; the harness-side audit log demotes from destination to cache.

## Acceptance sketch

A commit with `meta` round-trips: sender seals one Loro commit whose message carries tag +
payload; a 0.11.0-era peer applies it with only the DEV foreign-writer warn; a same-version
peer surfaces the meta on the inbound `ChangeBatch`; undo of that commit carries no meta;
`strata:<n>`-only docs parse exactly as before; the anti-coalescing and commit-seq suites
stay green unmodified.
