/**
 * The doc kit core — create/open/close on ONE world (design-001 §6, design-005
 * §6.1–§6.3; the engine.docs.* facade sugar lands at M10).
 *
 * - create: new LoroDoc → engine.* meta stamps (write-once markers, meta
 *   origin — excluded from undo like the docId) → createDurableStore →
 *   attachDurable → selection history hooks → doc-backed CommitSink.
 * - open: decode envelope (BEFORE any import) → import into a raw doc → read
 *   the marker keys pre-attach → gate verdict → attach read-write, attach
 *   read-only (tx path swapped for the warn-and-drop sink), or reject.
 *   Corrupt/incompatible bytes NEVER throw out of open — quarantine is a
 *   return value (the autosave kit and boot paths must not brick).
 * - close: cancelActiveGestures → detach → in-place world.reset (observers
 *   and systems survive — R3) → respawn the canvas-surface anchor. Undo
 *   stack, baseline, and held-cell ledger die with the attachment by
 *   construction. Switching docs = close() then create/open the next.
 *
 * Selection history hooks (design-001 §12 / M5 exit "undo restores
 * selection"): capture = the Selected set as durable EntityKeys (stable across
 * peers and restarts); restore = resolve keys → setSelection. Runtime-only
 * selections (never-committed drafts) are skipped by construction.
 */
import { LoroDoc } from "loro-crdt";
import type { Entity, World } from "@vibecook/strata-ecs";
import { attachDurable, createDurableStore } from "@vibecook/strata-ecs/durable";
import type { Attachment, DurableStore } from "@vibecook/strata-ecs/durable";
import { Selected } from "../catalog";
import type { CommitSink } from "../engine/commit-sink";
import { ensureCanvasSurface } from "../interaction/install";
import { cancelActiveGestures } from "../ops/gestures";
import { selectedEntities, setSelection } from "../ops/selection";
import {
  ENGINE_SCHEMA_VERSION,
  EnvelopeError,
  decodeEnvelope,
  encodeEnvelope,
  type EnvelopeHeader,
} from "./envelope";
import { createDocCommitSink, createReadOnlyCommitSink } from "./doc-commit-sink";
import { runMigrations } from "./migrate";
import { createLiveWriter, type LiveWriter } from "../guards/live-writer";
import { makeDefaultMayDiverge } from "../ops/claims";
import {
  gateVerdict,
  readDocVersionReport,
  stampEngineMeta,
  type DocVersionReport,
  type GateVerdict,
} from "./version-gate";
import { prefabs } from "../schema/prefab";

export interface DocSessionOpts {
  readonly maxUndoSteps?: number;
  /** Override the default gate policy (design-005 §6.3 facade hook). */
  readonly onGate?: (report: DocVersionReport, verdict: GateVerdict) => GateVerdict;
  /**
   * Run the M9 read-repair migrator on a "migrate" verdict (design-005 §6.4).
   * Default TRUE: the doc attaches writable, the migrator upgrades older packs
   * in place, and the session re-gates. Set false to keep M5 behavior (a
   * "migrate" verdict attaches read-only, no upgrade).
   */
  readonly migrate?: boolean;
}

export interface DocSession {
  readonly store: DurableStore;
  readonly sink: CommitSink;
  readonly readOnly: boolean;
  /**
   * The design-001 §3 step-2 DEV guard, wired to THIS doc: userland live
   * writes to doc cells go through it (throws without a claim/tween;
   * cellInDoc is exact via store.getComponent). Engine behaviors stay on
   * ctx — they hold claims by construction.
   */
  readonly liveWriter: LiveWriter;
  /** Present on the open path (the gate's evidence). */
  readonly report?: DocVersionReport;
  /** Envelope-framed snapshot for storage (autosave kit consumes this). */
  exportEnvelope(savedAt?: number): Uint8Array;
  /** Relay passthroughs (M5 dumb relay; M9 brings the bootstrap protocol). */
  exportSnapshot(): Uint8Array;
  applyRemote(bytes: Uint8Array): void;
  /** cancel gestures → detach → world reset in place → respawn the anchor. */
  close(): void;
}

export type OpenDocResult =
  | { readonly ok: true; readonly session: DocSession }
  | { readonly ok: false; readonly reason: string; readonly report?: DocVersionReport };

function localPrefabVersions(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of prefabs.all()) if (p.store === "durable") out[p.id] = p.version ?? 1;
  return out;
}

function makeSession(
  world: World,
  store: DurableStore,
  attachment: Attachment,
  readOnly: boolean,
  report?: DocVersionReport,
): DocSession {
  // Selection history hooks — capture keys, restore via resolve (skip dead).
  store.setHistoryHooks({
    capture: () => {
      const keys: string[] = [];
      for (const e of selectedEntities(world)) {
        const key = store.keyOf(e);
        if (key !== undefined) keys.push(key as unknown as string);
      }
      return keys;
    },
    restore: (value) => {
      if (!Array.isArray(value)) return;
      const entities: Entity[] = [];
      for (const key of value) {
        const e = store.resolve(key);
        if (e !== undefined && world.isAlive(e)) entities.push(e);
      }
      setSelection(world, entities, "replace");
    },
  });

  const sink = readOnly ? createReadOnlyCommitSink() : createDocCommitSink(store, world);
  const liveWriter = createLiveWriter(world, {
    keyOf: (e) => store.keyOf(e),
    mayDiverge: makeDefaultMayDiverge(world),
    cellInDoc: (e, c) => store.getComponent(e, c) !== undefined,
  });
  let closed = false;

  return {
    store,
    sink,
    readOnly,
    liveWriter,
    ...(report !== undefined ? { report } : {}),
    exportEnvelope(savedAt) {
      const header: EnvelopeHeader = {
        engineSchema: ENGINE_SCHEMA_VERSION,
        prefabVersions: localPrefabVersions(),
        ...(savedAt !== undefined ? { savedAt } : {}),
      };
      return encodeEnvelope(header, store.exportSnapshot());
    },
    exportSnapshot: () => store.exportSnapshot(),
    applyRemote: (bytes) => store.applyRemote(bytes),
    close() {
      if (closed) return;
      closed = true;
      cancelActiveGestures(world); // consumed by the next tick IF one runs pre-detach;
      // the reset below clears in-flight gesture state regardless — both paths safe.
      store.setHistoryHooks(null);
      attachment.detach();
      world.reset(); // in place: observers/systems survive (R3); entities die
      ensureCanvasSurface(world); // the interaction stack's anchor must exist again
    },
  };
}

/** Create + attach a fresh document (local-first by construction, design-001 §6.3). */
export function createDocSession(world: World, opts: DocSessionOpts = {}): DocSession {
  const doc = new LoroDoc();
  // Store FIRST, then stamp through its sanctioned meta path (strata 0.4.0),
  // then attach — metaTransaction is callable pre-attach by contract.
  const store = createDurableStore(
    doc,
    opts.maxUndoSteps !== undefined ? { maxUndoSteps: opts.maxUndoSteps } : undefined,
  );
  stampEngineMeta(store);
  const attachment = attachDurable(world, store);
  return makeSession(world, store, attachment, false);
}

/** Open an envelope: gate BEFORE attach; quarantine is a return value, never a throw. */
export function openDocSession(world: World, bytes: Uint8Array, opts: DocSessionOpts = {}): OpenDocResult {
  let payload: Uint8Array;
  try {
    payload = decodeEnvelope(bytes).payload;
  } catch (err) {
    const reason = err instanceof EnvelopeError ? err.message : String(err);
    return { ok: false, reason };
  }

  const doc = new LoroDoc();
  try {
    doc.import(payload);
  } catch (err) {
    return { ok: false, reason: `ice: payload import failed — ${String(err)}` };
  }

  const report = readDocVersionReport(doc);
  const verdict = (opts.onGate ?? ((_, v) => v))(report, gateVerdict(report));
  if (verdict === "reject") {
    return { ok: false, reason: "ice: version gate rejected the document", report };
  }

  try {
    const store = createDurableStore(
      doc,
      opts.maxUndoSteps !== undefined ? { maxUndoSteps: opts.maxUndoSteps } : undefined,
    );
    const attachment = attachDurable(world, store);

    // M9 (design-005 §6.4): the "migrate" verdict upgrades in place. Attach is
    // identical either way — readOnly is an engine concept (the commit sink), and
    // the migrator writes through store.transaction directly — so we run it on the
    // live attachment, then RE-GATE off the freshly stamped markers. A migrate that
    // catches the doc fully up flips the session writable; one that could not
    // upgrade every older pack (a type with no/gappy chain) stays read-only. Opt
    // out with opts.migrate=false (then "migrate" keeps M5's read-only behavior).
    let effectiveReport = report;
    let readOnly = verdict !== "ok";
    if (verdict === "migrate" && (opts.migrate ?? true)) {
      try {
        runMigrations({ store, world }, report);
        effectiveReport = readDocVersionReport(doc);
        readOnly = gateVerdict(effectiveReport) !== "ok";
      } catch {
        // A faulting transform must never brick open(): keep the doc, fall back
        // read-only (the user still gets projection + presence).
        readOnly = true;
      }
    }
    return { ok: true, session: makeSession(world, store, attachment, readOnly, effectiveReport) };
  } catch (err) {
    // Store/attach residuals (already-attached world, pending-import state,
    // mid-emit) quarantine like everything else on this path — open() NEVER
    // throws (review hardening; the corrupt-bytes exit bar extended to attach).
    return { ok: false, reason: `ice: attach failed — ${String(err)}`, report };
  }
}
