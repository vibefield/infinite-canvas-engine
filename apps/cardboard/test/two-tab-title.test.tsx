/**
 * M6 exit criterion (b): a title edited THROUGH the card's <input> commits to the
 * durable doc and relays across tabs. Two full rigs (each its own world + doc
 * session) are wired by the M5 snapshot relay over an injected synchronous
 * channel pair (as in graybox's two-tab test). Tab A types + commits; tab B —
 * which never touched the input — converges to the new title.
 */
import { type RelayChannel, attachBroadcastRelay, spawnWidget } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { makeRig } from "./rig";
import "../src/todo-card";

/** Two endpoints on one bus; a post delivers to the OTHER only, synchronously. */
function channelPair(): { a: RelayChannel; b: RelayChannel } {
  const la = new Set<(ev: { data: unknown }) => void>();
  const lb = new Set<(ev: { data: unknown }) => void>();
  const make = (
    own: Set<(ev: { data: unknown }) => void>,
    peer: Set<(ev: { data: unknown }) => void>,
  ): RelayChannel => ({
    postMessage: (m) => {
      for (const l of [...peer]) l({ data: m });
    },
    addEventListener: (_t, l) => own.add(l),
    removeEventListener: (_t, l) => own.delete(l),
    close: () => own.clear(),
  });
  return { a: make(la, lb), b: make(lb, la) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("card-board M6 exit (b): title edit commits + relays across tabs", () => {
  it("types + Enter on tab A commits the title; tab B (own world) converges", () => {
    const chan = channelPair();
    const a = makeRig();
    const b = makeRig();
    attachBroadcastRelay(a.session, { channelName: "ice-cardboard", channel: chan.a });
    attachBroadcastRelay(b.session, { channelName: "ice-cardboard", channel: chan.b });

    // Card on A; the spawn commit relays to B.
    spawnWidget(a.session.store, a.world, "todo-card", { x: 120, y: 120, props: { title: "Todo" } });
    a.step(4);
    a.render();
    a.step();
    b.step(4);
    b.render();
    b.step();

    expect(a.title()?.value).toBe("Todo");
    expect(b.title()?.value).toBe("Todo"); // spawn already synced to B

    // Edit A's title THROUGH the input: type (onChange → draft), Enter (commit).
    const inputA = a.title() as HTMLInputElement;
    inputA.value = "Groceries";
    a.fireReact(inputA, "input"); // onChange reads currentTarget.value → setDraft
    a.fireReact(inputA, "keydown", { key: "Enter" }); // onKeyDown → commit + blur

    a.step(); // project A's own commit
    b.step(); // project the relayed commit on B

    expect(a.title()?.value).toBe("Groceries"); // A shows its edit (draft cleared → doc value)
    expect(b.title()?.value).toBe("Groceries"); // B converged via the relay
  });
});
