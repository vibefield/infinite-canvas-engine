/**
 * The tailnet mesh bridge — truffle/tsnet link manager that makes OTHER widgetlab-desktop instances
 * room members. This process's switchboard (main.mjs) stays the only router; this module owns exactly
 * the byte-moving between instances, one lane per delivery class:
 *
 *   durable / hello / snapshot (reliable-ordered) → raw QUIC, per peer link:
 *     - ONE long-lived "durable" stream: all rooms multiplexed, per-sender order preserved
 *       end-to-end by FIFO composition (window IPC → this stream → remote window IPC).
 *     - snapshots each ride a SHORT-LIVED stream of their own: a 1-2MB bootstrap must not
 *       head-of-line-block live increments (the observer stall measured in plan-transport).
 *       Out-of-lane arrival is safe: snapshots are `to`-addressed and joiners buffer pre-bootstrap.
 *   ephemeral (latest-lossy) → UDP datagrams, one frame per datagram, ≤ ~1,200B (tailnet MTU);
 *     oversize falls back to the durable stream (degradation is always toward MORE reliability —
 *     transport.ts). No hub-side coalescing: the renderer's ephemeral binding already throttles.
 *
 * In THIS app the header is `{ room, kind }` where kind ∈ "durable" | "snapshot" | "ephemeral" (the
 * hub maps ICE's 1-byte frame kinds to a delivery lane); payloads are opaque ICE bootstrap frames.
 *
 * Topology: full mesh, one QUIC connection per instance pair; the LOWER tailscaleId dials (they sort).
 * Discovery is truffle's: appId-scoped peers + onPeerChange. truffle does NO forwarding — every
 * instance links to every other; frames are never re-forwarded (one-hop, loop-free by construction).
 *
 * Reliability boundary: truffle raw streams have no replay — anything in flight when a link drops is
 * GONE. The flap policy is therefore the 006 §A4 one, applied by main.mjs: any link up/down bounces
 * the local windows' lifecycle (close → open(reconnect)) and the app-level bootstrap re-converges.
 * ALPN scopes connections to this appId; inbound UDP is additionally gated on the rinfo peer
 * identity (WireGuard-authenticated source IP → known-peer check). Raw TCP/QUIC listeners are
 * app-unauthenticated beyond ALPN by design (RFC 021 §9) — tailnet ACLs are the perimeter.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chunk, createChunker, decodeFrame, encodeFrame } from "./frames.mjs";

const APP_ID = "ice-collab";
const QUIC_PORT = 9440; // 443 + 9417 are truffle-reserved; QUIC listeners cannot use port 0
const UDP_PORT = 9441;
const PROTOCOL_V = 1;
const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Above this, an ephemeral frame would fragment on the tailnet (~1280 MTU) — reroute reliably. */
const UDP_MAX_FRAME = 1_150;
/** UDP keepalive per link — the sidecar reaps idle relayed conns at 10 min; stay far under it. */
const UDP_HEARTBEAT_MS = 60_000;
const REDIAL_BASE_MS = 1_000;
const REDIAL_CAP_MS = 30_000;

/** Parse KEY=VALUE lines from this example's .env (no dotenv dep for one key). */
export function loadDotEnv(dir) {
  try {
    const text = readFileSync(path.join(dir, ".env"), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Start the mesh bridge. Resolves once the tsnet node is Running (first run may open a browser for
 * Tailscale auth unless `authKey` is provided). Returns the surface main.mjs wires the switchboard to.
 *
 * @param {{
 *   authKey?: string, stateDir: string, deviceName: string,
 *   sidecarPath?: string,
 *   openUrl?: (url: string) => void,
 *   log: (msg: string) => void,
 *   onFrame: (header: object, payload: Buffer | undefined, fromPeer: string) => void,
 *   onLinkChange: (kind: "up" | "down", peerId: string) => void,
 * }} opts
 */
export async function startMesh(opts) {
  const { createMeshNode } = await import("@vibecook/truffle");
  const { authKey, stateDir, deviceName, openUrl, log, onFrame, onLinkChange } = opts;

  /** @type {Map<string, Link>} live links by remote tailscaleId (handshake completed) */
  const links = new Map();
  /** @type {Map<string, {timer: any, delay: number}>} pending redials by remote tailscaleId */
  const redials = new Map();
  let stopped = false;

  const mesh = await createMeshNode({
    appId: APP_ID,
    deviceName,
    stateDir,
    authKey,
    sidecarPath: opts.sidecarPath, // test knob: a locally built sidecar (undefined = auto-resolve)
    ephemeral: true, // a closed app must leave the tailnet, not accumulate ghost nodes
    openUrl,
    onAuthRequired: (url) => log(`tailscale auth required → ${url}`),
    onPeerChange: (ev) => {
      if (stopped) return;
      // RFC 022 (0.6.0): the discriminant is `ev.type` (was `eventType`), and `ev.peerId` is the
      // peer's TAILSCALE routing key — the key our links are keyed by — carried directly on the
      // event (empty only for auth events). `ev.peer` is the interned handle, present for every
      // peer-scoped event including `left` (its final offline view). Never key link teardown on
      // `ev.peer.deviceId`: that is the honest ULID (null pre-hello) and a different id space.
      log(`peer ${ev.type}: ${ev.peer?.displayName ?? ev.peerId}`);
      if (ev.type === "joined" || ev.type === "updated") void maybeDial(ev.peer);
      if (ev.type === "left" && ev.peerId) dropLink(ev.peerId, "peer left");
    },
  });
  const me = mesh.getLocalInfo();
  // The canonical mesh identity is the TAILSCALE node id (Peer.tailscaleId), never truffle's ULID
  // Peer.deviceId. Under RFC 022 (truffle 0.6.0) deviceId is an HONEST ULID-or-null: it is null
  // until a peer's hello is seen and NEVER falls back to the tailscale id, so it cannot key links
  // that must exist before identity is learned. tailscaleId is always present and is truffle's
  // routing/identity key for raw transports (QUIC/UDP). Dial direction, link keys, handshakes, and
  // UDP gating therefore all live in the one tailscale-id space.
  const myId = me.tailscaleId;
  /** @type {Map<string, string>} link tailscaleId → tailnet 100.x IP (UDP addressing + inbound gate) */
  const linkIps = new Map();
  const peerIdOf = (peer) => peer?.tailscaleId;
  log(`mesh up: ${me.deviceName} (${myId.slice(0, 8)}…) ip=${me.ip ?? "?"}`);

  // Initial sweep — peers already in the netmap at startup may never emit a `joined` event, and a
  // pair that starts simultaneously can race event delivery; the redial loop only covers links that
  // EXISTED. Sweep now and once more shortly after (netmap propagation on a fresh node is eventual).
  const sweep = async () => {
    try {
      for (const p of await mesh.getPeers()) void maybeDial(p);
    } catch {
      /* node stopping */
    }
  };
  void sweep();
  setTimeout(() => void sweep(), 5_000).unref?.();
  const resweeper = setInterval(() => {
    if (links.size === 0) void sweep(); // linkless but peers may exist — keep trying (cheap)
  }, 15_000);
  resweeper.unref?.();

  // ---------------------------------------------------------------- QUIC (reliable-ordered lanes)

  /**
   * A live peer link. `durable` is the long-lived stream; `conn` also carries per-snapshot streams.
   * `peerId` is the remote tailscaleId (the link key). `peer` is the interned RFC 022 Peer handle
   * when known — held so UDP sends can address by handle (generation-checked routing) rather than by
   * a bare tailscale-id string, which is no longer a documented query form. `ip` is the peer's tailnet
   * 100.x when resolved (the zero-lookup UDP fast path).
   * @typedef {{ peerId: string, conn: any, durable: any, ip?: string, peer?: object, sendFrame: (f: Buffer) => void }} Link
   */

  /** Wire a durable stream: outbound writes + inbound chunked frame pump feeding the switchboard. */
  function wireDurable(link, stream) {
    const pump = createChunker(
      (frame) => {
        const decoded = decodeFrame(frame);
        if (decoded === null) return teardown("malformed frame on durable stream");
        onFrame(decoded.header, decoded.payload, link.peerId);
      },
      (why) => teardown(why),
    );
    const teardown = (why) => dropLink(link.peerId, why);
    stream.on("data", pump);
    stream.on("error", (err) => teardown(`durable stream error: ${err.message}`));
    stream.on("close", () => teardown("durable stream closed"));
    link.sendFrame = (frame) => {
      // Duplex write with no drain handling ON PURPOSE for the MVP: editor-scale rooms produce
      // increments far below QUIC flow-control limits; a stalled peer eventually errors the stream
      // and the flap policy re-bootstraps. (P3 measures whether backpressure handling is needed.)
      try {
        stream.write(chunk(frame));
      } catch (err) {
        teardown(`durable write failed: ${err.message}`);
      }
    };
  }

  /** Accept-side stream demux: the first frame on any stream declares its lane. */
  function handleAcceptedStream(conn, stream, connPeer) {
    let lane = null;
    const pump = createChunker(
      (frame) => {
        const decoded = decodeFrame(frame);
        if (decoded === null) {
          stream.destroy();
          return;
        }
        if (lane === null) {
          lane = decoded.header.lane;
          if (lane === "durable") {
            // Inbound handshake — the dialer's hello. Reply with ours on the same stream, then the
            // stream IS the link's durable lane. The wire field is named `deviceId` for compat but
            // carries the sender's TAILSCALE id (the mesh routing/identity key), not truffle's ULID.
            const peerId = decoded.header.deviceId;
            if (decoded.header.v !== PROTOCOL_V || typeof peerId !== "string") {
              log(`rejecting link: bad handshake (v=${decoded.header.v})`);
              conn.close?.();
              return;
            }
            connPeer.id = peerId;
            stream.off("data", pump); // wireDurable installs its own pump
            // No Peer handle at accept/handshake time; adoptLink's lazy netmap resolve stashes one.
            const link = { peerId, conn, durable: stream, ip: undefined, peer: undefined, sendFrame: () => {} };
            wireDurable(link, stream);
            // `deviceId` here is OUR tailscale id (myId), same wire-compat naming as above.
            stream.write(chunk(encodeFrame({ lane: "durable", v: PROTOCOL_V, deviceId: myId })));
            adoptLink(link, "accepted");
          }
          return; // snapshot lane: tag consumed, payload frames follow
        }
        if (lane === "snapshot") {
          const peerId = connPeer.id;
          if (peerId === undefined) return; // snapshot before handshake — drop
          onFrame(decoded.header, decoded.payload, peerId);
        }
      },
      () => stream.destroy(),
    );
    stream.on("data", pump);
    stream.on("error", () => {});
  }

  /** Both sides accept streams forever (either end opens snapshot streams; accepters get durable). */
  function acceptStreams(conn, connPeer) {
    void (async () => {
      try {
        for (;;) {
          const stream = await conn.acceptStream();
          if (stream === null) return;
          handleAcceptedStream(conn, stream, connPeer);
        }
      } catch {
        /* connection died — the durable stream teardown owns link cleanup */
      }
    })();
  }

  function adoptLink(link, how) {
    const existing = links.get(link.peerId);
    if (existing !== undefined) {
      // Simultaneous dial crossing (both sides raced a connection): deterministic winner — keep the
      // one the LOWER tailscaleId dialed, i.e. accept the replacement only from the canonical dialer.
      log(`duplicate link to ${link.peerId.slice(0, 8)}… (${how}); keeping existing`);
      try {
        link.conn.close?.();
      } catch {
        /* already closing */
      }
      return;
    }
    links.set(link.peerId, link);
    redials.delete(link.peerId);
    // The UDP lane needs the peer's tailnet IP (addressing out, gating in) and its Peer handle (the
    // resolvable UDP fallback when the IP isn't known yet). The dial side knows both from the peer
    // object; the accept side resolves them from the netmap — best-effort, the durable lane is fully
    // usable meanwhile. `peer.ip` is a non-optional string in 0.6.0 (empty until L3 has an address),
    // so gate on truthiness, not `!== undefined`; online peers always carry a real 100.x.
    if (link.ip !== undefined) linkIps.set(link.peerId, link.ip);
    else
      void (async () => {
        try {
          const peer = (await mesh.getPeers()).find((p) => peerIdOf(p) === link.peerId);
          if (peer !== undefined && links.get(link.peerId) === link) {
            link.peer = peer; // stash the handle even if the IP isn't populated yet
            if (peer.ip) {
              link.ip = peer.ip;
              linkIps.set(link.peerId, peer.ip);
            }
          }
        } catch {
          /* node stopping */
        }
      })();
    log(`link UP ${link.peerId.slice(0, 8)}… (${how}; ${links.size} link${links.size === 1 ? "" : "s"})`);
    onLinkChange("up", link.peerId);
  }

  function dropLink(peerId, why) {
    const link = links.get(peerId);
    if (link === undefined) return;
    links.delete(peerId);
    linkIps.delete(peerId);
    try {
      link.conn.close?.();
    } catch {
      /* already closing */
    }
    log(`link DOWN ${peerId.slice(0, 8)}… (${why}; ${links.size} left)`);
    onLinkChange("down", peerId);
    scheduleRedial(peerId);
  }

  /** I dial peers my node id sorts BELOW (one canonical dialer per pair; ids compare as strings). */
  async function maybeDial(peer) {
    const peerId = peerIdOf(peer);
    if (stopped || peerId === undefined) return;
    if (!(myId < peerId) || links.has(peerId) || !peer.online) return;
    try {
      // Dial with the Peer HANDLE, not a tailscale-id string: the handle is generation-checked (a
      // stale handle — peer left/rejoined — rejects with PeerGone, caught below → scheduleRedial)
      // and routes by the WhoIs-authenticated tailscale key. peer.online usually means peer.ip is a
      // real 100.x, but 0.6.0 types it as a REQUIRED string that is EMPTY until L3 has an address —
      // `|| undefined` enforces the link.ip ∈ {non-empty, undefined} invariant udpAddr's `??` needs
      // (the accept side's lazy resolve gates the same way).
      const conn = await mesh.quic.connect(peer, QUIC_PORT);
      const durable = await conn.openStream();
      const connPeer = { id: peerId };
      const link = { peerId, conn, durable, ip: peer.ip || undefined, peer, sendFrame: () => {} };

      // Handshake: our hello, then their reply is the FIRST frame back on this stream.
      const replied = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("handshake timeout")), HANDSHAKE_TIMEOUT_MS);
        const pump = createChunker(
          (frame) => {
            clearTimeout(timer);
            durable.off("data", pump);
            resolve(frame);
          },
          (why) => reject(new Error(why)),
        );
        durable.on("data", pump);
        durable.once("error", (err) => reject(err));
      });
      // Wire field `deviceId` carries OUR tailscale id (myId) — the mesh identity key, not truffle's
      // ULID; the name is kept only for wire compat with the accept side.
      durable.write(chunk(encodeFrame({ lane: "durable", v: PROTOCOL_V, deviceId: myId })));
      const reply = decodeFrame(await replied);
      if (reply === null || reply.header.lane !== "durable" || reply.header.v !== PROTOCOL_V)
        throw new Error("bad handshake reply");

      wireDurable(link, durable);
      acceptStreams(conn, connPeer);
      adoptLink(link, "dialed");
    } catch (err) {
      log(`dial ${peerId.slice(0, 8)}… failed: ${err.message}`);
      scheduleRedial(peerId);
    }
  }

  function scheduleRedial(peerId) {
    if (stopped || !(myId < peerId)) return; // only the canonical dialer redials
    const prev = redials.get(peerId);
    const delay = Math.min(prev?.delay !== undefined ? prev.delay * 2 : REDIAL_BASE_MS, REDIAL_CAP_MS);
    if (prev?.timer !== undefined) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      redials.delete(peerId);
      void (async () => {
        const peer = (await mesh.getPeers()).find((p) => peerIdOf(p) === peerId);
        if (peer !== undefined) void maybeDial(peer);
      })();
    }, delay);
    timer.unref?.();
    redials.set(peerId, { timer, delay });
  }

  const quicServer = await mesh.quic.listen(QUIC_PORT);
  void (async () => {
    for (;;) {
      const conn = await quicServer.accept();
      if (conn === null) return; // server closed
      acceptStreams(conn, { id: undefined });
    }
  })();

  // ------------------------------------------------------------------- UDP (latest-lossy lane)

  const udp = mesh.dgram.createSocket();
  udp.on("message", (msg, rinfo) => {
    // WireGuard authenticated the source IP; gate on it mapping to a LINKED peer — raw UDP has no
    // ALPN, so this is the app-scoping equivalent (plus: no link, no bootstrap, no business here).
    // In 0.6.0 rinfo.peerId spans TWO id spaces (dgram fills it `deviceId ?? tailscaleId`): before
    // the sender's identity is learned it is the tailscale id and matches a link key directly; once
    // eager identity lands it becomes the ULID, which never matches a link key — the linkIps address
    // index (WireGuard-authenticated source IP → link) covers that case AND cold-cache lag, so both
    // the pre-identity fast path and the post-identity ULID resolve to the right link.
    const fromPeer =
      rinfo.peerId !== undefined && links.has(rinfo.peerId)
        ? rinfo.peerId
        : [...linkIps.entries()].find(([, ip]) => ip === rinfo.address)?.[0];
    if (fromPeer === undefined) return;
    const decoded = decodeFrame(Buffer.from(msg));
    if (decoded === null || decoded.header.lane === "hb") return;
    onFrame(decoded.header, decoded.payload, fromPeer);
  });
  udp.on("error", (err) => log(`udp error: ${err.message}`));
  await udp.bind(UDP_PORT);

  /**
   * UDP addressing: the 100.x IP when known (zero lookup), else the Peer handle (resolvable,
   * generation-checked). A bare tailscale-id string is no longer a documented dgram query form, so
   * we never fall back to link.peerId. Returns undefined when neither is known yet (accept-side link
   * before the lazy resolve lands) — callers SKIP that link (ephemeral is latest-lossy; the durable
   * lane is unaffected). `link.ip` is only ever a non-empty string or undefined, so `??` is correct.
   */
  const udpAddr = (link) => link.ip ?? link.peer;

  const heartbeat = setInterval(() => {
    const hb = encodeFrame({ lane: "hb", deviceId: myId });
    for (const link of links.values()) {
      const addr = udpAddr(link);
      if (addr !== undefined) udp.send(hb, UDP_PORT, addr, () => {});
    }
  }, UDP_HEARTBEAT_MS);
  heartbeat.unref?.();

  // ------------------------------------------------------------------------------- the surface

  return {
    info: me,
    linkCount: () => links.size,
    /** Online tailnet peers of this app (ephemeral nodes ≈ running instances) — meshHold's input. */
    onlinePeers: async () => (await mesh.getPeers()).filter((p) => p.online),
    /**
     * Ship one already-headered frame ({room, kind, from, to?}) to the mesh. `toLink` (a link key,
     * i.e. a remote tailscaleId) narrows an addressed frame to the link that owns its target —
     * main.mjs learns the mapping from inbound frames; undefined floods every link (correct, just
     * wasteful for snapshots).
     */
    post(header, payload, toLink) {
      const frame = encodeFrame(header, payload);
      const targets = toLink !== undefined && links.has(toLink) ? [links.get(toLink)] : [...links.values()];
      if (header.kind === "ephemeral" && frame.length <= UDP_MAX_FRAME) {
        for (const link of targets) {
          const addr = udpAddr(link);
          if (addr !== undefined) udp.send(frame, UDP_PORT, addr, () => {});
        }
        return;
      }
      if (header.kind === "snapshot") {
        // Own stream per transfer: open, tag, ship, finish — never queued behind (or in front of)
        // the durable lane. Failure is survivable: the joiner's hello retry machinery re-asks.
        for (const link of targets) {
          void (async () => {
            try {
              const stream = await link.conn.openStream();
              stream.write(chunk(encodeFrame({ lane: "snapshot" })));
              stream.write(chunk(frame));
              stream.end();
            } catch (err) {
              log(`snapshot stream to ${link.peerId.slice(0, 8)}… failed: ${err.message}`);
            }
          })();
        }
        return;
      }
      // durable + hello + oversize-ephemeral: the reliable-ordered lane.
      for (const link of targets) link.sendFrame(frame);
    },
    async stop() {
      stopped = true;
      clearInterval(heartbeat);
      clearInterval(resweeper);
      for (const r of redials.values()) clearTimeout(r.timer);
      redials.clear();
      for (const peerId of [...links.keys()]) {
        const link = links.get(peerId);
        links.delete(peerId);
        try {
          link?.conn.close?.();
        } catch {
          /* closing */
        }
      }
      udp.close();
      await mesh.stop();
    },
  };
}
