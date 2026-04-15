#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { connect, Index } from "@lancedb/lancedb";
import { pipeline } from "@huggingface/transformers";

const pad = (n) => String(n).padStart(2, "0");

function walkDayFiles(rootDir, callback, { from, to } = {}) {
  const rootIndex = JSON.parse(
    readFileSync(join(rootDir, "index.json"), "utf-8"),
  );
  let dayFilesScanned = 0;

  for (const year of rootIndex.entries) {
    if (to && `${year}` > to.slice(0, 4)) continue;
    if (from && `${year}` < from.slice(0, 4)) continue;

    const yearIndexPath = join(rootDir, String(year), "index.json");
    if (!existsSync(yearIndexPath)) continue;
    const yearIndex = JSON.parse(readFileSync(yearIndexPath, "utf-8"));

    for (const month of yearIndex.entries) {
      const ym = `${year}-${pad(month)}`;
      if (to && ym > to.slice(0, 7)) continue;
      if (from && ym < from.slice(0, 7)) continue;

      const monthIndexPath = join(
        rootDir,
        String(year),
        pad(month),
        "index.json",
      );
      if (!existsSync(monthIndexPath)) continue;
      const monthIndex = JSON.parse(readFileSync(monthIndexPath, "utf-8"));

      for (const day of monthIndex.entries) {
        const dateStr = `${year}-${pad(month)}-${pad(day)}`;
        if (from && dateStr < from) continue;
        if (to && dateStr > to) continue;

        const relPath = `${year}/${pad(month)}/${pad(day)}.json`;
        const fullPath = join(rootDir, relPath);
        if (!existsSync(fullPath)) continue;

        const messages = JSON.parse(readFileSync(fullPath, "utf-8"));
        callback(messages, relPath);
        dayFilesScanned++;
      }
    }
  }

  return dayFilesScanned;
}

function readRepliesForDay(rootDir, relPath) {
  const repliesPath = join(rootDir, relPath.replace(/\.json$/, ".replies.json"));
  if (!existsSync(repliesPath)) return new Map();
  const replies = JSON.parse(readFileSync(repliesPath, "utf-8"));
  const byThread = new Map();
  for (const reply of replies) {
    if (!reply.thread_ts) continue;
    if (!byThread.has(reply.thread_ts)) byThread.set(reply.thread_ts, []);
    byThread.get(reply.thread_ts).push(reply);
  }
  return byThread;
}

function buildEntries(messages, repliesByThread) {
  const entries = [];
  for (const msg of messages) {
    const { ts, thread_ts: threadTs } = msg;
    if (threadTs !== undefined && ts !== threadTs) continue;

    const replies = repliesByThread.get(ts) || [];
    const replyTexts = replies.map((r) => r.text || "");
    const threadText = [msg.text || "", ...replyTexts].join("\n\n");

    entries.push({
      ts: msg.ts,
      text: msg.text || "",
      user: msg.user || "",
      channel_id: msg.channel_id || "",
      channel_name: msg.channel_name || "",
      thread_ts: msg.thread_ts || "",
      type: msg.type || "",
      reply_count: msg.reply_count || 0,
      thread_replies: JSON.stringify(replies),
      thread_text: threadText,
    });
  }
  return entries;
}

async function createEmbedder(modelName) {
  const extractor = await pipeline("feature-extraction", modelName, {
    dtype: "fp32",
  });

  return async function embed(texts) {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  };
}

async function main(rootDir, dbPath, tableName, modelName, { from, to } = {}) {
  console.log(`Model: ${modelName}`);
  if (from || to) console.log(`Date range: ${from || "start"} to ${to || "end"}`);
  console.log("Loading embedding model (first run downloads it)...");
  const embed = await createEmbedder(modelName);

  const absDbPath = resolve(dbPath);
  console.log(`Connecting to LanceDB at ${absDbPath}...`);
  const db = await connect(absDbPath);

  console.log("Collecting messages...");
  const allEntries = [];

  const dayFilesScanned = walkDayFiles(rootDir, (messages, relPath) => {
    const repliesByThread = readRepliesForDay(rootDir, relPath);
    const entries = buildEntries(messages, repliesByThread);
    allEntries.push(...entries);
  }, { from, to });

  console.log(`  ${dayFilesScanned} day files scanned`);
  console.log(`  ${allEntries.length} top-level messages collected`);

  if (allEntries.length === 0) {
    console.log("No messages found. Exiting.");
    return;
  }

  console.log("Embedding messages...");
  const BATCH_SIZE = 64;

  for (let i = 0; i < allEntries.length; i += BATCH_SIZE) {
    const batch = allEntries.slice(i, i + BATCH_SIZE);
    const texts = batch.map((e) => e.thread_text);
    const vectors = await embed(texts);

    for (let j = 0; j < batch.length; j++) {
      batch[j].vector = vectors[j];
    }

    const progress = Math.min(i + BATCH_SIZE, allEntries.length);
    console.log(`  Embedded ${progress}/${allEntries.length}`);
  }

  let table;
  try {
    table = await db.openTable(tableName);
    console.log(`Upserting ${allEntries.length} entries into table "${tableName}"...`);
    await table
      .mergeInsert("ts")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(allEntries);
  } catch {
    console.log(`Creating table "${tableName}" with ${allEntries.length} entries...`);
    table = await db.createTable(tableName, allEntries);
  }

  console.log("Creating full-text search index on thread_text...");
  await table.createIndex("thread_text", { config: Index.fts(), replace: true });

  console.log("Done.");
}

// -- CLI --

function parseArgs(argv) {
  const positional = [];
  const named = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--from" || argv[i] === "--to") {
      named[argv[i].slice(2)] = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, named };
}

const { positional, named } = parseArgs(process.argv);
const root = positional[0];
const dbPath = positional[1] || "db_data";
const tableName = positional[2] || "messages";
const modelName = positional[3] || "Xenova/all-MiniLM-L6-v2";
const from = named.from;
const to = named.to;

if (!root) {
  console.error(
    "Usage: history-to-lancedb.js <history-root-dir> [db-path] [table-name] [model-name] [--from YYYY-MM-DD] [--to YYYY-MM-DD]",
  );
  console.error("");
  console.error("  history-root-dir  Path to the history directory");
  console.error('  db-path           LanceDB directory (default: "db_data")');
  console.error('  table-name        Table name (default: "messages")');
  console.error(
    '  model-name        HuggingFace model (default: "Xenova/all-MiniLM-L6-v2")',
  );
  console.error("  --from            Start date inclusive (YYYY-MM-DD)");
  console.error("  --to              End date inclusive (YYYY-MM-DD)");
  process.exit(1);
}

if (!existsSync(join(root, "index.json"))) {
  console.error(`index.json not found in ${root}`);
  process.exit(1);
}

main(root, dbPath, tableName, modelName, { from, to });
