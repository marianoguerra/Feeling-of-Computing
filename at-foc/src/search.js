// Shared fuzzy-search configuration. intraMode 1 allows single-char
// typos/transpositions inside a term (vs 0 = exact term chars). The viewer's
// live filter (components.js) and the DOM highlighter (highlight.js) must use
// the same options so the painted highlights line up with the matched rows.

import uFuzzy from "../vendor/uFuzzy.mjs";

export const FUZZY_OPTS = { intraMode: 1 };

export function makeMatcher() {
  return new uFuzzy(FUZZY_OPTS);
}
