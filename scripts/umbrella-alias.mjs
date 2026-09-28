// THE UMBRELLA'S PUBLISHED SPECIFIERS IN THE WORKSPACE (design-016 K8b): a plugin package (examples/*) imports ICE exactly as
// an outside plugin does — `@vibecook/ice/desk`, `@vibecook/ice/desk/kit`, … — and in the workspace those names resolve to the
// umbrella's SOURCE entries (`packages/ice/src/<entry>.ts`, each one `export * from` a workspace barrel), never to `dist/` (a
// build would be a second copy of the desk: two kind registries, two WeakMaps of drivers). The map is READ from the umbrella's
// exports map, so an entry the published package does not ship cannot resolve. TypeScript and tsx take the same map from
// tsconfig.base.json's `paths`; this is the bundlers' (Vite, vitest) — anchored regexes, so `/desk` never swallows `/desk/kit`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** `[{ find, replacement }]` for Vite's `resolve.alias`: every published specifier → its source entry under packages/ice/src. */
export function umbrellaAlias() {
  const pkg = JSON.parse(readFileSync(resolve(root, "packages/ice/package.json"), "utf8"));
  const out = [];
  for (const [sub, target] of Object.entries(pkg.exports)) {
    const dist = typeof target === "string" ? target : target.default;
    const m = /^\.\/dist\/(.+)\.js$/.exec(dist ?? "");
    if (m === null) continue;   // ./package.json
    const spec = `${pkg.name}${sub === "." ? "" : sub.slice(1)}`;
    out.push({ find: new RegExp(`^${spec.replaceAll("/", "\\/")}$`), replacement: resolve(root, "packages/ice/src", `${m[1]}.ts`) });
  }
  return out;
}
