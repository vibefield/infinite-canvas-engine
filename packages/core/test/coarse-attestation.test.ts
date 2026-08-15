/**
 * The `coarse: false` attestation, enforced (design-009 §5.2; the M13 post-v1
 * risk the plan names in as many words).
 *
 * Every `ChangeCollector` in this engine is created `coarse: false`. That flag
 * is not a local tuning knob — it is an ENGINE-WIDE PROMISE that no raw
 * `batch.col()` write ever touches a component some collector subscribes to.
 * strata cannot verify it: the declared-`access.write` blanket is conservative
 * by construction and cannot tell a system that wrote through the exact
 * chokepoints from one that poked a column, so opting out of `coarse` is ICE
 * asserting something about ICE.
 *
 * What breaks if the promise lapses is invisible and expensive. A raw column
 * write to a behavior-read component would simply never be journaled — every
 * behavior reading it silently stops waking, no error, no warning, on someone
 * else's machine. And a single collector that FORGETS the flag drowns in
 * `coarse` records instead: full rescan, every frame, which is the exact walk
 * collectors exist to retire.
 *
 * So both halves are checked as source facts, because there is nowhere else to
 * check them. This is a lint wearing a test's clothes, deliberately: the rule
 * is about code that does not exist yet.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src", import.meta.url).pathname;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** Strip line and block comments — prose about `col()` is not a call to it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FILES = sources(SRC).map((path) => ({
  path,
  rel: path.slice(SRC.length + 1),
  body: readFileSync(path, "utf8"),
}));

describe("the coarse:false attestation", () => {
  it("is made by EVERY collector this engine creates", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const body = code(f.body);
      // `world.changes.collect({…})` and the `makeChurnGuard(world, {…})` idiom
      // both take the same CollectOptions. The argument list is found by
      // BALANCING parentheses rather than by a non-greedy regex: these calls
      // nest (`...(cond ? {tags} : {})`), and a regex that stops at the first
      // `)` reports a perfectly attested collector as an offender.
      for (const call of ["changes.collect", "makeChurnGuard"]) {
        let from = 0;
        for (;;) {
          const at = body.indexOf(call, from);
          if (at === -1) break;
          from = at + call.length;
          // The `(` must FOLLOW the identifier directly. Without that, the
          // occurrence inside `import { makeChurnGuard } from …` scans forward
          // to the next parenthesis anywhere in the file and reports whatever
          // it lands on — three of this test's first four "offenders" were that.
          const rest = body.slice(at + call.length);
          const lead = rest.match(/^\s*\(/);
          if (lead === null) continue;
          const open = at + call.length + lead[0].length - 1;
          let depth = 0;
          let end = open;
          for (; end < body.length; end++) {
            const ch = body[end];
            if (ch === "(") depth++;
            else if (ch === ")" && --depth === 0) break;
          }
          const args = body.slice(open, end + 1);
          // A call FORWARDING someone else's options (`collect(collect)`) is
          // plumbing; the attestation belongs to whoever built the literal, and
          // that site is checked on its own. Only object literals are judged.
          if (!args.includes("{")) continue;
          if (!/coarse:\s*false/.test(args)) {
            offenders.push(`${f.rel}: ${call}(${args.slice(1, 60).replace(/\s+/g, " ")}…`);
          }
        }
      }
    }
    // A collector without the attestation is not a style nit: it takes the
    // never-miss blanket, which every exact-path writer trips, and turns into a
    // permanent full rescan.
    expect(offenders).toEqual([]);
  });

  it("is EARNED — no raw batch.col() write anywhere in the engine", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const line of code(f.body).split("\n")) {
        // A read is `const xs = b.col(C)` or `b.col(C)[row]`; a WRITE assigns
        // into the column. The attestation is about writes only — reads through
        // a column are the fast path and entirely fine.
        if (/\.col\([^)]*\)\s*\[[^\]]*\]\s*=[^=]/.test(line)) offenders.push(`${f.rel}: ${line.trim()}`);
      }
    }
    // If this ever fires, the choice is real and neither side is free: either
    // route the write through `ctx`/`edit` (store-visible, exact), or drop
    // `coarse: false` from every collector subscribing to that component and
    // accept the rescan. Silently keeping both is how behaviors stop waking.
    expect(offenders).toEqual([]);
  });
});
