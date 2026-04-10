#!/usr/bin/env node

import { WebClient, WebClientEvent } from "@slack/web-api";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, "..", "history");

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error("Error: SLACK_BOT_TOKEN environment variable is required.");
  process.exit(1);
}

const client = new WebClient(token);

client.on(WebClientEvent.RATE_LIMITED, (numSeconds, { url }) => {
  console.warn(`Rate limited on ${url}, retrying in ${numSeconds}s...`);
});

// -- Pagination helper --

async function collectPages(method, args, resultKey) {
  const items = [];
  let cursor;
  // method is "namespace.name" e.g. "users.list" -> client.users.list(...)
  const [ns, fn] = method.split(".");
  do {
    const result = await client[ns][fn]({ ...args, limit: 200, cursor });
    items.push(...(result[resultKey] || []));
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return items;
}

// -- Index helpers --

function updateIndex(filePath, newEntries) {
  let existing = { entries: [] };
  if (existsSync(filePath)) {
    existing = JSON.parse(readFileSync(filePath, "utf-8"));
  }
  const merged = [
    ...new Set([...existing.entries, ...newEntries]),
  ].sort((a, b) => a - b);
  writeFileSync(filePath, JSON.stringify({ entries: merged }, null, 2) + "\n");
}

// -- Date helpers --

function parseDate(str) {
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    console.error(`Invalid date format: ${str}. Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

function tsToUTCDate(ts) {
  return new Date(parseFloat(ts) * 1000);
}

function dayKey(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return { y, m, d, path: `${y}/${String(m).padStart(2, "0")}` };
}

// -- Subcommands --

async function fetchUsers(outPath) {
  console.log("Fetching users...");
  const members = await collectPages("users.list", {}, "members");
  writeFileSync(outPath, JSON.stringify(members, null, 4) + "\n");
  console.log(`Wrote ${members.length} users to ${outPath}`);
}

async function fetchChannels(outPath) {
  console.log("Fetching channels...");
  const channels = await collectPages(
    "conversations.list",
    { types: "public_channel" },
    "channels",
  );
  writeFileSync(outPath, JSON.stringify(channels, null, 4) + "\n");
  console.log(`Wrote ${channels.length} channels to ${outPath}`);
}

async function fetchMessages(startStr, endStr, outDir) {
  const startDate = parseDate(startStr);
  const endDate = parseDate(endStr);
  if (startDate > endDate) {
    console.error("Start date must be before or equal to end date.");
    process.exit(1);
  }

  const oldest = String(startDate.getTime() / 1000);
  // latest is exclusive — set to start of day after endDate
  const latestDate = new Date(endDate.getTime() + 86400000);
  const latest = String(latestDate.getTime() / 1000);

  // Load channels from the output directory
  const channelsPath = join(outDir, "channels.json");
  if (!existsSync(channelsPath)) {
    console.error(
      "channels.json not found. Run fetch-channels first.",
    );
    process.exit(1);
  }
  const channels = JSON.parse(readFileSync(channelsPath, "utf-8"));

  // Collect all messages across channels
  const allMessages = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    console.log(
      `Fetching #${ch.name} (${i + 1}/${channels.length})...`,
    );

    let channelMessages;
    try {
      channelMessages = await collectPages(
        "conversations.history",
        { channel: ch.id, oldest, latest },
        "messages",
      );
    } catch (err) {
      if (
        err.data?.error === "not_in_channel" ||
        err.data?.error === "channel_not_found"
      ) {
        console.warn(`  Skipping #${ch.name}: ${err.data.error}`);
        continue;
      }
      throw err;
    }

    console.log(`  ${channelMessages.length} messages`);

    // Tag messages with channel info
    for (const msg of channelMessages) {
      msg.channel_id = ch.id;
      msg.channel_name = ch.name;
    }

    // Fetch thread replies for messages that are thread parents
    const threadParents = channelMessages.filter(
      (m) => m.reply_count && m.reply_count > 0,
    );
    if (threadParents.length > 0) {
      console.log(`  Fetching replies for ${threadParents.length} threads...`);
    }

    for (const parent of threadParents) {
      let replies;
      try {
        replies = await collectPages(
          "conversations.replies",
          { channel: ch.id, ts: parent.ts, oldest, latest },
          "messages",
        );
      } catch (err) {
        console.warn(
          `  Warning: failed to fetch replies for thread ${parent.ts}: ${err.message}`,
        );
        continue;
      }
      // Skip the first message (it's the parent, already collected)
      for (const reply of replies) {
        if (reply.ts === parent.ts) continue;
        reply.channel_id = ch.id;
        reply.channel_name = ch.name;
        allMessages.push(reply);
      }
    }

    allMessages.push(...channelMessages);
  }

  console.log(`\nTotal: ${allMessages.length} messages`);

  // Bucket by day
  const dayBuckets = new Map();
  for (const msg of allMessages) {
    const date = tsToUTCDate(msg.ts);
    const key = dayKey(date);
    const bucketKey = `${key.y}/${key.m}/${key.d}`;
    if (!dayBuckets.has(bucketKey)) {
      dayBuckets.set(bucketKey, { ...key, messages: [] });
    }
    dayBuckets.get(bucketKey).messages.push(msg);
  }

  // Track which years and months were written
  const yearsWritten = new Set();
  const monthsWritten = new Map(); // "YYYY" -> Set of month numbers

  // Write day files
  for (const [bucketKey, bucket] of dayBuckets) {
    bucket.messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    const dirPath = join(outDir, bucket.path);
    mkdirSync(dirPath, { recursive: true });

    const filePath = join(dirPath, `${String(bucket.d).padStart(2, "0")}.json`);
    writeFileSync(
      filePath,
      JSON.stringify(bucket.messages, null, 2) + "\n",
    );
    console.log(
      `Wrote ${bucket.path}/${String(bucket.d).padStart(2, "0")}.json (${bucket.messages.length} messages)`,
    );

    yearsWritten.add(bucket.y);
    const yearKey = String(bucket.y);
    if (!monthsWritten.has(yearKey)) {
      monthsWritten.set(yearKey, new Map());
    }
    const monthMap = monthsWritten.get(yearKey);
    if (!monthMap.has(bucket.m)) {
      monthMap.set(bucket.m, new Set());
    }
    monthMap.get(bucket.m).add(bucket.d);
  }

  // Update index files
  for (const [yearStr, months] of monthsWritten) {
    for (const [month, days] of months) {
      const monthDir = join(
        outDir,
        yearStr,
        String(month).padStart(2, "0"),
      );
      updateIndex(join(monthDir, "index.json"), [...days]);
    }
    const yearDir = join(outDir, yearStr);
    updateIndex(join(yearDir, "index.json"), [...months.keys()]);
  }
  updateIndex(join(outDir, "index.json"), [...yearsWritten]);

  console.log("Index files updated.");
}

// -- CLI --

const DEFAULT_USERS_PATH = join(HISTORY_DIR, "users.json");
const DEFAULT_CHANNELS_PATH = join(HISTORY_DIR, "channels.json");

const [, , command, ...args] = process.argv;

switch (command) {
  case "fetch-users":
    await fetchUsers(args[0] || DEFAULT_USERS_PATH);
    break;
  case "fetch-channels":
    await fetchChannels(args[0] || DEFAULT_CHANNELS_PATH);
    break;
  case "fetch-messages":
    if (args.length < 2 || args.length > 3) {
      console.error(
        "Usage: dump-history.js fetch-messages <start-date> <end-date> [output-dir]",
      );
      process.exit(1);
    }
    await fetchMessages(args[0], args[1], args[2] || HISTORY_DIR);
    break;
  default:
    console.error(
      "Usage: dump-history.js <fetch-users|fetch-channels|fetch-messages>",
    );
    process.exit(1);
}
