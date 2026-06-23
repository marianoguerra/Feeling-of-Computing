// Dev/storybook + tests for the conversations reader. Runs fully offline on the
// captured fixtures (src/fixtures.js) — no network. Discovered by
// `tutuca storybook` and exercised by `tutuca test src/components.dev.js`.

import {
  buildModel,
  dayNum,
  loadRange,
  mergeIntervals,
  missingIntervals,
  resetRangeCache,
  splitAuthor,
  textToSegments,
} from "./atproto.js";
import {
  Channel,
  ConversationsViewer,
  getComponents,
  Message,
  Reaction,
  RichText,
  Segment,
} from "./components.js";
import { CHANNELS, MESSAGES, REACTIONS } from "./fixtures.js";

export { getComponents };

const MODEL = buildModel({
  channels: CHANNELS,
  messages: MESSAGES,
  reactions: REACTIONS,
});

// In the storybook, the viewer never fetches — it is pre-populated. The mock
// request handlers return the same model so the live init / range paths work.
export function getRoot() {
  return ConversationsViewer.Class.fromModel(MODEL)
    .setFromDate("2026-06-16")
    .setToDate("2026-06-23");
}

export function getRequestHandlers() {
  return {
    async loadRange() {
      return MODEL;
    },
  };
}

// A fetch stub that serves the fixtures as a single page per collection — used
// to exercise loadRange's caching without touching the network.
function fixtureFetch(calls) {
  return async (url) => {
    calls.push(url);
    const records = url.includes("social.colibri.channel")
      ? CHANNELS
      : url.includes("social.colibri.reaction")
        ? REACTIONS
        : url.includes("social.colibri.message")
          ? MESSAGES
          : [];
    return { ok: true, json: async () => ({ records, cursor: "" }) };
  };
}

// Models the viewer's request mocks return. The storybook dispatches `init` to
// each example, which fires `loadRange`; the per-example `requestHandlers`
// override below decides the outcome (full / empty / slow / error / never).
const FULL_MODEL = MODEL;
const EMPTY_MODEL = buildModel({
  channels: CHANNELS,
  messages: [],
  reactions: [],
});
const DATES = { fromDate: "2026-06-16", toDate: "2026-06-23" };
const mkViewer = (extra = {}) =>
  ConversationsViewer.make({ ...DATES, ...extra });
// A channel rkey that actually has messages, so the filtered example shows rows.
const POPULATED_CHANNEL = MODEL.messages[0].channel;
const delay = (ms, value) =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Per-example loadRange mocks for each response kind. The storybook does not
// auto-dispatch `init`, so the `value` below carries the at-rest state and these
// overrides are exercised live by interacting (change a date picker → loadRange).
const respondFull = {
  async loadRange() {
    return FULL_MODEL;
  },
};
const respondEmpty = {
  async loadRange() {
    return EMPTY_MODEL;
  },
};
const respondSlow = {
  async loadRange() {
    return delay(1500, FULL_MODEL);
  },
};
const respondError = {
  async loadRange() {
    throw new Error("PDS unavailable (HTTP 503)");
  },
};
const respondNever = {
  loadRange() {
    return new Promise(() => {});
  },
};

// Pre-applied viewer states (so each card shows its state without a live fetch).
const VIEW_FULL = mkViewer().applyModel(FULL_MODEL);
const VIEW_EMPTY = mkViewer().applyModel(EMPTY_MODEL);
const VIEW_LOADING = mkViewer(); // loading: true by default
const VIEW_ERROR = mkViewer()
  .setLoading(false)
  .setError("PDS unavailable (HTTP 503)");

export function getExamples() {
  // A standalone root message (with a thread) and one of its replies (compact).
  const rootMsg = ConversationsViewer.Class.fromModel(MODEL).messages.first();
  const replyMsg = rootMsg.replies.first();
  const leafData = MODEL.messages[0].replies[0]; // a message with no replies of its own

  return [
    {
      title: "Viewer · data states",
      description:
        "Each card shows a response state at rest; changing a date picker re-runs loadRange through the per-example mock to exercise that response kind live.",
      items: [
        {
          title: "Full response",
          description:
            "Loaded with the full model. Change a date to re-fetch (full).",
          value: VIEW_FULL,
          requestHandlers: respondFull,
        },
        {
          title: "Empty response",
          description:
            "Channels but no messages → empty state. Change a date to re-fetch (empty).",
          value: VIEW_EMPTY,
          requestHandlers: respondEmpty,
        },
        {
          title: "Loading (pending)",
          description:
            "Spinner holds; loadRange never resolves. Change a date — stays loading.",
          value: VIEW_LOADING,
          requestHandlers: respondNever,
        },
        {
          title: "Slow response",
          description:
            "Loaded; change a date to watch a 1.5s spinner, then content.",
          value: VIEW_FULL,
          requestHandlers: respondSlow,
        },
        {
          title: "Error response",
          description:
            "Error alert. Change a date to re-trigger the failing fetch.",
          value: VIEW_ERROR,
          requestHandlers: respondError,
        },
      ],
    },
    {
      title: "Viewer · UI variants",
      description: "Full data, varying the view controls.",
      items: [
        {
          title: "All toggles on",
          description: "Replies, reactions and channel badges shown.",
          value: VIEW_FULL,
          requestHandlers: respondFull,
        },
        {
          title: "Channel filtered",
          description: "A channel pre-selected; stream filtered to it.",
          value: mkViewer({ selectedChannel: POPULATED_CHANNEL }).applyModel(
            FULL_MODEL,
          ),
          requestHandlers: respondFull,
        },
        {
          title: "Toggles off",
          description: "Replies, reactions and channel badges hidden.",
          value: mkViewer({
            showReplies: false,
            showReactions: false,
            showChannel: false,
          }).applyModel(FULL_MODEL),
          requestHandlers: respondFull,
        },
        {
          title: "Oldest first",
          description: "Top-level order flipped to oldest root message first.",
          value: mkViewer({ sortNewestFirst: false }).applyModel(FULL_MODEL),
          requestHandlers: respondFull,
        },
      ],
    },
    {
      title: "Message",
      items: [
        {
          title: "Root with thread",
          description: "A root message with reactions and replies.",
          value: rootMsg,
        },
        {
          title: "Reply (compact)",
          description: "A threaded reply, compact styling.",
          value: replyMsg,
        },
        {
          title: "No replies",
          description: "A message with no thread.",
          value: Message.Class.fromData(leafData),
        },
      ],
    },
    {
      title: "Rich text & segments",
      items: [
        {
          title: "RichText (mixed)",
          description: "Several styled runs in one body.",
          value: RichText.make({
            segments: [
              Segment.make({ text: "Mixed: " }),
              Segment.make({ text: "bold", bold: true }),
              Segment.make({ text: ", " }),
              Segment.make({ text: "italic", italic: true }),
              Segment.make({ text: ", " }),
              Segment.make({ text: "code", code: true }),
              Segment.make({ text: ", " }),
              Segment.make({ text: "@mention", mention: true }),
              Segment.make({ text: ", " }),
              Segment.make({ text: "#channel", channel: true }),
              Segment.make({ text: " and a " }),
              Segment.make({
                text: "link",
                link: true,
                url: "https://example.com",
              }),
            ],
          }),
        },
        {
          title: "Segment · plain",
          value: Segment.make({ text: "plain text" }),
        },
        {
          title: "Segment · bold",
          value: Segment.make({ text: "bold", bold: true }),
        },
        {
          title: "Segment · italic",
          value: Segment.make({ text: "italic", italic: true }),
        },
        {
          title: "Segment · strikethrough",
          value: Segment.make({ text: "struck", strike: true }),
        },
        {
          title: "Segment · code",
          value: Segment.make({ text: "inline()", code: true }),
        },
        {
          title: "Segment · mention",
          value: Segment.make({ text: "@Tom Larkworthy", mention: true }),
        },
        {
          title: "Segment · channel",
          value: Segment.make({ text: "#of-ai", channel: true }),
        },
        {
          title: "Segment · link",
          value: Segment.make({
            text: "ultorg.com",
            link: true,
            url: "https://www.ultorg.com/",
          }),
        },
      ],
    },
    {
      title: "Reaction & Channel",
      items: [
        {
          title: "Reaction · single",
          value: Reaction.make({ emoji: "👀", count: 1 }),
        },
        {
          title: "Reaction · many",
          value: Reaction.make({ emoji: "❤️", count: 12 }),
        },
        {
          title: "Channel · active",
          value: Channel.make({ id: "x", name: "of-ai", active: true }),
        },
        {
          title: "Channel · inactive",
          value: Channel.make({
            id: "y",
            name: "thinking-together",
            active: false,
          }),
        },
      ],
    },
  ];
}

export function getTests({ describe, test, expect }) {
  describe("buildModel", () => {
    test("groups replies under their root thread", () => {
      expect(MODEL.messages.length).toBeGreaterThan(0);
      expect(MODEL.messages.some((m) => m.replies.length > 0)).toBe(true);
    });
    test("attaches reactions to their target message", () => {
      const all = [
        ...MODEL.messages,
        ...MODEL.messages.flatMap((m) => m.replies),
      ];
      expect(all.some((m) => m.reactions.length > 0)).toBe(true);
    });
    test("resolves channel names from the owner repo records", () => {
      expect(
        MODEL.messages.every(
          (m) => typeof m.channelName === "string" && m.channelName.length > 0,
        ),
      ).toBe(true);
    });
    test("yields channels but no messages for an empty range", () => {
      expect(EMPTY_MODEL.messages.length).toBe(0);
      expect(EMPTY_MODEL.channels.length).toBeGreaterThan(0);
    });
  });

  describe("splitAuthor", () => {
    test("pulls the @Name: prefix into author and strips it from the body", () => {
      const r = splitAuthor("@Ada Lovelace: hello there", []);
      expect(r.author).toBe("Ada Lovelace");
      expect(r.body).toBe("hello there");
    });
    test("leaves text without a prefix untouched", () => {
      const r = splitAuthor("just text", []);
      expect(r.author).toBe("");
      expect(r.body).toBe("just text");
    });
    test("shifts facet byte offsets back by the prefix length", () => {
      // "@A: " is 4 bytes; a facet at 4..7 over the body word maps to 0..3.
      const r = splitAuthor("@A: bee", [
        { index: { byteStart: 4, byteEnd: 7 }, features: [] },
      ]);
      expect(r.facets[0].index.byteStart).toBe(0);
      expect(r.facets[0].index.byteEnd).toBe(3);
    });
  });

  describe("textToSegments", () => {
    test("returns a single plain segment when there are no facets", () => {
      const segs = textToSegments("plain", []);
      expect(segs.length).toBe(1);
      expect(segs[0].text).toBe("plain");
      expect(segs[0].mention).toBe(false);
    });
    test("marks the faceted byte range and keeps the gaps plain", () => {
      const segs = textToSegments("hi @bob!", [
        {
          index: { byteStart: 3, byteEnd: 7 },
          features: [
            { $type: "social.colibri.richtext.facet#mention", did: "did:x" },
          ],
        },
      ]);
      const mention = segs.find((s) => s.mention);
      expect(mention.text).toBe("@bob");
      expect(segs.map((s) => s.text).join("")).toBe("hi @bob!");
    });
  });

  describe("Message.fromData", () => {
    test("builds nested reply instances marked compact", () => {
      const root = MODEL.messages.find((m) => m.replies.length > 0);
      const inst = Message.Class.fromData(root);
      expect(inst.replies.size).toBe(root.replies.length);
      expect(inst.replies.first().compact).toBe(true);
    });
  });

  describe("interval math", () => {
    test("mergeIntervals joins overlapping and adjacent ranges", () => {
      expect(
        mergeIntervals([
          { a: 1, b: 3 },
          { a: 4, b: 5 },
          { a: 9, b: 10 },
        ]),
      ).toEqual([
        { a: 1, b: 5 },
        { a: 9, b: 10 },
      ]);
    });
    test("missingIntervals returns only the uncovered subranges", () => {
      // want days 1..10, already have 3..5 -> need 1..2 and 6..10
      expect(missingIntervals({ a: 1, b: 10 }, [{ a: 3, b: 5 }])).toEqual([
        { a: 1, b: 2 },
        { a: 6, b: 10 },
      ]);
    });
    test("missingIntervals is empty when fully covered", () => {
      expect(missingIntervals({ a: 4, b: 6 }, [{ a: 1, b: 10 }])).toEqual([]);
    });
    test("dayNum is contiguous across day boundaries", () => {
      expect(dayNum("2026-06-23") - dayNum("2026-06-16")).toBe(7);
    });
  });

  describe("loadRange (incremental)", () => {
    test("loads channels/reactions once, then only fetches missing day-subranges", async () => {
      resetRangeCache();
      const calls = [];
      const fetchStub = fixtureFetch(calls);

      const first = await loadRange(
        { from: "2026-06-20", to: "2026-06-23" },
        fetchStub,
      );
      expect(first.messages.length).toBeGreaterThan(0);
      const channelCalls = calls.filter((u) =>
        u.includes("social.colibri.channel"),
      ).length;
      const msgCallsAfterFirst = calls.filter((u) =>
        u.includes("social.colibri.message"),
      ).length;
      expect(channelCalls).toBe(1);

      // Re-requesting the same range fetches no further message pages (cached).
      await loadRange({ from: "2026-06-20", to: "2026-06-23" }, fetchStub);
      expect(
        calls.filter((u) => u.includes("social.colibri.message")).length,
      ).toBe(msgCallsAfterFirst);
      // Channels/reactions are never re-fetched.
      expect(
        calls.filter((u) => u.includes("social.colibri.channel")).length,
      ).toBe(1);
    });
  });

  describe("ConversationsViewer", () => {
    test("setFromRange updates the from date and requests a load", () => {
      const v = ConversationsViewer.make({
        fromDate: "2026-06-16",
        toDate: "2026-06-23",
      });
      const requested = [];
      const ctx = { request: (name, args) => requested.push([name, args]) };
      const next = ConversationsViewer.input.setFromRange.call(
        v,
        "2026-06-01",
        ctx,
      );
      expect(next.fromDate).toBe("2026-06-01");
      expect(next.loading).toBe(true);
      expect(requested).toEqual([
        ["loadRange", [{ from: "2026-06-01", to: "2026-06-23" }]],
      ]);
    });
    test("selecting a channel sets it active and filters", () => {
      const v = ConversationsViewer.Class.fromModel(MODEL);
      const id = v.channels.first().id;
      const next = ConversationsViewer.bubble.selectChannel.call(v, id, {});
      expect(next.selectedChannel).toBe(id);
      expect(next.channels.first().active).toBe(true);
    });
    test("matches keeps everything with no channel and no query", () => {
      const v = ConversationsViewer.Class.fromModel(MODEL);
      const msg = v.messages.first();
      expect(ConversationsViewer.alter.matches.call(v, 0, msg)).toBe(true);
    });
    test("Message.searchText includes nested reply text (thread scope)", () => {
      const v = ConversationsViewer.Class.fromModel(MODEL);
      const root = v.messages.first();
      // "Datalog" appears only in a reply, not in the root's own body.
      expect(root.body.segments.map((s) => s.text).join("")).not.toContain(
        "Datalog",
      );
      expect(root.searchText()).toContain("Datalog");
    });
    test("applyQuery matches a thread by reply text, clears on empty", () => {
      const v = ConversationsViewer.Class.fromModel(MODEL);
      const rootId = v.messages.first().id;
      const otherId = v.messages.get(1).id;
      const q = v.applyQuery("Datalog");
      expect(q.matchIds).not.toBe(null);
      expect(q.matchIds.has(rootId)).toBe(true);
      expect(q.matchIds.has(otherId)).toBe(false);
      // The combined filter keeps the matching thread and drops the other.
      expect(
        ConversationsViewer.alter.matches.call(q, 0, q.messages.first()),
      ).toBe(true);
      expect(
        ConversationsViewer.alter.matches.call(q, 1, q.messages.get(1)),
      ).toBe(false);
      // Empty query clears the filter entirely.
      expect(q.applyQuery("").matchIds).toBe(null);
    });
    test("default sort is newest-first by root createdAt", () => {
      const v = ConversationsViewer.Class.fromModel(MODEL);
      const dates = v.messages.toArray().map((m) => m.createdAt);
      expect(dates).toEqual([...dates].sort().reverse());
      expect(v.messages.first().createdAt).toBe(
        dates.reduce((a, b) => (a > b ? a : b)),
      );
    });
    test("toggleSort flips the flag and reverses to oldest-first", () => {
      const v = ConversationsViewer.Class.fromModel(MODEL); // newest-first
      const next = ConversationsViewer.input.toggleSort.call(v);
      expect(next.sortNewestFirst).toBe(false);
      const dates = next.messages.toArray().map((m) => m.createdAt);
      expect(dates).toEqual([...dates].sort());
      expect(next.messages.first().createdAt).toBe(
        dates.reduce((a, b) => (a < b ? a : b)),
      );
    });
    test("applyModel honors a preset oldest-first flag", () => {
      const v = ConversationsViewer.make({ sortNewestFirst: false }).applyModel(
        MODEL,
      );
      const dates = v.messages.toArray().map((m) => m.createdAt);
      expect(dates).toEqual([...dates].sort());
    });
  });
}
