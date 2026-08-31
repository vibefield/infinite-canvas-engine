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
import {
  DefaultCanvasType,
  canvasIdentityOf,
  sameCanvasIdentity,
  type CanvasTypeIdentity,
} from "../canvas/define-canvas-type";
import type { EngineCatalog } from "../canvas/engine-catalog";
import { runCanvasSemanticMigrations } from "../canvas/migrate";
import { Selected } from "../catalog";
import type { CommitIntent, CommitSink } from "../engine/commit-sink";
import { ensureCanvasSurface } from "../interaction/install";
import { cancelActiveGestures } from "../ops/gestures";
import { selectedEntities, setSelection } from "../ops/selection";
import {
  EnvelopeError,
  decodeEnvelope,
  encodeEnvelope,
  type EnvelopeHeader,
} from "./envelope";
import { createDocCommitSink, createReadOnlyCommitSink } from "./doc-commit-sink";
import { runMigrations } from "./migrate";
import { runRenames } from "./rename";
import { armRenameSweep } from "./rename-sweep";
import { ensureBoardRoot, resolveBoardRoot, runSchemaMigrations } from "./schema-migrate";
import { BoardRoot } from "../catalog/scene";
import { writeRuntimeResource } from "../guards/resource-writer";
import { createLiveWriter, type LiveWriter } from "../guards/live-writer";
import { makeDefaultMayDiverge } from "../ops/claims";
import {
  gateVerdict,
  readEnvelopeVersionReport,
  readDocVersionReport,
  stampEngineMeta,
  type DocVersionScope,
  type DocVersionReport,
  type GateVerdict,
} from "./version-gate";

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
  /** Low-level engine-scoped pack authority; the facade always supplies this. */
  readonly versionScope?: DocVersionScope;
  /** New-document identity only. Existing documents always use their stored value. */
  readonly rootCanvas?: CanvasTypeIdentity;
  /** Engine-owned final mutation guard; low-level unscoped sessions may omit it. */
  readonly commitGuard?: (intent: CommitIntent) => CommitIntent | undefined;
  /** Engine-scoped CanvasType definitions used by solo semantic migration. */
  readonly canvasCatalog?: EngineCatalog;
}

export interface DocSession {
  readonly store: DurableStore;
  readonly sink: CommitSink;
  /**
   * The strata attachment — a read-only INSPECTION seam: its `baseline` feeds
   * the observer devtools' durable tab (runtime-vs-baseline = the un-agreed
   * sync delta). Never a sync path; `close()` owns its lifecycle.
   */
  readonly attachment: Attachment;
  readonly readOnly: boolean;
  /** Authoritative stored root identity, absent only for malformed legacy/read-only data. */
  readonly rootCanvas?: CanvasTypeIdentity;
  /**
   * The design-001 §3 step-2 DEV guard, wired to THIS doc: userland live
   * writes to doc cells go through it (throws without a claim/tween;
   * cellInDoc is exact via store.getComponent). Engine behaviors stay on
   * ctx — they hold claims by construction.
   */
  readonly liveWriter: LiveWriter;
  /** Present on the open path (the gate's evidence). */
  readonly report?: DocVersionReport;
  /** Re-read current monotone requirements after remote/capability changes. */
  versionReport(): DocVersionReport;
  /** Solo/local capability grant: requirement markers land before any content. */
  upgradePacks(packs: Readonly<Record<string, number>>): boolean;
  /** Envelope-framed snapshot for storage (autosave kit consumes this). */
  exportEnvelope(savedAt?: number): Uint8Array;
  /** Relay passthroughs (M5 dumb relay; M9 brings the bootstrap protocol). */
  exportSnapshot(): Uint8Array;
  applyRemote(bytes: Uint8Array): void;
  /**
   * Fires after each successful `applyRemote` on THIS session (strata's
   * `subscribeOutbound` is local-commits-only by design, so remote imports are
   * otherwise unobservable). Autosave rides this so a peer's local backup
   * reflects the last-seen document, not just what it authored (2026-07-13
   * review). A transport writing through `store.applyRemote` directly bypasses
   * it — engine paths (bootstrap, broadcast relay) all go through the session.
   */
  subscribeRemote(fn: (bytes: Uint8Array) => void): () => void;
  /** cancel gestures → detach → world reset in place → respawn the anchor. */
  close(): void;
}

export type OpenDocResult =
  | { readonly ok: true; readonly session: DocSession }
  | { readonly ok: false; readonly reason: string; readonly report?: DocVersionReport };

const constrainSemanticVerdict = (
  report: DocVersionReport,
  verdict: GateVerdict,
): GateVerdict =>
  (report.rootIssue !== undefined || (report.dependencyIssues?.length ?? 0) > 0) &&
  verdict !== "reject"
    ? "readOnly"
    : verdict;

function makeSession(
  world: World,
  doc: LoroDoc,
  store: DurableStore,
  attachment: Attachment,
  readOnly: boolean,
  versionScope: DocVersionScope | undefined,
  commitGuard: DocSessionOpts["commitGuard"],
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

  const sink = readOnly
    ? createReadOnlyCommitSink()
    : createDocCommitSink(store, world, {
        ...(commitGuard === undefined ? {} : { guard: commitGuard }),
      });
  const liveWriter = createLiveWriter(world, {
    keyOf: (e) => store.keyOf(e),
    mayDiverge: makeDefaultMayDiverge(world),
    cellInDoc: (e, c) => store.getComponent(e, c) !== undefined,
  });
  // The rename zombie sweep (design-008 §6): writable sessions fold stale
  // pre-rename deliveries between frames; read-only sessions never write, so
  // their zombies stay visible-but-inert until a writable open folds them.
  const disarmRenameSweep = readOnly ? undefined : armRenameSweep(world, store);
  let closed = false;
  const remoteSubs = new Set<(bytes: Uint8Array) => void>();
  let currentVersionReport = report ?? readDocVersionReport(doc, versionScope);

  return {
    store,
    sink,
    attachment,
    readOnly,
    liveWriter,
    ...(currentVersionReport.rootCanvas === undefined
      ? {}
      : { rootCanvas: currentVersionReport.rootCanvas }),
    ...(report !== undefined ? { report } : {}),
    versionReport: () => currentVersionReport,
    upgradePacks(packs) {
      if (closed || readOnly || gateVerdict(currentVersionReport) !== "ok") {
        throw new Error("ice: cannot upgrade capabilities on a closed or read-only document.");
      }
      const additions: Array<readonly [string, number]> = [];
      for (const [id, version] of Object.entries(packs)) {
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new Error(`ice: invalid capability pack version for "${id}".`);
        }
        if (currentVersionReport.localPacks[id] !== version) {
          throw new Error(`ice: capability pack "${id}"@${version} is not compiled by this engine.`);
        }
        const existing = currentVersionReport.docPacks[id];
        if (existing === undefined) additions.push([id, version]);
        else if (existing !== version) {
          throw new Error(
            `ice: capability pack "${id}" already has version ${existing}; semantic upgrades require migration.`,
          );
        }
      }
      if (additions.length === 0) return false;
      store.metaTransaction((meta) => {
        for (const [id, version] of additions) {
          const key = `engine.pack.${id}.${version}`;
          if (meta.get(key) === undefined) meta.set(key, true);
        }
      });
      currentVersionReport = readDocVersionReport(doc, versionScope);
      if (gateVerdict(currentVersionReport) !== "ok") {
        throw new Error("ice: capability upgrade left the document gate non-writable.");
      }
      return true;
    },
    exportEnvelope(savedAt) {
      const current = readDocVersionReport(doc, versionScope);
      currentVersionReport = current;
      const header: EnvelopeHeader = {
        engineSchema: current.docSchema,
        prefabVersions: current.docPacks,
        ...(current.rootCanvas === undefined ? {} : { rootCanvas: current.rootCanvas }),
        ...(savedAt !== undefined ? { savedAt } : {}),
      };
      return encodeEnvelope(header, store.exportSnapshot());
    },
    exportSnapshot: () => store.exportSnapshot(),
    applyRemote(bytes) {
      if (closed) throw new Error("ice: cannot apply a remote update to a closed document");
      store.applyRemote(bytes); // a throw (PendingImportError et al.) skips notification
      currentVersionReport = readDocVersionReport(doc, versionScope);
      for (const fn of [...remoteSubs]) fn(bytes);
    },
    subscribeRemote(fn) {
      remoteSubs.add(fn);
      return () => remoteSubs.delete(fn);
    },
    close() {
      if (closed) return;
      closed = true;
      disarmRenameSweep?.();
      cancelActiveGestures(world); // consumed by the next tick IF one runs pre-detach;
      // the reset below clears in-flight gesture state regardless — both paths safe.
      store.setHistoryHooks(null);
      remoteSubs.clear();
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
  const rootCanvas = opts.rootCanvas ?? canvasIdentityOf(DefaultCanvasType);
  stampEngineMeta(store, opts.versionScope, rootCanvas);
  const attachment = attachDurable(world, store);
  // Petition 8: every schema-2 doc carries a board root from birth — root-level widgets hang
  // their ordered ChildOf edges on it. Runtime resource names it for the ops/renderers.
  const root = ensureBoardRoot(world, store);
  writeRuntimeResource(world, BoardRoot, { root });
  const report = readDocVersionReport(doc, opts.versionScope);
  return makeSession(
    world,
    doc,
    store,
    attachment,
    false,
    opts.versionScope,
    opts.commitGuard,
    report,
  );
}

/** Open an envelope: gate BEFORE attach; quarantine is a return value, never a throw. */
export function openDocSession(world: World, bytes: Uint8Array, opts: DocSessionOpts = {}): OpenDocResult {
  let payload: Uint8Array;
  let envelopeReport: DocVersionReport;
  let header: EnvelopeHeader;
  try {
    const decoded = decodeEnvelope(bytes);
    payload = decoded.payload;
    header = decoded.header;
    envelopeReport = readEnvelopeVersionReport(header, opts.versionScope);
  } catch (err) {
    const reason = err instanceof EnvelopeError ? err.message : String(err);
    return { ok: false, reason };
  }

  // Coarse gate before the WASM import. The in-document markers are still
  // authoritative and are checked again below; this fast path prevents a
  // policy-rejected future envelope from reaching Loro at all.
  try {
    const requested = (opts.onGate ?? ((_, v) => v))(
      envelopeReport,
      gateVerdict(envelopeReport),
    );
    const preflight = constrainSemanticVerdict(envelopeReport, requested);
    if (preflight === "reject") {
      return { ok: false, reason: "ice: version gate rejected the envelope", report: envelopeReport };
    }
  } catch (err) {
    return { ok: false, reason: `ice: onGate callback threw during envelope preflight — ${String(err)}`, report: envelopeReport };
  }

  const doc = new LoroDoc();
  let attachment: Attachment | undefined;
  try {
    doc.import(payload);
  } catch (err) {
    return { ok: false, reason: `ice: payload import failed — ${String(err)}` };
  }

  const rawReport = readDocVersionReport(doc, opts.versionScope);
  const report: DocVersionReport =
    rawReport.docSchema >= 3 && !sameCanvasIdentity(header.rootCanvas, rawReport.rootCanvas)
      ? {
          ...rawReport,
          rootIssue:
            rawReport.rootIssue ??
            "envelope rootCanvas does not agree with authoritative document metadata",
        }
      : rawReport;
  let verdict: ReturnType<typeof gateVerdict>;
  try {
    const requested = (opts.onGate ?? ((_, v) => v))(report, gateVerdict(report));
    verdict = constrainSemanticVerdict(report, requested);
  } catch (err) {
    // A throwing policy callback must not break open()'s no-throw contract —
    // during network bootstrap it would escape an inbound channel callback and
    // leave the join promise pending forever. Quarantine instead.
    return { ok: false, reason: `ice: onGate callback threw — ${String(err)}`, report };
  }
  if (verdict === "reject") {
    return { ok: false, reason: "ice: version gate rejected the document", report };
  }

  try {
    const store = createDurableStore(
      doc,
      opts.maxUndoSteps !== undefined ? { maxUndoSteps: opts.maxUndoSteps } : undefined,
    );
    attachment = attachDurable(world, store);

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
        // Petition 8: STRUCTURAL schema steps run FIRST (they may spawn the board root and
        // rewrite relations the pack runner's entities already carry), then RENAMES
        // (design-008 §5 — type folds must precede the pack runner so version chains
        // operate on new-name cells; schema steps touch no pack markers, so the original
        // report's renamedInDoc is still exact), then the per-prefab pack runner, then ONE
        // re-gate off the freshly stamped markers. SINGLE-WRITER LAW: this branch is the
        // solo-open path only — a live-room joiner passes migrate:false (bootstrap) and
        // stays read-only on an old-schema doc.
        runSchemaMigrations({ store, world }, report);
        const renamed = runRenames({ store, world }, report);
        // A rename WRITES cells the pack runner READS through the world, and
        // local transactions project only at the next sync — without this
        // drain the chain would fold an empty record (the runners before it
        // never had a write→read dependency, so this is the first sync the
        // open path needs).
        if (renamed.renamed.length > 0) world.sync();
        runMigrations({ store, world }, readDocVersionReport(doc, opts.versionScope));
        world.sync();
        if (opts.canvasCatalog !== undefined) {
          const migrationRoot = resolveBoardRoot(world, store);
          if (migrationRoot !== undefined) {
            writeRuntimeResource(world, BoardRoot, { root: migrationRoot });
          }
          runCanvasSemanticMigrations(
            store,
            world,
            opts.canvasCatalog,
            readDocVersionReport(doc, opts.versionScope),
          );
        }
        effectiveReport = readDocVersionReport(doc, opts.versionScope);
        readOnly = gateVerdict(effectiveReport) !== "ok";
      } catch {
        // A faulting transform must never brick open(): keep the doc, fall back
        // read-only (the user still gets projection + presence). Re-read the
        // report — runMigrations plans all types before writing, so a transform
        // throw leaves the doc untouched, but a write-phase fault may have
        // stamped earlier types; session.report must describe the doc AS IS.
        effectiveReport = readDocVersionReport(doc, opts.versionScope);
        readOnly = true;
      }
    }
    // Petition 8: name the board root for ops/renderers when the doc has one (any schema-2
    // doc). Absent on a pre-schema-2 read-only doc — renderers fall back to the legacy
    // StackZ sort; never minted here on the read-only path (minting is a write).
    if (readOnly) {
      const root = resolveBoardRoot(world, store);
      if (root !== undefined) writeRuntimeResource(world, BoardRoot, { root });
    } else {
      writeRuntimeResource(world, BoardRoot, { root: ensureBoardRoot(world, store) });
    }
    return {
      ok: true,
      session: makeSession(
        world,
        doc,
        store,
        attachment,
        readOnly,
        opts.versionScope,
        opts.commitGuard,
        effectiveReport,
      ),
    };
  } catch (err) {
    // Store/attach residuals (already-attached world, pending-import state,
    // mid-emit) quarantine like everything else on this path — open() NEVER
    // throws (review hardening; the corrupt-bytes exit bar extended to attach).
    try {
      attachment?.detach();
      world.reset();
      ensureCanvasSurface(world);
    } catch (rollbackErr) {
      return {
        ok: false,
        reason: `ice: attach failed — ${String(err)}; rollback failed — ${String(rollbackErr)}`,
        report,
      };
    }
    return { ok: false, reason: `ice: attach failed — ${String(err)}`, report };
  }
}
