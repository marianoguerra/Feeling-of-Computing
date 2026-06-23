// Highlight the fuzzy-search matches in the rendered message bodies using the
// CSS Custom Highlight API (::highlight(fuzzy-match)). This styles Ranges over
// the live DOM text nodes WITHOUT mutating them, so it composes cleanly with
// tutuca's reactive re-rendering — there are no <mark> wrappers to fight.
//
// We can't reuse the viewer's stored searchHaystack offsets: those index a
// concatenated author+channel+body+replies string that doesn't map to the DOM.
// Instead we re-run uFuzzy against each rendered .msg-body's own text and map
// the per-string ranges back onto its text nodes.

import { makeMatcher } from "./search.js";

const uf = makeMatcher(); // same options as the viewer's matcher (see search.js)
const HIGHLIGHT_NAME = "fuzzy-match";
const supported =
  typeof CSS !== "undefined" &&
  CSS.highlights &&
  typeof Highlight === "function";

// Collect a body element's descendant text nodes plus a flat concatenation of
// their text, with the global start offset of each node so a global [s,e) range
// can be mapped back to (node, localOffset).
function collectText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let full = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: full.length });
    full += n.data;
  }
  return { nodes, full };
}

// Locate the text node (and local offset) that contains global offset `pos`.
// `atEnd` biases an offset sitting on a boundary to the end of the left node so
// a range's end clamps tightly to the matched text.
function locate(nodes, pos, atEnd) {
  for (let i = 0; i < nodes.length; i++) {
    const { node, start } = nodes[i];
    const end = start + node.data.length;
    if (atEnd ? pos > start && pos <= end : pos >= start && pos < end) {
      return { node, offset: pos - start };
    }
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : null;
}

// Rebuild the global highlight from the current query. Called after each render
// (see app.js); a no-op when the API is unsupported.
export function updateHighlights(query) {
  if (!supported) return;
  const q = (query || "").trim();
  if (q === "") {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }
  const highlight = new Highlight();
  for (const body of document.querySelectorAll("#app .msg-body")) {
    const { nodes, full } = collectText(body);
    if (!full) continue;
    const idxs = uf.filter([full], q);
    if (!idxs || idxs.length === 0) continue;
    const info = uf.info(idxs, [full], q);
    const ranges = info.ranges[0]; // flat [start, end, start, end, ...]
    for (let i = 0; i < ranges.length; i += 2) {
      const a = locate(nodes, ranges[i], false);
      const b = locate(nodes, ranges[i + 1], true);
      if (!a || !b) continue;
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      highlight.add(range);
    }
  }
  if (highlight.size > 0) CSS.highlights.set(HIGHLIGHT_NAME, highlight);
  else CSS.highlights.delete(HIGHLIGHT_NAME);
}
