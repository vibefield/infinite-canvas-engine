// @vitest-environment node
// THE ROOM'S OTHER PEOPLE (petition I26 — `deskLayer({ cursors })`): a host that draws its peers itself (VibeField, each by face, from
// `usePresencePeers`) mounts the desk with `cursors: false`, and the layer says so on its HANDLE — where the host it is mounted in reads
// it before it registers the remote cursors (`@ice/dom`'s `createDeskHost`, its structural `LayerHandle.cursors`). Read at the mount;
// absent, `true` — the host draws them, as ever.
import { createCanvasEngine } from "@ice/core";
import { describe, expect, it } from "vitest";
import { deskLayer } from "../src/host/layer";
import { type Palette, themeFrom } from "../src/theme";
import { fakePage } from "./fake-page";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };
/** A GPU that never answers: the mount runs up to its boot and waits there — the handle is the mount's, the boot beside the point. */
const SILENT = { requestAdapter: () => new Promise(() => {}) } as unknown as GPU;

/** The handle's word when the layer is mounted with `cursors` (or without it). */
function cursorsOf(cursors: boolean | undefined): boolean {
  const ce = createCanvasEngine({});
  const page = fakePage();
  const handle = deskLayer({ gpu: SILENT, theme: themeFrom("light", PALETTE), palette: PALETTE, ...(cursors !== undefined ? { cursors } : {}) })({ host: { container: page.container } as never, world: ce.world });
  const said = handle.cursors;
  handle.dispose();
  ce.dispose();
  return said;
}

describe("the room's other people (petition I26)", () => {
  it("`cursors: false` — the host draws its peers itself: the handle says so, for the host it is mounted in", () => {
    expect(cursorsOf(false)).toBe(false);
  });

  it("absent or `true`, the handle says `true` — the host draws them, as ever", () => {
    expect(cursorsOf(undefined)).toBe(true);
    expect(cursorsOf(true)).toBe(true);
  });
});
