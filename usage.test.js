import test from "node:test";
import assert from "node:assert/strict";
import { parseUsage, summarizeUsage, breakdownUsage } from "./usage.js";
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

test("spend breakdown keeps provider/model pairs separate and includes free usage", () => {
  const data = parseUsage(
    JSON.stringify([
      {
        ...row,
        provider_name: "OpenAI",
        model: "openai/gpt",
        spend_usd: 2,
        requests: 3,
      },
      {
        ...row,
        provider_name: "OpenAI",
        model: "openai/gpt",
        spend_usd: 1,
        requests: 2,
      },
      {
        ...row,
        provider_name: "Azure",
        model: "openai/gpt",
        spend_usd: 4,
        requests: 1,
      },
      {
        ...row,
        provider_name: "DeepSeek",
        model: "deepseek/model",
        spend_usd: 0,
        requests: 7,
      },
    ]),
  );
  const groups = breakdownUsage(data);
  assert.deepEqual(
    groups.map((g) => [g.provider, g.model, g.spend_usd, g.requests]),
    [
      ["Azure", "openai/gpt", 4, 1],
      ["OpenAI", "openai/gpt", 3, 5],
      ["DeepSeek", "deepseek/model", 0, 7],
    ],
  );
  assert.equal(
    groups.reduce((total, group) => total + group.spend_usd, 0),
    summarizeUsage(data).spend,
  );
  assert.equal(groups[1].prompt_tokens, 2000);
});

test("unknown group spend cannot be misrepresented as a partial or zero total", () => {
  const data = parseUsage(
    JSON.stringify([
      { ...row, provider_name: "OpenAI" },
      { ...row, provider_name: "OpenAI", spend_usd: null, requests: null },
    ]),
  );
  const [group] = breakdownUsage(data);
  assert.equal(group.spend_usd, null);
  assert.equal(group.requests, null);
  assert.equal(group.prompt_tokens, 2000);
});
