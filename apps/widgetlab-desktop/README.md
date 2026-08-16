# widgetlab-desktop

A standalone Electron version of Widgetlab. This package owns the complete React renderer,
styles, widget catalog, desktop collaboration adapter, Electron main/preload processes, and
renderer tests. Production windows load `dist/index.html` directly from disk; neither startup nor
the end-to-end smoke test depends on `apps/widgetlab` or a separate Vite server.

The Electron main process is an IPC room switchboard. Every window is a collaborator, and
`Cmd/Ctrl+N` opens another collaborator window. An optional
[truffle](https://github.com/vibecook-dev/truffle) mesh lets app instances on the same tailnet join
the room without a central server.

## Run

From the repository root:

```bash
pnpm install
pnpm --filter widgetlab-desktop start
```

`start` builds this package's renderer and launches Electron against the local build. No web server
is required.

For one-command renderer HMR:

```bash
pnpm --filter widgetlab-desktop dev
```

The development runner starts this package's Vite server, waits for it, launches Electron with an
explicit `ICE_URL`, and shuts the server down when Electron exits.

Useful commands:

```bash
pnpm --filter widgetlab-desktop typecheck
pnpm --filter widgetlab-desktop test
pnpm --filter widgetlab-desktop smoke
```

The smoke test builds the renderer, launches two real Electron windows over `file://`, verifies both
joined through IPC, then checks durable widget convergence and ephemeral presence convergence.

## Collaboration

The renderer detects `window.iceDesktop`, which is exposed by `src/preload.cjs`, and joins the room
through an IPC `ByteChannel`. The first window seeds the demo board; later windows and linked app
instances import it. ICE bootstrap frames stay opaque in the Electron main process.

To enable cross-machine collaboration, put a reusable ephemeral Tailscale auth key in
`apps/widgetlab-desktop/.env` (gitignored):

```dotenv
TS_AUTHKEY=tskey-auth-…
```

Without a key, truffle may open the browser for interactive tailnet authentication. Set
`ICE_MESH=off` for explicitly local-only operation.

Other runtime controls:

- `ICE_ROOM` changes the room name (default: `widgetlab`).
- `ICE_WINDOWS` opens multiple windows at launch, staggered to avoid split seeding.
- `ICE_STATE_DIR` changes the embedded tsnet state directory.
- `ICE_DEVICE_NAME` changes the tailnet device name.
- `ICE_URL` explicitly selects a renderer development server; normal production startup does not
  set or need it.
- `ICE_RENDERER_DEBUG=1` exposes the engine diagnostics used by the Electron smoke harness.

## Layout

```text
index.html + src/main.tsx
  React renderer, widgets, panels, cursor systems
             │ window.iceDesktop
             ▼
src/preload.cjs
  context-isolated IPC byte bridge
             │
             ▼
src/main.mjs
  window lifecycle + local room switchboard
             │
             └── src/mesh.mjs → optional tailnet QUIC/UDP mesh
```

The room is currently the source of truth while an instance is running; document persistence and
cross-genesis conflict resolution remain engine-level follow-ups.
