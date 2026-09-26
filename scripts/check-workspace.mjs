#!/usr/bin/env node
// The workspace's build approvals, checked (design-015 D7, the surface review's #9): every `allowBuilds` value in
// pnpm-workspace.yaml is a BOOLEAN — pnpm 11 writes the placeholder "set this to true or false" for a package it was not
// told about, and D5b's install left two (electron, @vibecook/truffle) behind the comment that said they had left — and
// every package it names is one the lockfile resolves (an approval for a package nothing installs is a stale line).
// Run by the root `gen:check` (so `ci`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const yaml = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
const lock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");

/** The `allowBuilds:` block's entries: `name: value`, the name unquoted. */
const block = /^allowBuilds:\n((?:[ \t]+.*\n?)*)/m.exec(yaml)?.[1] ?? "";
const entries = block.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#")).map((l) => {
  const m = /^(["']?)([^"':]+)\1\s*:\s*(.*)$/.exec(l);
  return m === null ? { name: l, value: "" } : { name: m[2], value: m[3].trim() };
});

const bad = [];
if (entries.length === 0) bad.push("no allowBuilds entries were read — the parse is broken, not the file");
for (const { name, value } of entries) {
  if (value !== "true" && value !== "false") bad.push(`${name}: "${value}" is not a boolean (pnpm's placeholder?)`);
  // a lockfile key is `name@version` (scoped: `'@scope/name@version'`)
  if (!lock.includes(`${name}@`)) bad.push(`${name}: the lockfile resolves no such package — a stale approval`);
}
for (const b of bad) console.error(`check-workspace: ${b}`);
if (bad.length > 0) process.exit(1);
console.log(`check-workspace: ${entries.length} allowBuilds approvals, each a boolean for a package the lockfile resolves`);
