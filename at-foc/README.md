# at-foc — Feeling of Computing conversations (atproto mirror)

A web reader for the Feeling-of-Computing Slack, sourced **live from the
atproto/Colibri mirror** instead of static JSON exports. It is the spiritual
successor of the
[`conversations`](https://github.com/marianoguerra/Feeling-of-Computing/tree/main/conversations)
frontend: a channel sidebar + message stream with rich text, reactions and
threaded replies — but every message is read at load time from the bridge bot's
PDS (wiki PR #21).

## How it works

- The bridge bot (`@feelingofcomputing.bsky.social`,
  `did:plc:4gcxakknd6hxtnhf33miwsob`) writes `social.colibri.message` /
  `social.colibri.reaction` records to its PDS.
- The community owner (`did:plc:j7nm3lrd5h7fm3sfhcv3lhfv`) holds the
  `social.colibri.channel` records.
- `src/atproto.js` pages through `com.atproto.repo.listRecords` (CORS is open, so
  no backend is needed), then `buildModel()` groups everything into a tree of
  root messages → replies, resolves channel names, parses the `@Name:` author
  prefix and turns rich-text facets into styled segments.
- `src/components.js` is a [tutuca](https://www.npmjs.com/package/tutuca) SPA that
  renders the model: `ConversationsViewer` (sidebar + stream + toggles),
  `Message`, `RichText`/`Segment`, `Reaction`, `Channel`.

## Run

```sh
npm install
npm run vendor     # copy tutuca/margaui/themes into ./vendor (committed, but re-run after a version bump)
npx serve .        # then open http://localhost:3000/
```

Channel toggles (`replies` / `reactions` / `channel`) in the top bar control what
each message row shows.

## Develop

The components are exercised offline against captured fixtures
(`src/fixtures.js`, real records snapshotted from the PDS):

```sh
tutuca lint src/components.js
tutuca test src/components.dev.js
tutuca render src/components.dev.js --title "Viewer (loaded)"
tutuca storybook            # interactive component catalog
```

## Styling

Markup uses [margaui](https://github.com/marianoguerra/margaui) (Tailwind v4 /
daisyUI-compatible) classes. margaui ships a self-contained in-browser Tailwind
compiler, so there's no CDN and no build step: `npm run vendor` copies
`margaui.min.js` (and every theme stylesheet) into `./vendor`, and at startup
`src/app.js` asks tutuca for the classes its components use and compiles them via
`compileClassesToStyleText` + `injectCss`. The utility CSS therefore stays in sync
with the components automatically. The in-app theme switcher swaps between the
vendored `vendor/themes/*.css` files at runtime.
