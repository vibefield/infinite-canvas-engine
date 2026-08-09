/**
 * The document version gate (design-001 §6.1/§5.2, design-005 §6.3).
 *
 * Version state lives in the doc's reserved `meta` root map as WRITE-ONCE
 * MARKER KEYS — a monotone key SET, never a mutated cell (sidestepping
 * first-writer-wins): `engine.schema.<n>` and `engine.pack.<type>.<v>` are
 * presence markers. Reading needs no strata API: the gate reads
 * `doc.getMap("meta")` on the RAW LoroDoc after import, BEFORE
 * `createDurableStore`/`attachDurable` — an incompatible doc never projects.
 *
 * Stamps go through `store.metaTransaction` (strata 0.4.0 — petition 3b
 * LANDED): the commit is properly tagged (peers no longer warn about an
 * untagged foreign writer), excluded from undo/redo, and invisible to
 * observers. Same underlying `meta` root map and raw keys as the pre-0.4.0
 * raw-doc stamps, so docs stamped by either path read identically here —
 * and importers also stopped warning about metadata-only commits from
 * before the API, so legacy docs are quiet too.
 *
 * M5 gate policy: exact schema + no doc-side pack NEWER than local ⇒ ok;
 * anything else ⇒ readOnly (or reject via policy). The migrate verdict (older
 * doc packs with a migrate chain) lands at M9 — the gate's verdict surface
 * already carries it so the facade policy hook is stable.
 */
import type { LoroDoc } from "loro-crdt";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { prefabs } from "../schema/prefab";
import { renames } from "../widget/define-widget";
import { ENGINE_SCHEMA_VERSION, type EnvelopeHeader } from "./envelope";

const SCHEMA_PREFIX = "engine.schema.";
const PACK_PREFIX = "engine.pack.";
/** `engine.renamed.<oldId>` = "<newId>" — the rename tombstone (design-008 §4). */
const RENAMED_PREFIX = "engine.renamed.";

export interface DocVersionReport {
  /** Highest engine.schema.<n> marker present (0 = unstamped/pre-engine doc). */
  readonly docSchema: number;
  readonly localSchema: number;
  /** Highest engine.pack.<id>.<v> per prefab id present in the doc. */
  readonly docPacks: Readonly<Record<string, number>>;
  /** Local registry versions for DURABLE prefabs. */
  readonly localPacks: Readonly<Record<string, number>>;
  /** Prefab ids whose doc marker is NEWER than local (built by a newer app). */
  readonly newerInDoc: readonly string[];
  /** Prefab ids whose doc marker is OLDER than local (M9 migration input). */
  readonly olderInDoc: readonly string[];
  /**
   * Old ids with a REGISTERED rename, present in the doc and not yet
   * tombstoned → the doc pack version their markers carry (design-008 §4).
   * The rename runner's exact input; non-empty forces at least "migrate".
   * Meta has no delete, so a stale old marker without this classification
   * would brick the doc `readOnly` via `newerInDoc` — the I5 failure mode.
   */
  readonly renamedInDoc: Readonly<Record<string, number>>;
}

export type GateVerdict = "ok" | "readOnly" | "migrate" | "reject";

/**
 * Stamp the engine markers through the store's sanctioned meta path (create
 * path; idempotent write-once; callable BEFORE attach — the order is
 * `createDurableStore(doc)` first, then stamp, then `attachDurable`).
 */
export function stampEngineMeta(store: DurableStore): void {
  store.metaTransaction((meta) => {
    const stamp = (key: string): void => {
      if (meta.get(key) === undefined) meta.set(key, true);
    };
    stamp(`${SCHEMA_PREFIX}${ENGINE_SCHEMA_VERSION}`);
    for (const p of prefabs.all()) {
      if (p.store !== "durable") continue;
      stamp(`${PACK_PREFIX}${p.id}.${p.version ?? 1}`);
    }
  });
}

/**
 * Fold raw doc-side pack versions through the rename layer (design-008 §4):
 * tombstoned old ids are DEAD HISTORY (meta cannot delete, so their markers
 * persist forever — skip them entirely); registered-rename old ids without a
 * tombstone alias their version onto the NEW id (`max` — the strongest
 * evidence wins) and land in `renamedInDoc` instead of `newerInDoc`.
 */
function foldRenames(
  rawPacks: Readonly<Record<string, number>>,
  tombstoned: ReadonlySet<string>,
): { docPacks: Record<string, number>; renamedInDoc: Record<string, number> } {
  const docPacks: Record<string, number> = {};
  const renamedInDoc: Record<string, number> = {};
  for (const [id, v] of Object.entries(rawPacks)) {
    if (tombstoned.has(id)) continue; // renamed away — the tombstone is doc-side truth
    const rename = renames.get(id);
    if (rename !== undefined) {
      renamedInDoc[id] = Math.max(renamedInDoc[id] ?? 0, v);
      const target = rename.widget.type;
      docPacks[target] = Math.max(docPacks[target] ?? 0, v);
      continue;
    }
    docPacks[id] = Math.max(docPacks[id] ?? 0, v);
  }
  return { docPacks, renamedInDoc };
}

function compare(
  docPacks: Readonly<Record<string, number>>,
  localPacks: Readonly<Record<string, number>>,
): { newerInDoc: string[]; olderInDoc: string[] } {
  const newerInDoc: string[] = [];
  const olderInDoc: string[] = [];
  for (const [id, v] of Object.entries(docPacks)) {
    const local = localPacks[id];
    if (local === undefined || v > local) newerInDoc.push(id);
    else if (v < local) olderInDoc.push(id);
  }
  return { newerInDoc, olderInDoc };
}

function localPackVersions(): Record<string, number> {
  const localPacks: Record<string, number> = {};
  for (const p of prefabs.all()) {
    if (p.store === "durable") localPacks[p.id] = p.version ?? 1;
  }
  return localPacks;
}

/** Read the marker keys off a raw (imported, unattached) doc and compare. */
export function readDocVersionReport(doc: LoroDoc): DocVersionReport {
  const meta = doc.getMap("meta");
  let docSchema = 0;
  const rawPacks: Record<string, number> = {};
  const tombstoned = new Set<string>();
  for (const key of meta.keys()) {
    if (key.startsWith(SCHEMA_PREFIX)) {
      const n = Number(key.slice(SCHEMA_PREFIX.length));
      if (Number.isInteger(n) && n > docSchema) docSchema = n;
    } else if (key.startsWith(RENAMED_PREFIX)) {
      tombstoned.add(key.slice(RENAMED_PREFIX.length));
    } else if (key.startsWith(PACK_PREFIX)) {
      const rest = key.slice(PACK_PREFIX.length);
      const dot = rest.lastIndexOf(".");
      if (dot <= 0) continue;
      const id = rest.slice(0, dot);
      const v = Number(rest.slice(dot + 1));
      if (!Number.isInteger(v)) continue;
      if ((rawPacks[id] ?? 0) < v) rawPacks[id] = v;
    }
  }

  const localPacks = localPackVersions();
  const { docPacks, renamedInDoc } = foldRenames(rawPacks, tombstoned);
  const { newerInDoc, olderInDoc } = compare(docPacks, localPacks);
  return { docSchema, localSchema: ENGINE_SCHEMA_VERSION, docPacks, localPacks, newerInDoc, olderInDoc, renamedInDoc };
}

/**
 * Build the same comparison report from an envelope header, before Loro
 * import. The header carries no meta, so no tombstone knowledge here —
 * registry aliasing only. This preflight is coarse by design; the
 * authoritative in-document gate re-runs right after import.
 */
export function readEnvelopeVersionReport(header: EnvelopeHeader): DocVersionReport {
  const localPacks = localPackVersions();
  const { docPacks, renamedInDoc } = foldRenames(header.prefabVersions, new Set());
  const { newerInDoc, olderInDoc } = compare(docPacks, localPacks);
  return {
    docSchema: header.engineSchema,
    localSchema: ENGINE_SCHEMA_VERSION,
    docPacks,
    localPacks,
    newerInDoc,
    olderInDoc,
    renamedInDoc,
  };
}

/** The default M5 policy. A facade policy hook may override (design-005 §6.3). */
export function gateVerdict(report: DocVersionReport): GateVerdict {
  if (report.docSchema === 0) return "reject"; // not an engine doc (or pre-stamp corruption)
  if (report.docSchema > report.localSchema) return "readOnly"; // newer app wrote it
  if (report.newerInDoc.length > 0) return "readOnly";
  if (
    report.docSchema < report.localSchema ||
    report.olderInDoc.length > 0 ||
    Object.keys(report.renamedInDoc).length > 0 // design-008: pending renames fold at open
  ) {
    return "migrate"; // M9 runs the chain; M5 treats as readOnly downstream
  }
  return "ok";
}
