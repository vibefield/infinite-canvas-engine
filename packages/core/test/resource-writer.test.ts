import { createWorld, defineResource as rawDefineResource } from "@vibecook/strata-ecs";
import { afterEach, describe, expect, it } from "vitest";
import { setDevGuards } from "../src/guards/dev";
import { writeRuntimeResource } from "../src/guards/resource-writer";
import { defineResource } from "../src/schema/meta";

// Resources are schema-global handles but their VALUES are per-world, so a fresh world per test
// keeps them isolated (mirrors version-stamps.test.ts). Handles are defined once, up top.
const RuntimeRes = defineResource("RwTestRuntime", { v: "u32" }, { durable: false });
const DefaultRes = defineResource("RwTestDefault", { v: "u32" }); // no opts → durable defaults false
const DurableRes = defineResource("RwTestDurable", { v: "u32" }, { durable: true });
// Defined straight through strata (bypassing ../schema/meta) → never lands in schemaMeta →
// the guard cannot classify it. Stands in for a userland resource made without the wrapper.
const UnknownRes = rawDefineResource("RwTestUnknown", { v: "u32" });

describe("writeRuntimeResource (design-001 §2 rule 7 — the mirror of guarded-tx's setResource)", () => {
  // The dev-guard flag is module-global; restore it so a silenced test can't leak into the rest.
  afterEach(() => setDevGuards(true));

  it("writes a runtime-declared resource through to the world", () => {
    const w = createWorld();
    writeRuntimeResource(w, RuntimeRes, { v: 7 });
    expect(w.getResource(RuntimeRes)?.v).toBe(7);
  });

  it("treats an unspecified durable flag as runtime (durability is opt-in)", () => {
    const w = createWorld();
    writeRuntimeResource(w, DefaultRes, { v: 3 });
    expect(w.getResource(DefaultRes)?.v).toBe(3);
  });

  it("DEV-throws on a durable-declared resource and leaves the world unwritten", () => {
    const w = createWorld();
    expect(() => writeRuntimeResource(w, DurableRes, { v: 1 })).toThrow(
      /declared durable — durable resources are written in transactions/,
    );
    expect(w.getResource(DurableRes)).toBeUndefined();
  });

  it("cites design-001 §2 rule 7 in the error message", () => {
    const w = createWorld();
    expect(() => writeRuntimeResource(w, DurableRes, { v: 1 })).toThrow(/design-001 §2 rule 7/);
  });

  it("setDevGuards(false) silences the check — the durable write goes through", () => {
    const w = createWorld();
    setDevGuards(false);
    writeRuntimeResource(w, DurableRes, { v: 9 });
    expect(w.getResource(DurableRes)?.v).toBe(9);
  });

  it("passes unknown (non-wrapper) resources with no check — best-effort by design", () => {
    const w = createWorld();
    // No schemaMeta entry ⇒ the guard has nothing to classify against, so it must not block.
    expect(() => writeRuntimeResource(w, UnknownRes, { v: 5 })).not.toThrow();
    expect(w.getResource(UnknownRes)?.v).toBe(5);
  });
});
