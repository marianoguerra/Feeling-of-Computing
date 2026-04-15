#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const pad = (n) => String(n).padStart(2, "0");

function walkDayFiles(rootDir, callback) {
  const rootIndex = JSON.parse(
    readFileSync(join(rootDir, "index.json"), "utf-8"),
  );
  let dayFilesScanned = 0;

  for (const year of rootIndex.entries) {
    const yearIndexPath = join(rootDir, String(year), "index.json");
    if (!existsSync(yearIndexPath)) continue;
    const yearIndex = JSON.parse(readFileSync(yearIndexPath, "utf-8"));

    for (const month of yearIndex.entries) {
      const monthIndexPath = join(
        rootDir,
        String(year),
        pad(month),
        "index.json",
      );
      if (!existsSync(monthIndexPath)) continue;
      const monthIndex = JSON.parse(readFileSync(monthIndexPath, "utf-8"));

      for (const day of monthIndex.entries) {
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

// -- CLI --

const root = process.argv[2];
if (!root) {
  console.error("Usage: index-replies.js <history-root-dir>");
  process.exit(1);
}

if (!existsSync(join(root, "index.json"))) {
  console.error(`index.json not found in ${root}`);
  process.exit(1);
}

// Pass 1: build parent index
console.log("Pass 1: indexing thread parents...");
const parentIndex = new Map();

walkDayFiles(root, (messages, relPath) => {
  for (const msg of messages) {
    if (msg.reply_count > 0) {
      parentIndex.set(msg.ts, relPath);
    }
  }
});

console.log(`  ${parentIndex.size} thread parents found`);

// Pass 2: collect replies
console.log("Pass 2: collecting replies...");
const repliesByDay = new Map();
let replyCount = 0;
let orphanCount = 0;

const dayFilesScanned = walkDayFiles(root, (messages, relPath) => {
  for (const msg of messages) {
    if (msg.thread_ts && msg.thread_ts !== msg.ts) {
      const parentDay = parentIndex.get(msg.thread_ts);
      if (parentDay) {
        if (!repliesByDay.has(parentDay)) repliesByDay.set(parentDay, []);
        repliesByDay.get(parentDay).push(msg);
        replyCount++;
      } else {
        orphanCount++;
      }
    }
  }
});

console.log(`  ${replyCount} replies collected`);
if (orphanCount > 0) {
  console.warn(`  ${orphanCount} orphan replies (parent not found)`);
}

// Write .replies.json files
let filesWritten = 0;
for (const [dayPath, replies] of repliesByDay) {
  replies.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  const outPath = join(root, dayPath.replace(/\.json$/, ".replies.json"));
  writeFileSync(outPath, JSON.stringify(replies, null, 2) + "\n");
  filesWritten++;
}

console.log(
  `\nDone. ${dayFilesScanned} day files scanned, ${filesWritten} .replies.json files written.`,
);
