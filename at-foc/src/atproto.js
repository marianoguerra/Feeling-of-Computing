// AT Protocol data layer for the Feeling-of-Computing Colibri mirror.
//
// The bridge bot writes `social.colibri.message` / `social.colibri.reaction`
// records to its PDS; the community owner holds `social.colibri.channel`
// (and category/community) records. listRecords has no server-side filter and
// CORS is open, so we fetch whole collections client-side and group them into
// the denormalized tree the components render. See the plan/wiki PR #21.

// --- identities & hosts (resolved once via plc.directory, hardcoded here) ---
export const BOT_DID = "did:plc:4gcxakknd6hxtnhf33miwsob";
export const BOT_PDS = "https://jellybaby.us-east.host.bsky.network";
export const OWNER_DID = "did:plc:j7nm3lrd5h7fm3sfhcv3lhfv";
export const OWNER_PDS = "https://earthstar.us-east.host.bsky.network";

export const COMMUNITY_NAME = "Feeling of Computing";

const rkeyOf = (uri) => uri.split("/").pop();

// Page through com.atproto.repo.listRecords until the cursor runs out.
async function listAll(pds, repo, collection, fetchImpl = fetch) {
  const out = [];
  let cursor = "";
  do {
    const url =
      `${pds}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(repo)}` +
      `&collection=${encodeURIComponent(collection)}&limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${collection}: HTTP ${res.status}`);
    const data = await res.json();
    out.push(...(data.records || []));
    cursor = data.cursor || "";
  } while (cursor);
  return out;
}

// --- rich text: facet byte-ranges -> flat list of styled segments ----------

function featureFlags(features) {
  const seg = {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    mention: false,
    channel: false,
    link: false,
    url: "",
  };
  for (const f of features || []) {
    const t = (f.$type || "").split("#")[1] || "";
    if (t === "bold") seg.bold = true;
    else if (t === "italic") seg.italic = true;
    else if (t === "strikethrough" || t === "strike") seg.strike = true;
    else if (t === "code") seg.code = true;
    else if (t === "mention") seg.mention = true;
    else if (t === "channel") seg.channel = true;
    else if (t === "link") {
      seg.link = true;
      seg.url = f.uri || "";
    }
  }
  return seg;
}

// Split `text` into non-overlapping segments at UTF-8 byte boundaries given by
// `facets`. Bytes not covered by any facet become plain segments.
export function textToSegments(text, facets) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(text);
  const plain = (s) => ({ text: s, ...featureFlags([]) });
  const fs = (facets || [])
    .filter((f) => f?.index)
    .slice()
    .sort((a, b) => a.index.byteStart - b.index.byteStart);

  const segs = [];
  let cur = 0;
  for (const f of fs) {
    const s = f.index.byteStart;
    const e = f.index.byteEnd;
    if (s < cur || e > bytes.length || s >= e) continue; // skip overlap/invalid
    if (s > cur) segs.push(plain(dec.decode(bytes.slice(cur, s))));
    segs.push({
      text: dec.decode(bytes.slice(s, e)),
      ...featureFlags(f.features),
    });
    cur = e;
  }
  if (cur < bytes.length) segs.push(plain(dec.decode(bytes.slice(cur))));
  if (segs.length === 0) segs.push(plain(text));
  return segs;
}

// The bridge encodes the original speaker as a leading `@Name: ` in the text
// (with a mention facet over it once a DID is claimed). Pull the author out and
// shift the remaining facets back by the prefix's byte length.
export function splitAuthor(text, facets) {
  const m = text.match(/^@([^:\n]{1,80}):[ \t]?/);
  if (!m) return { author: "", body: text, facets: facets || [] };
  const cutBytes = new TextEncoder().encode(m[0]).length;
  const body = text.slice(m[0].length);
  const shifted = (facets || [])
    .map((f) => ({
      ...f,
      index: {
        byteStart: f.index.byteStart - cutBytes,
        byteEnd: f.index.byteEnd - cutBytes,
      },
    }))
    .filter(
      (f) => f.index.byteStart >= 0 && f.index.byteEnd > f.index.byteStart,
    );
  return { author: m[1].trim(), body, facets: shifted };
}

// --- model assembly --------------------------------------------------------

// Turn raw listRecords arrays into { community, channels, messages } where each
// root message carries its reactions and nested replies. Pure & sync so it is
// reused by both the live request handler and the offline fixtures/tests.
export function buildModel({ channels = [], messages = [], reactions = [] }) {
  const chan = channels.map((r) => ({
    id: rkeyOf(r.uri),
    name: r.value.name,
  }));
  const chanName = new Map(chan.map((c) => [c.id, c.name]));

  const reByMsg = new Map();
  for (const r of reactions) {
    const t = r.value.targetMessage;
    const counts = reByMsg.get(t) || new Map();
    counts.set(r.value.emoji, (counts.get(r.value.emoji) || 0) + 1);
    reByMsg.set(t, counts);
  }

  const raw = messages.map((r) => ({ id: rkeyOf(r.uri), ...r.value }));

  const toObj = (m) => {
    const { author, body, facets } = splitAuthor(m.text || "", m.facets);
    const counts = reByMsg.get(m.id);
    return {
      id: m.id,
      author,
      segments: textToSegments(body, facets),
      channel: m.channel || "",
      channelName: chanName.get(m.channel) || m.channel || "",
      createdAt: m.createdAt || "",
      reactions: counts
        ? [...counts.entries()].map(([emoji, count]) => ({ emoji, count }))
        : [],
      replies: [],
    };
  };

  const objById = new Map(raw.map((m) => [m.id, toObj(m)]));
  const roots = [];
  for (const m of raw) {
    const obj = objById.get(m.id);
    const parent = m.parent;
    if (parent && parent !== m.id && objById.has(parent)) {
      objById.get(parent).replies.push(obj);
    } else {
      roots.push(obj);
    }
  }

  const byTime = (a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  roots.sort((a, b) => -byTime(a, b)); // newest threads first
  for (const r of roots) r.replies.sort(byTime); // replies oldest-first

  return { community: COMMUNITY_NAME, channels: chan, messages: roots };
}

// --- incremental date-range loading ---------------------------------------
//
// Messages and reactions are loaded in whole-day windows. We keep every fetched
// record plus the set of day-intervals already covered, so changing the range
// only fetches the subranges not yet loaded. Channels (a handful of records)
// are fetched once and cached.
//
// listRecords has no server-side filter, but the bot's record keys are TIDs
// (13 base32-sortable chars encoding microseconds since the epoch << 10 plus
// a clock id): a message's rkey matches its createdAt to the millisecond, and
// a reaction's rkey is its target message's rkey with a different 2-char
// suffix, so both collections sort by *message* time. The PDS accepts any
// rkey-shaped string as `cursor` and returns the records below it,
// newest-first. A day window is therefore fetched by starting the cursor at
// the TID of the day after the window and stopping as soon as a record falls
// before the window start — never walking the whole collection (the mirror
// holds the full history back to 2021: tens of thousands of reactions).

const DAY_MS = 86400000;

// "YYYY-MM-DD" <-> integer day number (UTC midnight epoch days).
export function dayNum(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
export function dayStr(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

// Merge inclusive {a,b} day-intervals, joining overlapping or adjacent ones.
export function mergeIntervals(list) {
  const sorted = list.slice().sort((x, y) => x.a - y.a);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.a <= last.b + 1) last.b = Math.max(last.b, iv.b);
    else out.push({ a: iv.a, b: iv.b });
  }
  return out;
}

// The parts of inclusive {a,b} `range` not covered by `covered` intervals.
export function missingIntervals(range, covered) {
  const gaps = [];
  let cur = range.a;
  for (const iv of mergeIntervals(covered)) {
    if (iv.b < cur) continue;
    if (iv.a > range.b) break;
    if (iv.a > cur) gaps.push({ a: cur, b: Math.min(iv.a - 1, range.b) });
    cur = Math.max(cur, iv.b + 1);
    if (cur > range.b) break;
  }
  if (cur <= range.b) gaps.push({ a: cur, b: range.b });
  return gaps;
}

// TID for UTC midnight of day number `n` (clock-id bits zero). Used as the
// exclusive upper cursor / inclusive lower bound of a day window. BigInt since
// microseconds << 10 overflows 2^53.
const TID_CHARS = "234567abcdefghijklmnopqrstuvwxyz";
export function dayToTid(n) {
  let v = (BigInt(n) * BigInt(DAY_MS) * 1000n) << 10n;
  let out = "";
  for (let i = 0; i < 13; i++) {
    out = TID_CHARS[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

// Accumulating store, shared across loadRange calls for the page session.
const rangeCache = {
  channels: null,
  messages: new Map(), // rkey -> record { uri, value }
  reactions: new Map(), // rkey -> record { uri, value }
  loaded: [], // merged covered day-intervals {a,b}
};

// Exposed for tests so each case starts from a clean cache.
export function resetRangeCache() {
  rangeCache.channels = null;
  rangeCache.messages = new Map();
  rangeCache.reactions = new Map();
  rangeCache.loaded = [];
}

// Page newest-first through a bot collection starting below `startCursor`,
// handing each record to `keep`; stop paging as soon as `keep` returns false.
async function pageBelow(collection, startCursor, keep, fetchImpl) {
  let cursor = startCursor;
  do {
    const url =
      `${BOT_PDS}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(BOT_DID)}` +
      `&collection=${encodeURIComponent(collection)}&limit=100` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${collection}: HTTP ${res.status}`);
    const data = await res.json();
    for (const rec of data.records || []) if (!keep(rec)) return;
    cursor = data.cursor || "";
  } while (cursor);
}

// Messages whose createdAt day falls in [aDay, bDay]. The cursor starts at the
// top of the window; createdAt is still checked (not just the rkey) so a record
// whose key disagrees with its timestamp is skipped rather than misfiled.
async function fetchMessagesInDays(aDay, bDay, fetchImpl) {
  const fromStr = dayStr(aDay);
  const toStr = dayStr(bDay);
  await pageBelow(
    "social.colibri.message",
    dayToTid(bDay + 1),
    (rec) => {
      const day = (rec.value.createdAt || "").slice(0, 10);
      if (day && day < fromStr) return false; // older than the window — stop
      if (!day || day <= toStr) rangeCache.messages.set(rkeyOf(rec.uri), rec);
      return true;
    },
    fetchImpl,
  );
}

// Reactions targeting messages of [aDay, bDay]. Reaction rkeys share their
// target message's TID prefix, so the same cursor window applies; the stop
// test uses the target rkey itself so it holds even if a reaction's own key
// were minted later.
async function fetchReactionsInDays(aDay, bDay, fetchImpl) {
  const floor = dayToTid(aDay);
  await pageBelow(
    "social.colibri.reaction",
    dayToTid(bDay + 1),
    (rec) => {
      const target = rec.value.targetMessage || "";
      if (target && target < floor) return false;
      rangeCache.reactions.set(rkeyOf(rec.uri), rec);
      return true;
    },
    fetchImpl,
  );
}

// Load (only) the day-subranges of [from, to] not already cached, then return
// the visible model for the whole [from, to] window from the merged cache.
export async function loadRange({ from, to }, fetchImpl = fetch) {
  const range = { a: dayNum(from), b: dayNum(to) };
  const gaps = missingIntervals(range, rangeCache.loaded);
  const jobs = gaps.flatMap((gap) => [
    fetchMessagesInDays(gap.a, gap.b, fetchImpl),
    fetchReactionsInDays(gap.a, gap.b, fetchImpl),
  ]);
  if (!rangeCache.channels) {
    jobs.push(
      listAll(OWNER_PDS, OWNER_DID, "social.colibri.channel", fetchImpl).then(
        (channels) => {
          rangeCache.channels = channels;
        },
      ),
    );
  }
  await Promise.all(jobs);
  rangeCache.loaded = mergeIntervals([...rangeCache.loaded, ...gaps]);
  const visible = [...rangeCache.messages.values()].filter((rec) => {
    const day = (rec.value.createdAt || "").slice(0, 10);
    return day >= from && day <= to;
  });
  return buildModel({
    channels: rangeCache.channels,
    messages: visible,
    reactions: [...rangeCache.reactions.values()],
  });
}

export function getRequestHandlers() {
  return {
    async loadRange(args) {
      return loadRange(args);
    },
  };
}
