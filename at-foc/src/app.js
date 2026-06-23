// Browser entry point: wire the components to the live AT Protocol data layer
// and kick off the initial load.

import { compile } from "../vendor/margaui.min.js";
import {
  compileClassesToStyleText,
  injectCss,
  tutuca,
} from "../vendor/tutuca-extra.js";
import { getRequestHandlers } from "./atproto.js";
import { ConversationsViewer, getComponents } from "./components.js";
import { ymd } from "./date.js";
import { updateHighlights } from "./highlight.js";

async function main() {
  const app = tutuca("#app");
  const scope = app.registerComponents(getComponents());
  scope.registerRequestHandlers(getRequestHandlers());

  // Seed the date range: ?from / ?to query params if present, else default to the
  // last 7 days (to = today inclusive, from = 7 days ago).
  const params = new URLSearchParams(location.search);
  const today = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(today.getDate() - 7);
  const toDate = params.get("to") || ymd(today);
  const fromDate = params.get("from") || ymd(weekAgo);
  const query = params.get("q") || "";

  // The theme was already resolved + applied by the inline bootstrap in
  // index.html (?theme= or the OS light/dark preference), so read it back from
  // the document instead of duplicating that logic here.
  const themeLink = document.getElementById("theme-css");
  const THEME_DIR = "./vendor/themes/";
  const applyTheme = (name) => {
    document.documentElement.setAttribute("data-theme", name);
    const href = `${THEME_DIR}${name}.css`;
    if (themeLink.getAttribute("href") !== href)
      themeLink.setAttribute("href", href);
  };
  const theme = document.documentElement.getAttribute("data-theme") || "light";

  app.state.set(ConversationsViewer.make({ fromDate, toDate, theme, query }));

  // Keep the query params and the document theme in sync with app state.
  app.onChange(({ val }) => {
    if (!val?.fromDate || !val.toDate) return;
    applyTheme(val.theme);
    const qs = `?from=${encodeURIComponent(val.fromDate)}&to=${encodeURIComponent(val.toDate)}&theme=${encodeURIComponent(val.theme)}&q=${encodeURIComponent(val.query || "")}`;
    if (location.search !== qs) history.replaceState(null, "", qs);
    // Recompute search highlights after tutuca has painted the new message list.
    requestAnimationFrame(() => updateHighlights(val.query));
  });

  // Compile the margaui classes used across the registered components and inject
  // the resulting stylesheet before the first render.
  injectCss("at-foc", await compileClassesToStyleText(app, compile));

  app.start();

  // `receive.init` isn't a lifecycle hook — dispatch it explicitly to start the
  // fetch (see core.md "Common pitfalls").
  app.sendAtRoot("init");
}

main();
