import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { analyze, loadConfig, normalizeUrl, parseUrlLines } from "../src/core.js";

const config = loadConfig(path.resolve("config/default.json"));

test("parses lines and removes duplicates", () => assert.deepEqual(parseUrlLines("URL\n/a\n/a\n/b,spam"), ["/a", "/b"]));
test("normalizes local paths and rejects outside domains", () => {
  assert.equal(normalizeUrl("/casino-test/#x", config.siteOrigin).url, "https://ppcguru.ca/casino-test/");
  assert.equal(normalizeUrl("https://evil.example/casino", config.siteOrigin).reason, "outside-site");
});
test("keywords alone cannot approve removal", async () => {
  const report = await analyze("/casino-slots-bonus-1/", config);
  assert.equal(report.items[0].decision, "manual-review");
});
test("protected legitimate section wins over keywords", async () => {
  const url = "https://ppcguru.ca/blog/google-ads-for-casino-businesses/";
  const report = await analyze(url, config, { statuses: { [url]: 410 } });
  assert.equal(report.items[0].decision, "protected");
});
test("groups confirmed gone high-confidence URLs", async () => {
  const urls = [1, 2, 3].map((n) => `https://ppcguru.ca/casino-spam-${n}/`);
  const statuses = Object.fromEntries(urls.map((url) => [url, 410]));
  const report = await analyze(urls.join("\n"), config, { statuses });
  assert.equal(report.summary["ready-for-approval"], 3);
  assert.equal(report.prefixes.suggestions[0].prefix, "/casino-spam-");
});
