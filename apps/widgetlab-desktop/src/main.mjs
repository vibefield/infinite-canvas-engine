/**
 * widgetlab-desktop main process — the widgetlab demo as a standalone Electron app.
 *
 * The renderer lives in this package and is loaded from its local Vite build in
 * production. `ICE_URL` can explicitly point at this package's dev server. The
 * desktop shell also adds a TRANSPORT: this process is the room SWITCHBOARD,
 * bridged into each window by preload.cjs as `window.iceDesktop`; widgetlab's
 * boot selects the IPC byte channel whenever that bridge exists — the same
 * `ByteChannel` seam @ice/core's BroadcastChannel/WebSocket adapters satisfy.
 *
 * The frames it moves are @ice/core's §6.5 bootstrap frames and they stay
 * OPAQUE: the switchboard never decodes a payload, holds NO document state, and
 * resolves NO conflicts (the collab-relay contract, inherited from strata's
 * canvas-desktop example). The ONE byte it reads is `bytes[0]` — the frame-kind
 * tag ICE puts in front of every payload — and only to pick a mesh DELIVERY
 * LANE: PRESENCE(5) → latest-lossy UDP; SNAPSHOT_OFFER(2)/SNAPSHOT(3) → a
 * short-lived QUIC stream of their own (a 1-2MB base must not head-of-line-
 * block live increments); HELLO(1)/UPDATE(4) → the long-lived reliable-ordered
 * durable stream. Addressing lives INSIDE ICE's frames (an addressed SNAPSHOT
 * carries its target id; non-targets ignore or merge it), so the switchboard
 * broadcasts everything room-wide — no `to`-routing at this layer, and mesh
 * frames are delivered to local windows only, never re-forwarded (one-hop,
 * loop-free by construction).
 *
 * LINK-FLAP REPAIR (differs from canvas-desktop): truffle raw streams have no
 * replay — anything in flight when a link drops is GONE. canvas-desktop bounced
 * every window's channel lifecycle and re-ran the full bootstrap; ICE's
 * protocol has a cheaper native repair: on a link coming UP, main sends
 * `ice:resync` to every window and each ACTIVE session re-offers its base
 * (`offerBase` → un-addressed SNAPSHOT_OFFER; active peers merge, buffering
 * peers adopt — loro dedupes, so the offer subsumes whatever the outage
 * dropped). No teardown, no world reset, no UI flash.
 *
 * Run `pnpm --filter widgetlab-desktop start` for a local production build, or
 * `pnpm --filter widgetlab-desktop dev` for one-command renderer HMR. Cmd/Ctrl+N
 * opens another window in the same room — a second collaborator, no network involved. With a tailnet
 * auth key in .env (TS_AUTHKEY), other machines running this app join the same
 * room over the truffle mesh (mesh.mjs) — no server anywhere.
 */
import { app, BrowserWindow, Menu, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { loadDotEnv, startMesh } from "./mesh.mjs";

/** An explicit renderer dev-server override; production uses the bundled local build. */
const RENDERER_DEV_URL = process.env.ICE_URL?.trim() || null;
/** Every window of this instance joins one room (multi-room needs no more than a param later). */
const ROOM = process.env.ICE_ROOM ?? "widgetlab";
/** Test knobs (the smoke harness): open N windows at launch. */
const WINDOWS = Math.max(1, Number(process.env.ICE_WINDOWS ?? "1") || 1);
/** Opt out of tailnet startup for deterministic local development and tests. */
const MESH_ENABLED = process.env.ICE_MESH !== "off";
/** Opt-in renderer diagnostics for the real Electron smoke harness. */
const RENDERER_DEBUG = process.env.ICE_RENDERER_DEBUG === "1";
/** How long a fresh instance waits for a mesh link before opening windows anyway (see meshHold). */
const LINK_GRACE_MS = 8_000;
/**
 * HTML-in-Canvas, the composited profile's platform requirement (design-012
 * §3). Blink runtime feature `CanvasDrawElement` is status:"test": compiled
 * into this Electron's Chromium but OFF by default, and origin-trial tokens
 * cannot be redeemed by a `file://` app — so these switches are the ONLY path,
 * and they must run before `app.whenReady()`.
 *
 * `ICE_HIC=off` is a TEST KNOB, not a fallback: it exists so the boot-time
 * refusal (§11 Q2 — a probe failure is loud, never a silent swap to the
 * stratified profile) can be witnessed on a host that would otherwise pass.
 */
const HIC_ENABLED = process.env.ICE_HIC !== "off";

// BEFORE ready, at module scope: command-line switches appended after Chromium
// has started reading them are ignored silently.
if (HIC_ENABLED) {
  app.commandLine.appendSwitch("enable-features", "CanvasDrawElement");
  app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");
}

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(srcDir, "..");
const preloadPath = path.join(srcDir, "preload.cjs");
const rendererEntry = path.join(appDir, "dist", "index.html");

/**
 * The switchboard's whole memory: webContents.id → membership. Entries live
 * exactly as long as the window's channel — added on `ice:join`, dropped on
 * `ice:leave`/destroy. No document state.
 * @type {Map<number, { room: string, wc: Electron.WebContents }>}
 */
const members = new Map();
/** The mesh surface (mesh.mjs), or null while starting / when running local-only. */
let mesh = null;

const count = (room) => [...members.values()].filter((m) => m.room === room).length;

/**
 * ICE frame-kind byte (bootstrap.ts's 1-byte tag) → mesh delivery lane. The
 * mapping mirrors @ice/core's delivery classes: presence is latest-lossy,
 * snapshots are bulk-reliable-on-their-own-stream, everything else rides the
 * ordered durable lane. Unknown kinds default to durable (toward MORE
 * reliability, never less).
 */
function laneOf(bytes) {
  const k = bytes[0];
  if (k === 5) return "ephemeral";
  if (k === 2 || k === 3) return "snapshot";
  return "durable";
}

/** Deliver one frame to local members of `room`; never to `exceptWcId`. */
function deliverLocal(room, bytes, exceptWcId) {
  for (const m of members.values()) {
    if (m.wc.id === exceptWcId || m.room !== room) continue;
    if (!m.wc.isDestroyed()) m.wc.send("ice:msg", bytes);
  }
}

ipcMain.on("ice:join", (event, room) => {
  if (typeof room !== "string") return;
  members.set(event.sender.id, { room, wc: event.sender });
  event.sender.send("ice:open");
  console.log(`[widgetlab-desktop] + join  room="${room}" (${count(room)} in room)`);
});

const leave = (wcId, why) => {
  const m = members.get(wcId);
  if (m === undefined) return;
  members.delete(wcId);
  console.log(`[widgetlab-desktop] - leave room="${m.room}" (${why}; ${count(m.room)} left)`);
};
ipcMain.on("ice:leave", (event) => leave(event.sender.id, "left"));

ipcMain.on("ice:post", (event, bytes) => {
  const m = members.get(event.sender.id);
  if (m === undefined || !(bytes instanceof Uint8Array) || bytes.length === 0) return;
  deliverLocal(m.room, bytes, event.sender.id);
  // The mesh sees every local frame (flood; ICE's in-frame addressing makes
  // that correct — just wasteful for an addressed SNAPSHOT, accepted at demo
  // scale). `kind` picks the delivery lane; the payload stays opaque.
  mesh?.post({ room: m.room, kind: laneOf(bytes) }, bytes);
});

/** Mesh inbound: deliver to local windows only — NEVER re-forward (one-hop). */
function onMeshFrame(header, payload) {
  const { room, kind } = header;
  if (typeof room !== "string" || typeof kind !== "string") return;
  if (kind !== "durable" && kind !== "ephemeral" && kind !== "snapshot") return;
  if (payload === undefined || payload.length === 0) return;
  // Electron structured-clones Buffer → Uint8Array across wc.send; normalize
  // here so every window sees the same shape the preload contract promises.
  deliverLocal(room, new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), -1);
}

/**
 * The link-flap repair (see header): a link coming UP may follow an outage that
 * dropped frames only a base re-offer can repair. Debounced — N links settling
 * at once is ONE resync sweep, not N. Down-events need no sweep of their own
 * (nothing to repair toward a dead link; the redial's up-event triggers one).
 */
let resyncTimer = null;
function scheduleResync(why) {
  if (resyncTimer !== null) clearTimeout(resyncTimer);
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    console.log(`[widgetlab-desktop] resync ${members.size} window(s): ${why}`);
    for (const m of members.values()) if (!m.wc.isDestroyed()) m.wc.send("ice:resync");
  }, 300);
}

/** Resolvers waiting on the first link (meshHold). */
const linkWaiters = new Set();

async function startMeshBridge() {
  if (!MESH_ENABLED) {
    console.log("[widgetlab-desktop] mesh disabled by ICE_MESH=off (local-only)");
    return;
  }
  // Config precedence (lowest→highest): the dev .env beside the app, then the
  // user's .env in userData, then real env vars.
  const env = {
    ...loadDotEnv(path.join(srcDir, "..")),
    ...loadDotEnv(app.getPath("userData")),
    ...process.env,
  };
  const stateDir = process.env.ICE_STATE_DIR ?? path.join(app.getPath("userData"), "tsnet");
  try {
    const api = await startMesh({
      authKey: env.TS_AUTHKEY,
      stateDir,
      deviceName: process.env.ICE_DEVICE_NAME ?? `${os.hostname()}-widgetlab`,
      openUrl: (url) => void shell.openExternal(url),
      log: (msg) => console.log(`[mesh] ${msg}`),
      onFrame: onMeshFrame,
      onLinkChange: (kind, peerId) => {
        if (kind === "up") {
          for (const w of linkWaiters) w();
          scheduleResync(`link up (${peerId.slice(0, 8)}…)`);
        }
      },
    });
    mesh = api;
  } catch (err) {
    console.warn(`[widgetlab-desktop] mesh disabled (local-only): ${err.message}`);
  }
}

/**
 * Hold the first window until the mesh has met its peers — a window that hellos
 * BEFORE the link is up sees an empty room, seeds its own genesis, and the two
 * geneses cannot cleanly merge on contact (the split-seed race; @ice/core's
 * bootstrap declares the simultaneous-cold-start tie-break out of scope, so the
 * shell's job is to make it rare). Sequential starts resolve cleanly: no online
 * peers → open immediately; peers exist → wait for the first link (or the
 * grace cap, for ghost peers).
 */
async function meshHold(meshStart) {
  const started = await Promise.race([meshStart, new Promise((r) => setTimeout(() => r("timeout"), 15_000))]);
  if (started === "timeout") {
    console.warn("[widgetlab-desktop] mesh still starting after 15s — opening local-only (resync repairs later)");
    return;
  }
  if (mesh === null || mesh.linkCount() > 0) return;
  const peers = (await mesh.onlinePeers()).length;
  if (peers === 0) return; // nobody out there — we are the first instance; seed away
  console.log(`[widgetlab-desktop] ${peers} instance(s) on the tailnet — waiting for a link (≤${LINK_GRACE_MS / 1000}s)…`);
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      linkWaiters.delete(resolve);
      resolve();
    }, LINK_GRACE_MS);
    linkWaiters.add(() => {
      clearTimeout(timer);
      linkWaiters.delete(resolve);
      resolve();
    });
  });
}

/** Cascade offset per window so a multi-window launch never fully stacks. */
let windowIndex = 0;

async function loadRenderer(win) {
  const query = new URLSearchParams({ collab: ROOM });
  if (RENDERER_DEBUG) query.set("rendererDebug", "1");
  if (RENDERER_DEV_URL !== null) {
    await win.loadURL(`${RENDERER_DEV_URL.replace(/\/$/, "")}/?${query}`);
    return;
  }
  await win.loadFile(rendererEntry, { search: query.toString() });
}

function createWindow() {
  const i = windowIndex++;
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    x: 80 + (i % 6) * 48,
    y: 80 + (i % 6) * 40,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Per-window half of the CanvasDrawElement enablement: the command-line
      // switches above turn the feature on for the process, this exposes the
      // Blink runtime feature to THIS window's script context. Both are
      // required — `experimentalFeatures: true` does NOT enable it.
      ...(HIC_ENABLED ? { enableBlinkFeatures: "CanvasDrawElement" } : {}),
      // A fully-occluded Electron window reports `visibilityState: "hidden"` and
      // Chromium FREEZES its rAF loop — which is the engine's tick, so a covered
      // collaborator stops flushing presence AND stops applying inbound sync
      // (canvas-desktop's P1 smoke found this: two stacked windows, peers stuck).
      // A collab window must keep syncing while covered.
      backgroundThrottling: false,
    },
  });
  win.webContents.once("destroyed", () => leave(win.webContents.id, "window destroyed"));
  void loadRenderer(win).catch(() => {
    const source = RENDERER_DEV_URL ?? rendererEntry;
    const hint = RENDERER_DEV_URL === null
      ? "Build the bundled renderer with <code>pnpm --filter widgetlab-desktop build</code>, then reload with Cmd/Ctrl+R."
      : "Start <code>pnpm --filter widgetlab-desktop dev:renderer</code>, then reload with Cmd/Ctrl+R.";
    const msg = `widgetlab-desktop could not load its renderer from ${source}.<br/>${hint}`;
    void win.loadURL(`data:text/html,<body style="font:16px system-ui;padding:2rem">${encodeURIComponent(msg)}</body>`);
  });
  return win;
}

const meshStart = app.whenReady().then(startMeshBridge);

app.whenReady().then(async () => {
  // Minimal menu: the default roles plus the one desktop-specific verb —
  // another window = another collaborator in the room.
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Collaborator Window", accelerator: "CmdOrCtrl+N", click: () => void createWindow() },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  const hicPosture = HIC_ENABLED ? "ON" : "OFF (ICE_HIC=off)";
  console.log(
    `[widgetlab-desktop] CanvasDrawElement switches ${hicPosture} — the renderer's own probe decides whether the composited build boots`,
  );
  await meshHold(meshStart);
  createWindow();
  // STAGGERED, not simultaneous: two windows booting inside the same ~800ms
  // hello window both see an empty room, both time out, and both SEED — two
  // divergent geneses. Humans opening Cmd+N windows stagger naturally; a
  // launch loop must do it deliberately (2.5s clears hello + seed + answer).
  for (let i = 1; i < WINDOWS; i++) setTimeout(() => void createWindow(), i * 2500);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// The tsnet node is EPHEMERAL — stopping it removes this instance from the
// tailnet. Do it on the way out (best-effort, capped: quit must not hang on a
// wedged sidecar).
let meshStopped = false;
app.on("will-quit", (event) => {
  if (meshStopped || mesh === null) return;
  event.preventDefault();
  meshStopped = true;
  void Promise.race([mesh.stop(), new Promise((r) => setTimeout(r, 3_000))]).finally(() => app.quit());
});
