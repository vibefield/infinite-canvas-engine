/**
 * The import walls (design-002 §6). One direction only:
 *   kernel ← core ← dom ← react ← r3f          devtools → core (+kernel)
 * kernel imports NOTHING. core never touches react/dom/three.
 * Violations are CI failures, not warnings — v1 had no wall to stop at.
 */
module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "kernel-imports-nothing",
      comment:
        "kernel is pure math: plain structs in, plain structs out. Single named exception: rbush (zero-dep R-tree data structure).",
      severity: "error",
      from: { path: "^packages/kernel/src" },
      to: { pathNot: "^packages/kernel/src|^node_modules/(\\.pnpm/)?rbush" },
    },
    {
      name: "core-is-headless",
      comment: "core may import kernel + strata-ecs only — never react/dom/three or higher packages",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { path: "^packages/(dom|react|r3f|devtools)|node_modules/(react|react-dom|three|@react-three)" },
    },
    {
      name: "dom-below-react",
      severity: "error",
      from: { path: "^packages/dom/src" },
      to: { path: "^packages/(react|r3f|devtools)|node_modules/(react|react-dom|three|@react-three)" },
    },
    {
      name: "react-below-r3f",
      severity: "error",
      from: { path: "^packages/react/src" },
      to: { path: "^packages/(r3f|devtools)|node_modules/(three|@react-three)" },
    },
    {
      name: "devtools-only-core",
      severity: "error",
      from: { path: "^packages/devtools/src" },
      to: { path: "^packages/(dom|react|r3f)" },
    },
    {
      name: "nobody-imports-devtools",
      severity: "error",
      from: { path: "^packages/(kernel|core|dom|react|r3f)/src" },
      to: { path: "^packages/devtools" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
