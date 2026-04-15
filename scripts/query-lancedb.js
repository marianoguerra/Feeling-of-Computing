#!/usr/bin/env node

import { resolve } from "node:path";
import { connect } from "@lancedb/lancedb";
import { pipeline } from "@huggingface/transformers";

async function createEmbedder(modelName) {
  const extractor = await pipeline("feature-extraction", modelName, {
    dtype: "fp32",
  });

  return async function embed(texts) {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  };
}

async function main(query, dbPath, tableName, modelName, limit) {
  const embed = await createEmbedder(modelName);

  const absDbPath = resolve(dbPath);
  const db = await connect(absDbPath);
  const table = await db.openTable(tableName);

  const [queryVector] = await embed([query]);

  const ftsResults = await table
    .search(query, "fts")
    .select(["ts"])
    .limit(limit * 2)
    .toArray();

  const vectorResults = await table
    .search(queryVector)
    .select(["ts"])
    .limit(limit * 2)
    .toArray();

  const scoreMap = new Map();
  const maxEntries = Math.max(ftsResults.length, vectorResults.length) || 1;

  for (let i = 0; i < ftsResults.length; i++) {
    const ts = ftsResults[i].ts;
    const score = 1 - i / maxEntries;
    scoreMap.set(ts, (scoreMap.get(ts) || 0) + score);
  }

  for (let i = 0; i < vectorResults.length; i++) {
    const ts = vectorResults[i].ts;
    const score = 1 - i / maxEntries;
    scoreMap.set(ts, (scoreMap.get(ts) || 0) + score);
  }

  const topTs = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ts]) => ts);

  if (topTs.length === 0) {
    console.log("No results found.");
    return;
  }

  const filter = topTs.map((ts) => `ts = '${ts}'`).join(" OR ");
  const rows = await table.query().where(filter).limit(limit).toArray();

  const rowsByTs = new Map(rows.map((r) => [r.ts, r]));

  console.log(`\n${topTs.length} results for: "${query}"\n`);

  for (const ts of topTs) {
    const row = rowsByTs.get(ts);
    if (!row) continue;

    const date = new Date(parseFloat(ts) * 1000);
    const dateStr = date.toISOString().slice(0, 16).replace("T", " ");
    const score = scoreMap.get(ts).toFixed(3);

    console.log(`--- [${dateStr}] #${row.channel_name} (score: ${score}) ---`);
    console.log(row.text);
    if (row.reply_count > 0) {
      console.log(`  (${row.reply_count} replies)`);
    }
    console.log();
  }
}

// -- CLI --

function parseArgs(argv) {
  const positional = [];
  const named = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--db-path") {
      named.dbPath = argv[++i];
    } else if (argv[i] === "--table") {
      named.tableName = argv[++i];
    } else if (argv[i] === "--model") {
      named.modelName = argv[++i];
    } else if (argv[i] === "--limit") {
      named.limit = parseInt(argv[++i], 10);
    } else {
      positional.push(argv[i]);
    }
  }
  return { positional, named };
}

const { positional, named } = parseArgs(process.argv);
const query = positional[0];
const dbPath = named.dbPath || "db_data";
const tableName = named.tableName || "messages";
const modelName = named.modelName || "Xenova/all-MiniLM-L6-v2";
const limit = named.limit || 10;

if (!query) {
  console.error(
    'Usage: query-lancedb.js <query> [--db-path PATH] [--table NAME] [--model NAME] [--limit N]',
  );
  console.error("");
  console.error("  query       Search query text");
  console.error('  --db-path   LanceDB directory (default: "db_data")');
  console.error('  --table     Table name (default: "messages")');
  console.error(
    '  --model     HuggingFace model (default: "Xenova/all-MiniLM-L6-v2")',
  );
  console.error("  --limit     Number of results (default: 10)");
  process.exit(1);
}

main(query, dbPath, tableName, modelName, limit);
