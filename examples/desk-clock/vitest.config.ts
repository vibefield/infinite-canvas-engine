import { defineConfig } from "vitest/config";
import { umbrellaAlias } from "../../scripts/umbrella-alias.mjs";

// The desk clock's units (design-016 K8b): its law, its kind on a fake host, its declaration as the desk reads it — in Node, no
// GPU (its pixels are the oracle's and the rigs'). `@vibecook/ice/*` resolve to the umbrella's source entries (the same modules
// the app's `@ice/*` names reach), never to a build.
export default defineConfig({
  resolve: { alias: umbrellaAlias() },
  test: { environment: "node", testTimeout: 30_000 },
});
