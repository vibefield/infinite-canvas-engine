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
 * Stamps commit with strata's own meta origin ("strata-meta") so the
 * UndoManager excludes them exactly like the docId stamp. Remote peers'
 * adapters warn ONCE that this commit is untagged (no `strata:<n>` message —
 * we are a "foreign writer" to the batch protocol, deliberately: faking the
 * tag would corrupt batch-boundary bookkeeping). Harmless for write-once
 * markers; a warn-suppression for META_ORIGIN commits is a strata petition
 * candidate (docs/strata-petitions.md).
 *
 * M5 gate policy: exact schema + no doc-side pack NEWER than local ⇒ ok;
 * anything else ⇒ readOnly (or reject via policy). The migrate verdict (older
 * doc packs with a migrate chain) lands at M9 — the gate's verdict surface
 * already carries it so the facade policy hook is stable.
 */
import type { LoroDoc } from "loro-crdt";
import { prefabs } from "../schema/prefab";
import { ENGINE_SCHEMA_VERSION } from "./envelope";

const META_ORIGIN = "strata-meta"; // mirrors strata durable's constant (loro-snapshot.ts)

const SCHEMA_PREFIX = "engine.schema.";
const PACK_PREFIX = "engine.pack.";

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
}

export type GateVerdict = "ok" | "readOnly" | "migrate" | "reject";

/** Stamp the engine markers on a raw doc (create path; idempotent write-once). */
export function stampEngineMeta(doc: LoroDoc): void {
  const meta = doc.getMap("meta");
  const stamp = (key: string): void => {
    if (meta.get(key) === undefined) meta.set(key, true);
  };
  stamp(`${SCHEMA_PREFIX}${ENGINE_SCHEMA_VERSION}`);
  for (const p of prefabs.all()) {
    if (p.store !== "durable") continue;
    stamp(`${PACK_PREFIX}${p.id}.${p.version ?? 1}`);
  }
  doc.commit({ origin: META_ORIGIN });
}

/** Read the marker keys off a raw (imported, unattached) doc and compare. */
export function readDocVersionReport(doc: LoroDoc): DocVersionReport {
  const meta = doc.getMap("meta");
  let docSchema = 0;
  const docPacks: Record<string, number> = {};
  for (const key of meta.keys()) {
    if (key.startsWith(SCHEMA_PREFIX)) {
      const n = Number(key.slice(SCHEMA_PREFIX.length));
      if (Number.isInteger(n) && n > docSchema) docSchema = n;
    } else if (key.startsWith(PACK_PREFIX)) {
      const rest = key.slice(PACK_PREFIX.length);
      const dot = rest.lastIndexOf(".");
      if (dot <= 0) continue;
      const id = rest.slice(0, dot);
      const v = Number(rest.slice(dot + 1));
      if (!Number.isInteger(v)) continue;
      if ((docPacks[id] ?? 0) < v) docPacks[id] = v;
    }
  }

  const localPacks: Record<string, number> = {};
  for (const p of prefabs.all()) {
    if (p.store === "durable") localPacks[p.id] = p.version ?? 1;
  }

  const newerInDoc: string[] = [];
  const olderInDoc: string[] = [];
  for (const [id, v] of Object.entries(docPacks)) {
    const local = localPacks[id];
    if (local === undefined || v > local) newerInDoc.push(id);
    else if (v < local) olderInDoc.push(id);
  }

  return { docSchema, localSchema: ENGINE_SCHEMA_VERSION, docPacks, localPacks, newerInDoc, olderInDoc };
}

/** The default M5 policy. A facade policy hook may override (design-005 §6.3). */
export function gateVerdict(report: DocVersionReport): GateVerdict {
  if (report.docSchema === 0) return "reject"; // not an engine doc (or pre-stamp corruption)
  if (report.docSchema > report.localSchema) return "readOnly"; // newer app wrote it
  if (report.newerInDoc.length > 0) return "readOnly";
  if (report.docSchema < report.localSchema || report.olderInDoc.length > 0) return "migrate"; // M9 runs the chain; M5 treats as readOnly downstream
  return "ok";
}
