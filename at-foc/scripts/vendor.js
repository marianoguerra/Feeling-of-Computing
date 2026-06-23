// Vendors the runtime dependencies (tutuca + margaui) from node_modules into
// ./vendor so the site can be served from static hosting without shipping
// node_modules. index.html / src reference these copies directly (no import
// map). Re-run after bumping the tutuca/margaui versions in package.json.

import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = (...p) => join(root, "node_modules", ...p);
const to = (...p) => join(root, "vendor", ...p);

// [source, destination] pairs. tutuca-extra is the browser build that bundles
// the margaui compile helpers on top of the core tutuca API.
const files = [
  [from("tutuca", "dist", "tutuca-extra.js"), to("tutuca-extra.js")],
  [from("margaui", "dist", "margaui.min.js"), to("margaui.min.js")],
];

mkdirSync(to(), { recursive: true });
for (const [src, dst] of files) {
  cpSync(src, dst);
  console.log(`vendored ${dst.slice(root.length + 1)}`);
}

// Every margaui theme stylesheet — the in-app theme switcher swaps between them
// at runtime, so vendor the whole folder rather than a single theme.
cpSync(from("margaui", "dist", "themes"), to("themes"), { recursive: true });
console.log(`vendored ${to("themes").slice(root.length + 1)}/ (all themes)`);
