#!/usr/bin/env node

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const pad = (n) => String(n).padStart(2, "0");

function walkDayFiles(rootDir, callback, { from, to } = {}) {
  const rootIndex = JSON.parse(
    readFileSync(join(rootDir, "index.json"), "utf-8"),
  );

  for (const year of rootIndex.entries) {
    if (to && `${year}` < to.slice(0, 4)) continue;
    if (from && `${year}` > from.slice(0, 4)) continue;

    const yearIndexPath = join(rootDir, String(year), "index.json");
    if (!existsSync(yearIndexPath)) continue;
    const yearIndex = JSON.parse(readFileSync(yearIndexPath, "utf-8"));

    for (const month of yearIndex.entries) {
      const ym = `${year}-${pad(month)}`;
      if (to && ym < to.slice(0, 7)) continue;
      if (from && ym > from.slice(0, 7)) continue;

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

        const repliesPath = fullPath.replace(/\.json$/, ".replies.json");
        if (existsSync(repliesPath)) {
          const replies = JSON.parse(readFileSync(repliesPath, "utf-8"));
          callback(replies, relPath.replace(/\.json$/, ".replies.json"));
        }
      }
    }
  }
}

function extractFiles(rootDir, { from, to } = {}) {
  const seen = new Set();
  const files = [];

  walkDayFiles(
    rootDir,
    (messages) => {
      for (const msg of messages) {
        if (!msg.files) continue;
        for (const f of msg.files) {
          if (!f.id || seen.has(f.id)) continue;
          seen.add(f.id);
          const url = f.url_private_download || f.url_private;
          files.push({
            id: f.id,
            name: f.name || f.id,
            filetype: f.filetype || "unknown",
            url: url || null,
          });
        }
      }
    },
    { from, to },
  );

  return files;
}

async function downloadAttachments(rootDir, outputDir, token, { from, to } = {}) {
  const files = extractFiles(rootDir, { from, to });
  console.log(`Found ${files.length} unique files`);

  let downloaded = 0;
  let skippedExists = 0;
  let skippedNoUrl = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const prefix = `[${i + 1}/${files.length}]`;

    if (!f.url) {
      console.log(`${prefix} skip (no url): ${f.name}`);
      skippedNoUrl++;
      continue;
    }

    const shard = f.id.slice(0, 3);
    const shardDir = join(outputDir, shard);
    const filename = `${f.id}.${f.filetype}`;
    const filePath = join(shardDir, filename);

    if (existsSync(filePath)) {
      skippedExists++;
      continue;
    }

    mkdirSync(shardDir, { recursive: true });

    try {
      const res = await fetch(f.url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.log(`${prefix} error (${res.status}): ${f.name}`);
        errors++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(filePath, buf);
      downloaded++;
      console.log(`${prefix} downloaded: ${f.name}`);
    } catch (err) {
      console.log(`${prefix} error: ${f.name} — ${err.message}`);
      errors++;
    }
  }

  console.log(
    `\nDone: ${downloaded} downloaded, ${skippedExists} already existed, ${skippedNoUrl} no url, ${errors} errors`,
  );
}

// --- CLI ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" || args[i] === "--to") {
      flags[args[i].slice(2)] = args[++i];
    } else {
      positional.push(args[i]);
    }
  }

  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv);

if (positional.length < 2) {
  console.error(
    "Usage: download-attachments.js <history-dir> <output-dir> [--from YYYY-MM-DD] [--to YYYY-MM-DD]\n" +
      "  SLACK_BOT_TOKEN env var required",
  );
  process.exit(1);
}

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error("SLACK_BOT_TOKEN environment variable is required");
  process.exit(1);
}

const rootDir = resolve(positional[0]);
const outputDir = resolve(positional[1]);

await downloadAttachments(rootDir, outputDir, token, {
  from: flags.from,
  to: flags.to,
});
