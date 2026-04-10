import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { pad, walk } from "../src/indexloader.js";

function fileFetcher(basePath) {
  const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
  return {
    fetchRootIndex: () => readJson(path.join(basePath, "index.json")),
    fetchYearIndex: (year) => readJson(path.join(basePath, String(year), "index.json")),
    fetchMonthIndex: (year, month) =>
      readJson(path.join(basePath, String(year), pad(month), "index.json")),
    fetchDay: (year, month, day) =>
      readJson(path.join(basePath, String(year), pad(month), `${pad(day)}.json`)),
  };
}

const BASE = "../history";

describe("walk", () => {
  it("walks a single day", async () => {
    const fetcher = fileFetcher(BASE);
    const results = [];
    await walk(fetcher, new Date(Date.UTC(2026, 3, 10)), new Date(Date.UTC(2026, 3, 10)), (data) =>
      results.push(data),
    );
    assert.equal(results.length, 1);
    assert.ok(Array.isArray(results[0]));
    assert.ok(results[0].length > 0);
    assert.ok(results[0][0].ts);
  });

  it("walks a date range within a month", async () => {
    const fetcher = fileFetcher(BASE);
    const results = [];
    await walk(fetcher, new Date(Date.UTC(2026, 3, 1)), new Date(Date.UTC(2026, 3, 5)), (data) =>
      results.push(data),
    );
    assert.ok(results.length > 0);
    for (const day of results) {
      assert.ok(Array.isArray(day));
      for (const msg of day) {
        const d = new Date(parseFloat(msg.ts) * 1000);
        assert.ok(d.getUTCMonth() === 3);
        assert.ok(d.getUTCDate() >= 1 && d.getUTCDate() <= 5);
      }
    }
  });

  it("walks across months", async () => {
    const fetcher = fileFetcher(BASE);
    const results = [];
    await walk(fetcher, new Date(Date.UTC(2026, 2, 25)), new Date(Date.UTC(2026, 3, 5)), (data) =>
      results.push(data),
    );
    assert.ok(results.length > 0);
    const months = new Set();
    for (const day of results) {
      for (const msg of day) {
        months.add(new Date(parseFloat(msg.ts) * 1000).getUTCMonth());
      }
    }
    assert.ok(months.size >= 2, "should span at least 2 months");
  });

  it("walks across years", async () => {
    const fetcher = fileFetcher(BASE);
    const results = [];
    await walk(fetcher, new Date(Date.UTC(2025, 11, 25)), new Date(Date.UTC(2026, 0, 5)), (data) =>
      results.push(data),
    );
    assert.ok(results.length > 0);
    const years = new Set();
    for (const day of results) {
      for (const msg of day) {
        years.add(new Date(parseFloat(msg.ts) * 1000).getUTCFullYear());
      }
    }
    assert.ok(years.size === 2, "should span 2 years");
  });

  it("returns days in calendar order", async () => {
    const fetcher = fileFetcher(BASE);
    const timestamps = [];
    await walk(fetcher, new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 3, 10)), (data) => {
      if (data.length > 0) timestamps.push(parseFloat(data[0].ts));
    });
    assert.ok(timestamps.length > 1);
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(timestamps[i] > timestamps[i - 1], `day ${i} should be after day ${i - 1}`);
    }
  });

  it("returns empty for a range with no data", async () => {
    const fetcher = fileFetcher(BASE);
    const results = [];
    await walk(fetcher, new Date(Date.UTC(2099, 0, 1)), new Date(Date.UTC(2099, 0, 31)), (data) =>
      results.push(data),
    );
    assert.equal(results.length, 0);
  });

  it("messages have channel_name and channel_id", async () => {
    const fetcher = fileFetcher(BASE);
    const results = [];
    await walk(fetcher, new Date(Date.UTC(2026, 3, 10)), new Date(Date.UTC(2026, 3, 10)), (data) =>
      results.push(data),
    );
    for (const msg of results[0]) {
      assert.ok(msg.channel_name, "should have channel_name");
      assert.ok(msg.channel_id, "should have channel_id");
    }
  });
});
