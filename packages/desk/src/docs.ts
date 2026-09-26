// THE DOCUMENT'S DOORS (D7 #1 · #2 · #9; D-D7-A.3): what a desk driver holds of the facade's `engine.docs`. One module, no
// kind in it, so the host wires a document into every kind's drivers without naming one — and every write surface asks the
// same gate. `current()` is the session (store + live writer + the gate's verdict); `writable()` is THE WRITER'S GATE;
// `extendCommits` is the door into a gesture's own transaction; `undo`/`redo` are the facade's history (historyStep: the tween
// retarget, the read-only posture). A bare store (a test's) has the first and none of the rest.

import { type CommitExtender, type DocSession, gateVerdict } from "@ice/core";

/** The document a driver writes into — the facade's `engine.docs` (its `current()` session: store + live writer + the gate's verdict). */
export interface TypingDocs {
  current(): Pick<DocSession, "store" | "liveWriter" | "readOnly" | "versionReport"> | undefined;
  /** The facade's door into a gesture's own transaction (`docs.extendCommits`, D7 #2): a landing's writes in the gesture's undo step. Absent (a bare store), a driver has no such door. */
  extendCommits?(extend: CommitExtender): () => void;
  /** The facade's history doors (`docs.undo`/`docs.redo` — historyStep: the tween retarget, the read-only posture; D7 #9). Absent (a bare store), a driver moves no history. */
  undo?(): boolean;
  redo?(): boolean;
}

/** What a desk writer holds while it commits: the session's store and live writer. */
export type WritableSession = Pick<DocSession, "store" | "liveWriter">;

/**
 * THE WRITER'S GATE (D7 #1): the session a desk gesture may commit into — none without a document, and none when the
 * version gate's verdict is read-only (a doc a newer build wrote, a pack this build does not compile, a root that does not
 * agree). `readOnly` is the verdict at open; the report is asked again because a peer's pack can move it after. This is
 * the facade's `requireWritable` law at the desk's own write surfaces: strata's store has no read-only mode, and every desk
 * writer commits through it directly (guardedTransaction, setWidgetProps), never through the doc kit's commit sink, so a
 * gate that lived only in the sink never reached them. A refused writer does what "no document" means to it: nothing lands.
 */
export function writable(docs: TypingDocs): WritableSession | undefined {
  const s = docs.current();
  return s === undefined || s.readOnly || gateVerdict(s.versionReport()) !== "ok" ? undefined : s;
}

/** No document at all: the runtime is all there is (a desk without a facade, a catalog harness). */
export const NO_DOCS: TypingDocs = { current: () => undefined };
