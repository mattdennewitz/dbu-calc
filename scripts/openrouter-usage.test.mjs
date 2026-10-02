import test from "node:test";
import assert from "node:assert/strict";
import {
  activityToRows,
  completedUtcRange,
  downloadUsage,
  parseArgs,
  toCsv,
} from "./openrouter-usage.mjs";

const now = new Date("2026-10-01T17:00:00Z");

test("date windows cover completed UTC days, never the still-open day", () => {
  assert.deepEqual(completedUtcRange(2, now), {
    from: "2026-09-29",
    to: "2026-09-30",
  });
  assert.throws(() => completedUtcRange(31, now), /1 to 30/);
});

test("activity becomes per-model rows with token, user, key, spend and BYOK attribution", () => {
  const context = {
    workspace: { id: "w1", name: "Production" },
    key: {
      name: "Application",
      creator_user_id: "u1",
      external_user: "tenant-7",
    },
    member: { name: "Ada Lovelace" },
  };
  const rows = activityToRows(
    [
      {
        date: "2026-09-28",
        model: "openai/gpt-4.1",
        prompt_tokens: 100,
        completion_tokens: 50,
        reasoning_tokens: 12,
        cached_tokens: 4,
        requests: 2,
        usage: 0.004,
        byok_usage_inference: 0.001,
      },
      {
        date: "2026-10-01",
        model: "openai/gpt-4.1",
        prompt_tokens: 999,
        completion_tokens: 999,
      },
    ],
    context,
    { from: "2026-09-28", to: "2026-09-30" },
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    date: "2026-09-28",
    workspace_id: "w1",
    workspace_name: "Production",
    key_name: "Application",
    api_key_hash: "",
    creator_user_id: "u1",
    creator_user_name: "Ada Lovelace",
    external_user: "tenant-7",
    model: "openai/gpt-4.1",
    model_permaslug: "",
    provider_name: "",
    endpoint_id: "",
    requests: 2,
    prompt_tokens: 100,
    completion_tokens: 50,
    reasoning_tokens: 12,
    cached_tokens: 4,
    total_tokens: 150,
    spend_usd: 0.004,
    byok_spend_usd: 0.001,
  });
});

test("CSV quotes cells and neutralizes spreadsheet formulas", () => {
  const csv = toCsv([
    {
      model: '=IMPORTDATA("secret")',
      key_name: 'team, "one"',
      spend_usd: 0.25,
    },
  ]);
  assert.match(csv, /"'=IMPORTDATA\(""secret""\)"/);
  assert.match(csv, /"team, ""one"""/);
  assert.match(csv.split("\r\n")[0], /workspace_id.*prompt_tokens.*spend_usd/);
});

test("CLI options validate output mode and requested completed-day window", () => {
  assert.deepEqual(
    parseArgs([
      "--days",
      "7",
      "--format",
      "json",
      "--workspace",
      "workspace-1",
      "--active-only",
    ]),
    {
      days: 7,
      format: "json",
      output: "-",
      workspace: "workspace-1",
      includeDisabled: false,
      help: false,
    },
  );
  assert.throws(() => parseArgs(["--days", "31"]), /1 to 30/);
  assert.throws(() => parseArgs(["--format", "xml"]), /csv or json/);
});

test("export fetches all workspaces, their keys, member identities, and per-key activity", async () => {
  const calls = [];
  const payloads = {
    "/workspaces?offset=0&limit=100": {
      data: [
        { id: "w1", name: "Production" },
        { id: "w2", name: "Research" },
      ],
      total_count: 2,
    },
    "/organization/members?offset=0&limit=100": {
      data: [
        {
          id: "u1",
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.test",
        },
      ],
      total_count: 1,
    },
    "/keys?workspace_id=w1&include_disabled=false&offset=0": {
      data: [
        { hash: "h1", name: "prod", creator_user_id: "u1", disabled: false },
      ],
    },
    "/keys?workspace_id=w2&include_disabled=false&offset=0": {
      data: [
        {
          hash: "h2",
          name: "research",
          creator_user_id: "u1",
          disabled: false,
        },
      ],
    },
    "/activity?api_key_hash=h1&workspace_id=w1": {
      data: [
        {
          date: "2026-09-30",
          model: "anthropic/claude",
          prompt_tokens: 10,
          completion_tokens: 2,
          usage: 0.02,
        },
      ],
    },
    "/activity?api_key_hash=h2&workspace_id=w2": {
      data: [
        {
          date: "2026-09-30",
          model: "deepseek/deepseek-v4",
          prompt_tokens: 20,
          completion_tokens: 3,
          usage: 0.01,
        },
      ],
    },
  };
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const path = `${parsed.pathname.replace("/api/v1", "")}${parsed.search}`;
    calls.push({ path, authorization: init.headers.Authorization });
    if (!(path in payloads))
      return Response.json(
        { error: { message: `unexpected ${path}` } },
        { status: 404 },
      );
    return Response.json(payloads[path]);
  };
  const result = await downloadUsage({
    managementKey: "test-management-secret",
    days: 1,
    includeDisabled: false,
    now,
    fetchImpl,
  });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.workspaces.map((workspace) => workspace.name),
    ["Production", "Research"],
  );
  assert.equal(result.rows[0].creator_user_name, "Ada Lovelace");
  assert.equal(result.rows[0].total_tokens, 12);
  assert.equal(result.rows[1].spend_usd, 0.01);
  assert.ok(
    calls.every(
      (call) => call.authorization === "Bearer test-management-secret",
    ),
  );
  assert.equal(result.rows[0].api_key_hash, "h1");
  assert.equal(result.rows[1].api_key_hash, "h2");
  assert.doesNotMatch(JSON.stringify(result), /test-management-secret/);
});
