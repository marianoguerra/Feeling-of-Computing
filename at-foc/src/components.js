// Tutuca component tree for the FoC Colibri-mirror conversations reader.
// Structure mirrors the original conversations frontend (channel sidebar +
// message stream with rich text, reactions and threaded replies) but is fed by
// the AT Protocol data layer in atproto.js instead of static JSON exports.

import { component, css, html } from "../vendor/tutuca-extra.js";
import { COMMUNITY_NAME } from "./atproto.js";
import { fmtTime } from "./date.js";
import { makeMatcher } from "./search.js";

// Single shared fuzzy matcher for live conversation search (see search.js).
const uf = makeMatcher();

// --- one styled run of a message body -------------------------------------
export const Segment = component({
  name: "Segment",
  fields: {
    text: "",
    bold: false,
    italic: false,
    strike: false,
    code: false,
    mention: false,
    channel: false,
    link: false,
    url: "",
  },
  methods: {
    hasUrl() {
      return this.link && this.url.length > 0;
    },
    segClass() {
      const c = ["seg"];
      if (this.bold) c.push("font-bold");
      if (this.italic) c.push("italic");
      if (this.strike) c.push("line-through");
      if (this.code)
        c.push("font-mono", "text-sm", "bg-base-200", "rounded", "px-1");
      if (this.mention) c.push("text-secondary", "font-medium");
      if (this.channel) c.push("text-accent", "font-medium");
      return c.join(" ");
    },
  },
  views: {
    // Decoy (never rendered): segClass() composes these at runtime, so the
    // margaui scanner can't see them in a class= literal — list them here.
    _margauiClasses: html`<span class="font-bold italic line-through font-mono text-sm bg-base-200 rounded px-1 text-secondary font-medium text-accent"></span>`,
  },
  view: html`<span :class="$segClass"><a class="link link-primary" :href=".url" @text=".text" @show="$hasUrl"></a><x text=".text" hide="$hasUrl"></x></span>`,
});

// --- rich text body: a flat list of segments ------------------------------
export const RichText = component({
  name: "RichText",
  fields: { segments: [] },
  view: html`<span class="rich"><x render-each=".segments"></x></span>`,
  style: css`.rich { white-space: pre-wrap; overflow-wrap: anywhere; }`,
});

// --- a single emoji reaction with its count -------------------------------
export const Reaction = component({
  name: "Reaction",
  fields: { emoji: "", count: 0 },
  view: html`<span class="badge badge-sm badge-ghost gap-1"><x text=".emoji"></x><span class="opacity-70" @text=".count"></span></span>`,
});

// --- a channel entry in the sidebar ---------------------------------------
export const Channel = component({
  name: "Channel",
  fields: { id: "", name: "", active: false },
  methods: {
    itemClass() {
      return this.active ? "active" : "";
    },
  },
  input: {
    select(ctx) {
      ctx.bubble("selectChannel", [this.id]);
      return this;
    },
  },
  view: html`<li><a :class="$itemClass" @on.click="select">#<x text=".name"></x></a></li>`,
});

// --- a message (root or, when compact, a threaded reply) ------------------
export const Message = component({
  name: "Message",
  fields: {
    id: "",
    author: "",
    channel: "",
    channelName: "",
    createdAt: "",
    body: null, // RichText instance
    reactions: [], // List<Reaction>
    replies: [], // List<Message>
    compact: false,
    expanded: false,
  },
  statics: {
    // Single-scope app, so referencing the sibling component consts directly is
    // safe (see core.md "One definition, multiple scopes").
    fromData(o) {
      return this.make({
        id: o.id,
        author: o.author || "",
        channel: o.channel || "",
        channelName: o.channelName || "",
        createdAt: o.createdAt || "",
        body: RichText.make({
          segments: (o.segments || []).map((s) => Segment.make(s)),
        }),
        reactions: (o.reactions || []).map((r) =>
          Reaction.make({ emoji: r.emoji, count: r.count }),
        ),
        replies: (o.replies || []).map((r) =>
          this.fromData(r).setCompact(true),
        ),
      });
    },
  },
  methods: {
    authorLabel() {
      return this.author ? `@${this.author}` : "@feelingofcomputing";
    },
    channelLabel() {
      return `#${this.channelName}`;
    },
    hasChannel() {
      return !this.compact && this.channelName.length > 0;
    },
    time() {
      return fmtTime(this.createdAt);
    },
    hasReplies() {
      return this.replies.size > 0;
    },
    // Return a copy of this thread with `expanded` forced on/off for this
    // message and every nested reply (whole-thread expand/collapse).
    setExpandedDeep(value) {
      return this.setExpanded(value).setReplies(
        this.replies.map((r) => r.setExpandedDeep(value)),
      );
    },
    replyLabel() {
      const n = this.replies.size;
      return `${this.expanded ? "▾" : "▸"} ${n} ${n === 1 ? "reply" : "replies"}`;
    },
    rowClass() {
      return this.compact
        ? "msg msg-compact text-sm py-1"
        : "msg card bg-base-100 shadow-sm p-3";
    },
    // Flat text indexed by the fuzzy search: this message's author + channel +
    // body, plus all nested replies (whole-thread scope, so a thread surfaces
    // when the query matches anywhere in it).
    searchText() {
      const own = `${this.author} ${this.channelName} ${this.body.segments.map((s) => s.text).join(" ")}`;
      const kids = this.replies.map((r) => r.searchText()).join(" ");
      return kids ? `${own} ${kids}` : own;
    },
  },
  views: {
    // Decoy (never rendered): rowClass() composes these at runtime.
    _margauiClasses: html`<span class="card bg-base-100 shadow-sm p-3 text-sm py-1"></span>`,
  },
  view: html`<article :class="$rowClass">
    <div class="msg-head flex items-center gap-2 flex-wrap">
      <span class="msg-author font-semibold text-primary" @text="$authorLabel"></span>
      <span class="msg-channel badge badge-ghost badge-sm" @text="$channelLabel" @show="$hasChannel"></span>
      <span class="msg-time text-xs opacity-60" @text="$time"></span>
    </div>
    <div class="msg-body mt-1"><x render=".body"></x></div>
    <div class="msg-reactions flex gap-1 flex-wrap mt-2"><x render-each=".reactions"></x></div>
    <div class="msg-foot mt-1" @show="$hasReplies">
      <button class="btn btn-ghost btn-xs" @on.click="$toggleExpanded" @text="$replyLabel"></button>
    </div>
    <div class="msg-replies mt-2 pl-3 border-l-2 border-base-300 flex flex-col gap-1" @show=".expanded">
      <x render-each=".replies"></x>
    </div>
  </article>`,
});

// --- the whole viewer: sidebar + stream + toggles -------------------------
export const ConversationsViewer = component({
  name: "ConversationsViewer",
  fields: {
    community: COMMUNITY_NAME,
    channels: [], // List<Channel>
    messages: [], // List<Message> (roots)
    query: "", // live fuzzy-search text ("" = no search)
    matchIds: null, // null = no active query; else Set<id> of matching roots
    searchIds: [], // root ids, parallel to searchHaystack (rebuilt per model)
    searchHaystack: [], // root searchText() strings, indexed by uFuzzy
    selectedChannel: "", // "" = all
    fromDate: "", // "YYYY-MM-DD", inclusive
    toDate: "", // "YYYY-MM-DD", inclusive
    loading: true,
    error: "",
    showReplies: true,
    showReactions: true,
    showChannel: true,
    sortNewestFirst: true, // top-level order by root createdAt
    theme: "light", // margaui theme name; seeded from the URL / OS preference
  },
  statics: {
    fromModel(model) {
      return this.make({}).applyModel(model);
    },
  },
  methods: {
    applyModel(model) {
      const channels = (model.channels || []).map((c) =>
        Channel.make({
          id: c.id,
          name: c.name,
          active: c.id === this.selectedChannel,
        }),
      );
      const messages = (model.messages || []).map((m) =>
        Message.Class.fromData(m),
      );
      const ordered = this.orderMessages(messages);
      // Cache parallel id/haystack arrays once per model so each keystroke is
      // just a uFuzzy filter over precomputed strings; then re-apply any active
      // query against the new model.
      return this.setLoading(false)
        .setError("")
        .setCommunity(model.community || this.community)
        .setChannels(channels)
        .setMessages(ordered)
        .setSearchIds(ordered.map((m) => m.id))
        .setSearchHaystack(ordered.map((m) => m.searchText()))
        .applyQuery(this.query);
    },
    // Recompute matchIds from `query` against the cached haystack. Empty query
    // clears the filter (matchIds = null → everything shows).
    applyQuery(query) {
      const q = query.trim();
      if (q === "") return this.setQuery(query).setMatchIds(null);
      // searchIds/searchHaystack are Immutable Lists; uFuzzy needs plain arrays.
      const ids = this.searchIds.toArray();
      const idxs = uf.filter(this.searchHaystack.toArray(), q); // null if none
      const matched = idxs ? idxs.map((i) => ids[i]) : [];
      return this.setQuery(query).setMatchIds(new Set(matched));
    },
    // Order top-level messages by root createdAt per the sortNewestFirst flag.
    // Works on both an immutable List and a plain array (both have .sort(cmp)).
    messageComparator() {
      const dir = this.sortNewestFirst ? -1 : 1;
      return (a, b) =>
        a.createdAt < b.createdAt ? -dir : a.createdAt > b.createdAt ? dir : 0;
    },
    orderMessages(list) {
      return list.sort(this.messageComparator());
    },
    markActive(id) {
      return this.setChannels(
        this.channels.map((c) => c.setActive(c.id === id)),
      );
    },
    shellClass() {
      const c = ["app-shell"];
      if (!this.showReplies) c.push("hide-replies");
      if (!this.showReactions) c.push("hide-reactions");
      if (!this.showChannel) c.push("hide-channel");
      return c.join(" ");
    },
    allClass() {
      return this.selectedChannel === "" ? "active" : "";
    },
    hasError() {
      return this.error.length > 0;
    },
    isEmpty() {
      return !this.loading && this.error === "" && this.messages.size === 0;
    },
  },
  input: {
    selectAll() {
      return this.setSelectedChannel("").markActive("");
    },
    setFromRange(value, ctx) {
      ctx.request("loadRange", [{ from: value, to: this.toDate }]);
      return this.setFromDate(value).setLoading(true);
    },
    setToRange(value, ctx) {
      ctx.request("loadRange", [{ from: this.fromDate, to: value }]);
      return this.setToDate(value).setLoading(true);
    },
    // app.js's onChange applies the new theme to the document + URL.
    chooseTheme(value) {
      return this.setTheme(value);
    },
    toggleSort() {
      const next = this.toggleSortNewestFirst();
      return next.setMessages(next.orderMessages(next.messages));
    },
    expandAllReplies() {
      return this.setMessages(
        this.messages.map((m) => m.setExpandedDeep(true)),
      );
    },
    collapseAllReplies() {
      return this.setMessages(
        this.messages.map((m) => m.setExpandedDeep(false)),
      );
    },
    // Live fuzzy search: recompute the matching-id set on every keystroke.
    setQuery(value) {
      return this.applyQuery(value);
    },
  },
  receive: {
    init(ctx) {
      ctx.request("loadRange", [{ from: this.fromDate, to: this.toDate }]);
      return this.setLoading(true);
    },
  },
  response: {
    loadRange(res, err) {
      if (err)
        return this.setLoading(false).setError(String(err?.message || err));
      return this.applyModel(res);
    },
  },
  bubble: {
    selectChannel(id) {
      return this.setSelectedChannel(id).markActive(id);
    },
  },
  alter: {
    // Per-thread filter combining the channel sidebar and the fuzzy search.
    matches(_key, item) {
      const inChannel =
        this.selectedChannel === "" || item.channel === this.selectedChannel;
      const inQuery = this.matchIds === null || this.matchIds.has(item.id);
      return inChannel && inQuery;
    },
  },
  views: {
    // Decoy (never rendered): these utility classes live on <body> and #app in
    // index.html — outside any component — so the scanner can't see them there.
    // Naming them here makes margaui emit their CSS.
    _margauiClasses: html`<span class="h-full w-full p-2 md:p-4 bg-base-100 text-base-content"></span>`,
  },
  view: html`<div :class="$shellClass">
    <header class="navbar bg-base-300 rounded-box mb-2 gap-2 flex-wrap">
      <div class="font-bold text-lg px-2 flex-1" @text=".community"></div>
      <label class="flex items-center gap-1 text-sm px-1">Search<input type="search" placeholder="fuzzy search…" class="input input-bordered input-xs" :value=".query" @on.input="setQuery value" /></label>
      <label class="flex items-center gap-1 text-sm px-1">From<input type="date" class="input input-bordered input-xs" :value=".fromDate" @on.change="setFromRange value" /></label>
      <label class="flex items-center gap-1 text-sm px-1">To<input type="date" class="input input-bordered input-xs" :value=".toDate" @on.change="setToRange value" /></label>
      <label class="flex items-center gap-1 text-sm px-1">Theme<select class="select select-bordered select-xs" :value=".theme" @on.change="chooseTheme value">
        <option value="abyss">abyss</option>
        <option value="acid">acid</option>
        <option value="aqua">aqua</option>
        <option value="autumn">autumn</option>
        <option value="black">black</option>
        <option value="bumblebee">bumblebee</option>
        <option value="business">business</option>
        <option value="caramellatte">caramellatte</option>
        <option value="cmyk">cmyk</option>
        <option value="coffee">coffee</option>
        <option value="corporate">corporate</option>
        <option value="cupcake">cupcake</option>
        <option value="cyberpunk">cyberpunk</option>
        <option value="dark">dark</option>
        <option value="dim">dim</option>
        <option value="dracula">dracula</option>
        <option value="emerald">emerald</option>
        <option value="fantasy">fantasy</option>
        <option value="forest">forest</option>
        <option value="garden">garden</option>
        <option value="halloween">halloween</option>
        <option value="lemonade">lemonade</option>
        <option value="light">light</option>
        <option value="lofi">lofi</option>
        <option value="luxury">luxury</option>
        <option value="night">night</option>
        <option value="nord">nord</option>
        <option value="pastel">pastel</option>
        <option value="retro">retro</option>
        <option value="silk">silk</option>
        <option value="sunset">sunset</option>
        <option value="synthwave">synthwave</option>
        <option value="valentine">valentine</option>
        <option value="winter">winter</option>
        <option value="wireframe">wireframe</option>
      </select></label>
    </header>
    <div class="navbar bg-base-200 rounded-box mb-3 min-h-0 py-1">
      <div class="flex-1 text-sm opacity-60 px-2" @show=".loading"><span class="loading loading-spinner loading-xs"></span> loading…</div>
      <div class="flex gap-3 items-center text-sm px-2">
        <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="toggle toggle-xs" :checked=".showReplies" @on.change="$toggleShowReplies" />replies</label>
        <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="toggle toggle-xs" :checked=".showReactions" @on.change="$toggleShowReactions" />reactions</label>
        <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="toggle toggle-xs" :checked=".showChannel" @on.change="$toggleShowChannel" />channel</label>
        <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="toggle toggle-xs" :checked=".sortNewestFirst" @on.change="toggleSort" />newest first</label>
      </div>
      <div class="flex gap-1 items-center px-2" @show=".showReplies">
        <button class="btn btn-ghost btn-xs" @on.click="expandAllReplies">▾ expand all replies</button>
        <button class="btn btn-ghost btn-xs" @on.click="collapseAllReplies">▸ collapse all replies</button>
      </div>
    </div>
    <div class="app-body">
      <aside class="sidebar">
        <ul class="menu bg-base-200 rounded-box w-full">
          <li class="menu-title">Channels</li>
          <li><a :class="$allClass" @on.click="selectAll">All channels</a></li>
          <x render-each=".channels"></x>
        </ul>
      </aside>
      <main class="stream flex flex-col gap-3">
        <div class="alert" @show=".loading"><span class="loading loading-spinner loading-sm"></span><span>Loading conversations…</span></div>
        <div class="alert alert-error" @show="$hasError" @text=".error"></div>
        <div class="opacity-60 text-sm" @show="$isEmpty">No messages.</div>
        <x render-each=".messages" when="matches"></x>
      </main>
    </div>
  </div>`,
  style: css`
    .app-body { display: grid; grid-template-columns: 14rem 1fr; gap: 1rem; align-items: start; }
    .sidebar { position: sticky; top: 0.5rem; }
    @media (max-width: 48rem) { .app-body { grid-template-columns: 1fr; } }
  `,
  globalStyle: css`
    .hide-replies .msg-foot, .hide-replies .msg-replies { display: none !important; }
    .hide-reactions .msg-reactions { display: none !important; }
    .hide-channel .msg-channel { display: none !important; }
    /* Fuzzy-search hits, painted via the CSS Custom Highlight API (see
       highlight.js). Theme-aware via margaui's --color-warning tokens. */
    ::highlight(fuzzy-match) {
      background-color: var(--color-warning, gold);
      color: var(--color-warning-content, black);
      border-radius: 0.15rem;
    }
  `,
});

export function getComponents() {
  return [ConversationsViewer, Message, RichText, Segment, Reaction, Channel];
}
