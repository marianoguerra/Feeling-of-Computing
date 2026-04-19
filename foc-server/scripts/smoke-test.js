#!/usr/bin/env bun
// Usage:
//   bun scripts/smoke-test.js [query] [limit]
// Env:
//   BASE_URL  (default: http://127.0.0.1:3000)

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const QUERY = process.argv[2] ?? "hello world";
const LIMIT = Number(process.argv[3] ?? 3);

const DIM = "\x1b[2m";
const OFF = "\x1b[0m";
const OK = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

let failures = 0;

async function step(label, fn) {
  const t0 = performance.now();
  process.stdout.write(`${DIM}→${OFF} ${label} ... `);
  try {
    const result = await fn();
    const ms = (performance.now() - t0).toFixed(0);
    console.log(`${OK} ${DIM}(${ms}ms)${OFF}`);
    return result;
  } catch (err) {
    const ms = (performance.now() - t0).toFixed(0);
    console.log(`${FAIL} ${DIM}(${ms}ms)${OFF}`);
    console.error(`  ${err.message}`);
    failures++;
    return null;
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return await res.text();
}

async function search(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`POST ${path} → non-JSON body: ${text.slice(0, 200)}`);
  }
}

function preview(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "  (no rows)";
  return rows
    .slice(0, 3)
    .map((r, i) => {
      const short = Object.fromEntries(
        Object.entries(r).map(([k, v]) => {
          if (Array.isArray(v) && v.length > 8) return [k, `<vec len=${v.length}>`];
          if (typeof v === "string" && v.length > 120) return [k, v.slice(0, 117) + "..."];
          return [k, v];
        }),
      );
      return `    [${i}] ${JSON.stringify(short)}`;
    })
    .join("\n");
}

console.log(`${DIM}base:${OFF}  ${BASE}`);
console.log(`${DIM}query:${OFF} ${JSON.stringify(QUERY)}`);
console.log(`${DIM}limit:${OFF} ${LIMIT}`);
console.log();

await step("GET  /health", async () => {
  const body = await get("/health");
  if (body.trim() !== "ok") throw new Error(`expected "ok", got ${JSON.stringify(body)}`);
});

const fts = await step("POST /search/fts", async () => {
  const body = await search("/search/fts", { query: QUERY, limit: LIMIT });
  if (!body || !Array.isArray(body.rows)) throw new Error(`missing rows[]: ${JSON.stringify(body)}`);
  return body;
});
if (fts) console.log(`${DIM}    rows: ${fts.rows.length}${OFF}\n${preview(fts.rows)}`);

const vec = await step("POST /search/vector", async () => {
  const body = await search("/search/vector", { query: QUERY, limit: LIMIT });
  if (!body || !Array.isArray(body.rows)) throw new Error(`missing rows[]: ${JSON.stringify(body)}`);
  return body;
});
if (vec) console.log(`${DIM}    rows: ${vec.rows.length}${OFF}\n${preview(vec.rows)}`);

const hyb = await step("POST /search/hybrid", async () => {
  const body = await search("/search/hybrid", { query: QUERY, limit: LIMIT });
  if (!body || !Array.isArray(body.rows)) throw new Error(`missing rows[]: ${JSON.stringify(body)}`);
  return body;
});
if (hyb) console.log(`${DIM}    rows: ${hyb.rows.length}${OFF}\n${preview(hyb.rows)}`);

console.log();
if (failures > 0) {
  console.log(`${FAIL} ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`${OK} all checks passed`);
