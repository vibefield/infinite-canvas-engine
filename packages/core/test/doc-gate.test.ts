/**
 * Adversarial coverage for the M5 file envelope + document version gate
 * (design-001 §6.5/§6.1, design-005 §6.2/§6.3): envelope round-trips, the
 * decode failure matrix (every `EnvelopeError.reason`), gate verdicts against
 * REAL `LoroDoc`s, and `openDocSession`'s never-throws contract end to end.
 */
import { LoroDoc } from "loro-crdt";
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  ENGINE_SCHEMA_VERSION,
  ENVELOPE_MAGIC,
  ENVELOPE_VERSION,
  EnvelopeError,
  Position,
  Size,
  StackZ,
  createDocSession,
  decodeEnvelope,
  definePrefab,
  encodeEnvelope,
  gateVerdict,
  init,
  openDocSession,
  readDocVersionReport,
  stampEngineMeta,
  type EnvelopeHeader,
} from "../src";

// --- byte-level helpers (deliberately NOT reusing encodeEnvelope, so the
// failure-matrix cases can corrupt exactly one field at a time) ---

function magicBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function buildFrame(opts: {
  magic?: string;
  version?: number;
  headerBytes?: Uint8Array;
  headerLenOverride?: number;
  payload?: Uint8Array;
}): Uint8Array {
  const magic = magicBytes(opts.magic ?? ENVELOPE_MAGIC);
  const header =
    opts.headerBytes ??
    new TextEncoder().encode(JSON.stringify({ engineSchema: ENGINE_SCHEMA_VERSION, prefabVersions: {} }));
  const payload = opts.payload ?? new Uint8Array(0);
  const headerLen = opts.headerLenOverride ?? header.length;
  const out = new Uint8Array(4 + 1 + 4 + header.length + payload.length);
  out.set(magic, 0);
  out[4] = opts.version ?? ENVELOPE_VERSION;
  new DataView(out.buffer).setUint32(5, headerLen, true);
  out.set(header, 9);
  out.set(payload, 9 + header.length);
  return out;
}

function getEnvelopeErrorReason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof EnvelopeError) return err.reason;
    throw new Error(`expected EnvelopeError, got ${String(err)}`);
  }
  throw new Error("expected decodeEnvelope to throw");
}

describe("envelope: encode/decode round-trip", () => {
  it("round-trips header + payload bytes identically", () => {
    const header: EnvelopeHeader = { engineSchema: 1, prefabVersions: { "some:prefab": 3 }, savedAt: 123456 };
    const payload = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
    const decoded = decodeEnvelope(encodeEnvelope(header, payload));
    expect(decoded.header).toEqual(header);
    expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
  });

  it("round-trips an empty payload", () => {
    const header: EnvelopeHeader = { engineSchema: 1, prefabVersions: {} };
    const decoded = decodeEnvelope(encodeEnvelope(header, new Uint8Array(0)));
    expect(decoded.header).toEqual(header);
    expect(decoded.payload.length).toBe(0);
  });

  it("round-trips a large-ish (10kB) payload", () => {
    const header: EnvelopeHeader = { engineSchema: 1, prefabVersions: {} };
    const payload = new Uint8Array(10_000);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const decoded = decodeEnvelope(encodeEnvelope(header, payload));
    expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
  });

  it("savedAt is optional and round-trips absent", () => {
    const header: EnvelopeHeader = { engineSchema: 1, prefabVersions: {} };
    const decoded = decodeEnvelope(encodeEnvelope(header, new Uint8Array([9])));
    expect(decoded.header).toEqual(header);
    expect(decoded.header.savedAt).toBeUndefined();
  });
});

describe("decodeEnvelope: failure matrix (EnvelopeError.reason)", () => {
  it("too-short buffer -> truncated", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // < 9 bytes
    expect(getEnvelopeErrorReason(() => decodeEnvelope(bytes))).toBe("truncated");
  });

  it("wrong magic -> magic", () => {
    const bytes = buildFrame({ magic: "XICE" });
    expect(getEnvelopeErrorReason(() => decodeEnvelope(bytes))).toBe("magic");
  });

  it("unknown envelope version byte -> version", () => {
    const bytes = buildFrame({ version: 99 });
    expect(getEnvelopeErrorReason(() => decodeEnvelope(bytes))).toBe("version");
  });

  it("header length overrunning the frame -> truncated", () => {
    const bytes = buildFrame({ headerLenOverride: 10_000 });
    expect(getEnvelopeErrorReason(() => decodeEnvelope(bytes))).toBe("truncated");
  });

  it("non-JSON header bytes -> header", () => {
    const bytes = buildFrame({ headerBytes: new TextEncoder().encode("not { json") });
    expect(getEnvelopeErrorReason(() => decodeEnvelope(bytes))).toBe("header");
  });

  it("JSON header missing engineSchema -> header", () => {
    const bytes = buildFrame({ headerBytes: new TextEncoder().encode(JSON.stringify({ prefabVersions: {} })) });
    expect(getEnvelopeErrorReason(() => decodeEnvelope(bytes))).toBe("header");
  });
});

describe("version gate: verdicts against real LoroDocs", () => {
  it("unstamped doc (docSchema 0) -> reject", () => {
    const doc = new LoroDoc();
    const report = readDocVersionReport(doc);
    expect(report.docSchema).toBe(0);
    expect(gateVerdict(report)).toBe("reject");
  });

  it("stampEngineMeta'd doc -> ok", () => {
    const doc = new LoroDoc();
    stampEngineMeta(doc);
    const report = readDocVersionReport(doc);
    expect(report.docSchema).toBe(ENGINE_SCHEMA_VERSION);
    expect(gateVerdict(report)).toBe("ok");
  });

  it("an extra HIGHER engine.schema marker (newer app wrote it) -> readOnly", () => {
    const doc = new LoroDoc();
    stampEngineMeta(doc);
    const meta = doc.getMap("meta");
    meta.set(`engine.schema.${ENGINE_SCHEMA_VERSION + 1}`, true);
    doc.commit();
    const report = readDocVersionReport(doc);
    expect(report.docSchema).toBe(ENGINE_SCHEMA_VERSION + 1);
    expect(gateVerdict(report)).toBe("readOnly");
  });

  it("a pack marker for an id with NO local registration counts as newerInDoc -> readOnly", () => {
    const doc = new LoroDoc();
    stampEngineMeta(doc); // docSchema matches local exactly
    const meta = doc.getMap("meta");
    meta.set("engine.pack.gate:ghost.5", true); // no local prefab named "gate:ghost"
    doc.commit();
    const report = readDocVersionReport(doc);
    expect(report.docSchema).toBe(ENGINE_SCHEMA_VERSION); // schema itself is unaffected
    expect(report.newerInDoc).toContain("gate:ghost");
    expect(gateVerdict(report)).toBe("readOnly");
  });

  it("a pack marker OLDER than the local registered version counts as olderInDoc -> migrate", () => {
    // A registered durable prefab at version 2 gives readDocVersionReport a local version to compare
    // against — olderInDoc (unlike newerInDoc) can only fire for an id the registry actually knows.
    const widget = definePrefab("gate:widget", {
      store: "durable",
      version: 2,
      components: [init(Position, { x: 0, y: 0 })],
    });
    const doc = new LoroDoc();
    const meta = doc.getMap("meta");
    // Stamp schema only (NOT stampEngineMeta, which would stamp the pack at ITS current version 2 —
    // we need the doc-side pack marker to read as version 1, older than local).
    meta.set(`engine.schema.${ENGINE_SCHEMA_VERSION}`, true);
    meta.set(`engine.pack.${widget.id}.1`, true);
    doc.commit();
    const report = readDocVersionReport(doc);
    expect(report.docSchema).toBe(ENGINE_SCHEMA_VERSION); // schema itself is exact, isolating the pack case
    expect(report.olderInDoc).toContain(widget.id);
    expect(gateVerdict(report)).toBe("migrate");
  });
});

describe("openDocSession: never throws", () => {
  it("garbage bytes -> {ok:false} with a truthy reason", () => {
    const world = createWorld();
    const result = openDocSession(world, new Uint8Array([1, 2, 3]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it("a valid envelope wrapping garbage payload -> {ok:false} with a truthy reason", () => {
    const world = createWorld();
    const header: EnvelopeHeader = { engineSchema: ENGINE_SCHEMA_VERSION, prefabVersions: {} };
    const bytes = encodeEnvelope(header, new TextEncoder().encode("this is not a loro snapshot"));
    const result = openDocSession(world, bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it("a valid envelope wrapping an UNSTAMPED doc snapshot -> {ok:false}, gated, with a report", () => {
    const world = createWorld();
    const unstamped = new LoroDoc(); // never stampEngineMeta'd
    const payload = unstamped.export({ mode: "snapshot" });
    const header: EnvelopeHeader = { engineSchema: ENGINE_SCHEMA_VERSION, prefabVersions: {} };
    const bytes = encodeEnvelope(header, payload);

    const result = openDocSession(world, bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeTruthy();
      expect(result.report).toBeDefined();
      expect(result.report?.docSchema).toBe(0);
    }
  });

  it("happy path: create -> spawn -> exportEnvelope -> open on a fresh world -> queryable", () => {
    const world1 = createWorld();
    const session1 = createDocSession(world1);

    session1.store.transaction((tx) => {
      tx.spawn({
        components: [
          [Position, { x: 42, y: 7 }],
          [Size, { w: 80, h: 60 }],
          [StackZ, { z: 0 }],
        ],
      });
    });
    world1.sync();

    const bytes = session1.exportEnvelope(1_700_000_000_000);

    const world2 = createWorld();
    const result = openDocSession(world2, bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.readOnly).toBe(false);

    world2.sync();
    const boxQ = defineQuery([Position, Size]);
    const found: { x: number; y: number }[] = [];
    world2.query(boxQ).each((b) => {
      for (const r of b) found.push(world2.read(b.entity(r), Position));
    });
    expect(found).toEqual([{ x: 42, y: 7 }]);
  });
});
