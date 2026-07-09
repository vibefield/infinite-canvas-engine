/**
 * The cursor reflector (design-003 §7 L4 cursor projection; v1 approach:
 * local cursor = OS cursor via one `style.cursor` write).
 *
 * `createCursorSync` resolves the cursor string into closure state every
 * `derive` tick with no observable ECS stamp (a plain string, not a
 * component/resource write), so there is nothing for `observe` to watch —
 * hence `always: true` with an internal last-value cache, mirroring the
 * "cheap-overlay style" carve-out `ReflectorDef.always` exists for. The cache
 * is what keeps the write ONE-per-change: `flush` runs every frame, but
 * `host.container.style.cursor` is only touched when `readCursor()` differs
 * from the last-applied value.
 *
 * Law 10: reflectors run post-notify, write output only, never read layout
 * or write ECS — this flush touches only `host.container.style`.
 */
import type { ReflectorDef, World } from "@ice/core";
import type { CanvasHost } from "../host";

export function createCursorReflector(
  host: CanvasHost,
  readCursor: () => string,
): ReflectorDef & { writes(): number } {
  let writes = 0;
  let last: string | undefined;
  return {
    name: "cursor",
    always: true,
    flush(_world: World) {
      const next = readCursor();
      if (next === last) return;
      last = next;
      host.container.style.cursor = next;
      writes++;
    },
    writes: () => writes,
  };
}
