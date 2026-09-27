import { defineConfig } from "vitest/config";

// @ice/objects' units (design-016 K4b): the six reference kinds' laws, their world halves on the desk's builder, their
// programs against the WGSL that reads them — no GPU, in Node, as they were in @ice/desk. The GPU path is the oracle's
// (Dawn in Node) and apps/desk's rigs (headless Chrome).
export default defineConfig({
  test: { environment: "node" },
});
