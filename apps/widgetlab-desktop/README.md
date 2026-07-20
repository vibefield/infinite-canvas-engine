# widgetlab-desktop — the widgetlab demo as a serverless desktop collab app

[widgetlab](../widgetlab) running in a minimal Electron shell. The renderer is the unchanged
browser app; the desktop shell contributes exactly one thing: **a transport**.

- **Windows of one instance** — the Electron main process is a room *switchboard*: every window
  is a collaborator, relayed over IPC. Frames are @ice/core's §6.5 bootstrap frames and stay
  opaque — the switchboard never decodes a payload, holds no document state, resolves no
  conflicts (convergence is the engine's job behind `joinDoc`).
- **Instances across machines** — main additionally joins a
  [truffle](https://github.com/jamesyong-42/truffle) mesh (Tailscale tsnet embedded in-process):
  widgetlab-desktop instances on other machines discover each other by appId on your tailnet and
  become room members — bootstrap frames over raw QUIC streams (each snapshot on its own stream,
  so a join never head-of-line-blocks live increments), presence over UDP datagrams
  (latest-lossy; oversize falls back reliable). No server anywhere, and no Tailscale install
  needed: the app itself is the tailnet node.

What syncs: every widget spawn/move/resize/edit (durable, gesture-atomic undo per peer), the
full widget set including R3F/GL islands, and live presence cursors (each window shows every
other collaborator's named cursor).

## Run

```bash
pnpm install                          # repo root
pnpm --filter widgetlab dev           # terminal 1 — the UI dev server (vite, :5173)
pnpm --filter widgetlab-desktop start # terminal 2 — the Electron shell
```

**Cmd/Ctrl+N** opens a second window — a second collaborator in the room, converging over IPC
with zero network. `ICE_URL` overrides the dev-server origin; `ICE_ROOM` overrides the room
name (default `widgetlab`).

The renderer detects the desktop shell by the preload bridge (`window.iceDesktop`) and boots
through `engine.docs.join()` over an IPC byte channel instead of creating a local document —
the first peer in the room seeds the demo board; every later window/instance imports it.

### Across machines (the mesh)

Put a Tailscale auth key in `apps/widgetlab-desktop/.env` (gitignored):

```
TS_AUTHKEY=tskey-auth-…    # Reusable + Ephemeral
```

Then start the app on each machine (each needs its own widgetlab dev server, or set `ICE_URL`).
Instances register as ephemeral tailnet nodes, find each other by appId (`ice-collab`), and link
up — the same room converges across machines with zero server. Without an auth key the first
run opens a browser to authenticate the node interactively; without any tailnet the app just
runs local-only.

A joining instance holds its first window until the mesh link is up (or an 8s grace) — a window
that hellos before the link would seed its own divergent genesis (the split-seed race; the
engine's bootstrap declares the cold-start tie-break out of scope, so the shell makes it rare).

**Link-flap repair.** truffle raw streams have no replay — anything in flight when a link drops
is gone. When a link comes (back) up, main sends every window `ice:resync` and each active
session re-offers its document base (`offerBase` → an un-addressed `SNAPSHOT_OFFER`): active
peers merge it (loro dedupes; the offer subsumes whatever the outage dropped), buffering peers
adopt it. No teardown, no re-join, no UI flash — cheaper than canvas-desktop's window-bounce
because ICE's §6.5 protocol already defines every receiver's move for an offer.

Dev knobs: `ICE_STATE_DIR` (tsnet state; set distinct dirs to run several instances on ONE
machine — each is its own tailnet node), `ICE_DEVICE_NAME`, `ICE_WINDOWS` (open N windows at
launch, staggered 2.5s so they don't split-seed).

## How the pieces meet

```
renderer (widgetlab, unchanged)               main (this package)
  boot picks the doc path:                      src/main.mjs — room switchboard
    window.iceDesktop present?  ──────►           members: webContents ↔ room
      └ docs.join(ipcByteChannel)                 forwards opaque frames room-wide
        via src/preload.cjs (contextBridge;       reads ONLY bytes[0] to pick a mesh
        Uint8Array structured-clones)             lane: presence→UDP · snapshot→own
    absent → docs.create() (plain browser)        QUIC stream · rest→durable stream
                                                  + truffle mesh node (mesh.mjs)
```

The renderer-side channel is ~40 lines in widgetlab (`ipcByteChannel`) satisfying the same
`ByteChannel` surface as `broadcastChannelByteChannel` / `webSocketByteChannel` — the engine's
bootstrap state machine cannot tell the difference.

## Not in v1 (deliberate)

- **Packaging** (a distributable .app): canvas-desktop's `@electron/packager` + loopback
  static-server treatment ports directly when wanted; this example runs against the dev server.
- **Persistence**: the room is the source of truth while any instance runs; the board resets
  when the last instance quits. `docs.autosave()` to userData is the obvious follow-up.
- **Cross-genesis merge**: two instances that each seeded offline (both cold-started with no
  link) hold unrelated documents; a later offer-merge between them is undefined-ish (two board
  roots). meshHold + the launch stagger make it rare; fixing it for real is an engine-level
  tie-break, tracked in @ice/core's bootstrap notes.
