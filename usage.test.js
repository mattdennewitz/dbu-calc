import test from "node:test";
import assert from "node:assert/strict";
import { parseUsage, summarizeUsage } from "./usage.js";
import { toCsv } from "./scripts/openrouter-usage.mjs";
const row = {
  date: "2026-09-30 00:00:00",
  model: "anthropic/claude-sonnet-4.5",
  key_name: 'Team, "A"\nProduction',
  prompt_tokens: 1000,
  completion_tokens: 200,
  reasoning_tokens: 50,
  cached_tokens: 400,
  spend_usd: 0.01,
  byok_spend_usd: 0,
};
test("script CSV with embedded quotes and newlines imports like JSON", () => {
  const csv = parseUsage(toCsv([row]));
  const json = parseUsage(JSON.stringify({ rows: [row] }));
  assert.equal(csv[0].key_name, row.key_name);
  assert.deepEqual(summarizeUsage(csv), summarizeUsage(json));
});
test("cache is removed from prompt and reasoning is not double counted", () => {
  const summary = summarizeUsage(parseUsage(JSON.stringify([row, row])));
  assert.deepEqual(summary.tokens, {
    input: 1200,
    output: 400,
    cacheRead: 800,
    cacheWrite: 0,
  });
  assert.equal(summary.spend, 0.02);
  assert.equal(summary.error, null);
});
test("missing cache counts block; response-cache counters produce a directional estimate", () => {
  assert.match(
    summarizeUsage(
      parseUsage(JSON.stringify([{ ...row, cached_tokens: null }])),
    ).error,
    /lack/,
  );
  const replay = summarizeUsage(
    parseUsage(JSON.stringify([{ ...row, cached_tokens: 1100 }])),
  );
  assert.equal(replay.error, null);
  assert.equal(replay.tokens.input, 0);
  assert.equal(replay.tokens.cacheRead, 1100);
  assert.match(replay.warnings.join(" "), /possible response-cache replay/);
});
test("missing spend stays unknown, malformed counts are rejected", () => {
  assert.equal(
    summarizeUsage(parseUsage(JSON.stringify([{ ...row, spend_usd: null }])))
      .spend,
    null,
  );
  assert.throws(
    () => parseUsage(JSON.stringify([{ ...row, prompt_tokens: -1 }])),
    /invalid prompt_tokens/,
  );
});
