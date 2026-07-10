/**
 * The browser entry (index.html → this file). All bootstrapping lives in the
 * side-effect-free `./app` module so the exit tests can import `boot` and the
 * seeding helpers without triggering a real (WebGL) mount; this file's only job
 * is to run it against `#app`.
 */
import { boot } from "./app";

void boot().catch((err) => {
  console.error("gl-board demo failed to boot:", err);
});
