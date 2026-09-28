import { defineConfig } from "vitest/config";

// @ice/objects' units (design-016 K4b): the six reference kinds' laws, their world halves on the desk's builder, their
// programs against the WGSL that reads them — no GPU, in Node, as they were in @ice/desk. The GPU path is the oracle's
// (Dawn in Node) and apps/desk's rigs (headless Chrome).
// A test's timeout is a HANG guard, not a claim (K-H): the kinds' GPU-free suites still build books, pages and prints on the CPU, and
// at load 300 three of them took 5.2–10.8 s of wall time against vitest's 5 s default — ci red with every assertion true
export default defineConfig({
  test: { environment: "node", testTimeout: 30_000 },
});
