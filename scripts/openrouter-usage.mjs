#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API = "https://openrouter.ai/api/v1";
const PAGE_SIZE = 100;
const MAX_PARALLEL = 4;
const FIELDS = [
  "date",
  "workspace_id",
  "workspace_name",
  "key_name",
  "api_key_hash",
  "creator_user_id",
  "creator_user_name",
  "external_user",
  "model",
  "model_permaslug",
  "provider_name",
  "endpoint_id",
  "requests",
  "prompt_tokens",
  "completion_tokens",
  "reasoning_tokens",
  "cached_tokens",
  "total_tokens",
  "spend_usd",
  "byok_spend_usd",
];

export function parseArgs(args) {
  const options = {
    days: 30,
    format: "csv",
    output: "-",
    workspace: null,
    includeDisabled: true,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--include-disabled") {
      options.includeDisabled = true;
      continue;
    }
    if (arg === "--active-only") {
      options.includeDisabled = false;
      continue;
    }
    if (!["--days", "--format", "--output", "--workspace"].includes(arg))
      throw new Error(`Unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`${arg} requires a value`);
    if (arg === "--days") {
      options.days = Number(value);
      if (
        !Number.isInteger(options.days) ||
        options.days < 1 ||
        options.days > 30
      )
        throw new Error("--days must be an integer from 1 to 30");
    } else if (arg === "--format") {
      if (!["csv", "json"].includes(value))
        throw new Error("--format must be csv or json");
      options.format = value;
    } else if (arg === "--output") options.output = value;
    else options.workspace = value;
  }
  return options;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function completedUtcRange(days, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error("days must be from 1 to 30");
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: isoDate(start), to: isoDate(end) };
}

async function request(path, managementKey, fetchImpl) {
  const response = await fetchImpl(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${managementKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.error?.message ?? payload?.message ?? "";
    } catch {
      /* Preserve the HTTP status when the response isn't JSON. */
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `OpenRouter returned HTTP ${response.status}. Use a valid Management API key with account/workspace access.${detail ? ` ${detail}` : ""}`,
      );
    }
    throw new Error(
      `OpenRouter request ${path} failed: HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return response.json();
}

async function listPages(
  path,
  managementKey,
  fetchImpl,
  { pageLimit = false } = {},
) {
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${API}${path}`);
    url.searchParams.set("offset", String(offset));
    if (pageLimit) url.searchParams.set("limit", String(PAGE_SIZE));
    const payload = await request(
      url.href.slice(API.length),
      managementKey,
      fetchImpl,
    );
    if (!Array.isArray(payload?.data))
      throw new Error(
        `Unexpected OpenRouter response from ${path}: data is not an array`,
      );
    all.push(...payload.data);
    if (
      payload.data.length < PAGE_SIZE ||
      (Number.isInteger(payload.total_count) &&
        all.length >= payload.total_count)
    )
      return all;
  }
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        output[index] = await worker(items[index], index);
      }
    }),
  );
  return output;
}

export function activityToRows(activity, context, range) {
  if (!range.from || !range.to) throw new Error("Date range is required.");
  return activity.flatMap((item) => {
    if (
      !item ||
      typeof item.date !== "string" ||
      item.date < range.from ||
      item.date > range.to
    )
      return [];
    const prompt = numeric(item.prompt_tokens);
    const completion = numeric(item.completion_tokens);
    const total =
      prompt == null || completion == null ? null : prompt + completion;
    return [
      {
        date: item.date,
        workspace_id: context.workspace.id,
        workspace_name: context.workspace.name,
        key_name: context.key.name ?? context.key.label ?? "",
        api_key_hash: context.key.hash ?? "",
        creator_user_id: context.key.creator_user_id ?? "",
        creator_user_name: context.member?.name ?? "",
        external_user: context.key.external_user ?? "",
        model: item.model ?? "",
        model_permaslug: item.model_permaslug ?? "",
        provider_name: item.provider_name ?? "",
        endpoint_id: item.endpoint_id ?? "",
        requests: numeric(item.requests),
        prompt_tokens: prompt,
        completion_tokens: completion,
        reasoning_tokens: numeric(item.reasoning_tokens),
        cached_tokens: numeric(item.cached_tokens),
        total_tokens: total,
        spend_usd: numeric(item.usage),
        byok_spend_usd: numeric(item.byok_usage_inference),
      },
    ];
  });
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function toCsv(rows) {
  const cell = (value) => {
    if (value == null) return "";
    let text = String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    [
      FIELDS.map(cell).join(","),
      ...rows.map((row) => FIELDS.map((field) => cell(row[field])).join(",")),
    ].join("\r\n") + "\r\n"
  );
}

export async function downloadUsage({
  managementKey,
  days = 30,
  workspaceId = null,
  includeDisabled = true,
  now = new Date(),
  fetchImpl = fetch,
}) {
  if (!managementKey)
    throw new Error(
      "Set OPENROUTER_MANAGEMENT_KEY to a Management API key. An inference API key is not sufficient.",
    );
  const range = completedUtcRange(days, now);
  let workspaces;
  if (workspaceId) {
    const payload = await request(
      `/workspaces/${encodeURIComponent(workspaceId)}`,
      managementKey,
      fetchImpl,
    );
    const workspace = payload?.data;
    if (!workspace?.id)
      throw new Error(`OpenRouter did not return workspace ${workspaceId}`);
    workspaces = [workspace];
  } else {
    workspaces = await listPages("/workspaces", managementKey, fetchImpl, {
      pageLimit: true,
    });
  }

  const keyPath = (workspace) =>
    `/keys?${new URLSearchParams({ workspace_id: workspace.id, include_disabled: String(includeDisabled) })}`;
  const [members, ...workspaceKeys] = await Promise.all([
    listPages("/organization/members", managementKey, fetchImpl, {
      pageLimit: true,
    }).catch((error) => {
      if (/HTTP 403|HTTP 404/.test(error.message)) return [];
      throw error;
    }),
    ...workspaces.map((workspace) =>
      listPages(keyPath(workspace), managementKey, fetchImpl),
    ),
  ]);
  const memberById = new Map(
    members.map((member) => [
      member.id,
      {
        name:
          [member.first_name, member.last_name].filter(Boolean).join(" ") ||
          member.email ||
          member.id,
      },
    ]),
  );
  const jobs = workspaces.flatMap((workspace, i) =>
    workspaceKeys[i]
      .filter((key) => typeof key.hash === "string" && key.hash.length > 0)
      .map((key) => ({ workspace, key })),
  );

  const groups = await mapLimit(
    jobs,
    MAX_PARALLEL,
    async ({ workspace, key }) => {
      const query = new URLSearchParams({
        api_key_hash: key.hash,
        workspace_id: workspace.id,
      });
      const payload = await request(
        `/activity?${query}`,
        managementKey,
        fetchImpl,
      );
      if (!Array.isArray(payload?.data))
        throw new Error(
          `Unexpected OpenRouter activity response for key ${key.name ?? key.hash.slice(0, 8)}`,
        );
      return activityToRows(
        payload.data,
        { workspace, key, member: memberById.get(key.creator_user_id) },
        range,
      );
    },
  );
  const rows = groups.flat();
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.workspace_name.localeCompare(b.workspace_name) ||
      a.key_name.localeCompare(b.key_name) ||
      a.model.localeCompare(b.model) ||
      a.endpoint_id.localeCompare(b.endpoint_id),
  );
  return {
    generated_at: now.toISOString(),
    range,
    workspaces: workspaces.map(({ id, name }) => ({ id, name })),
    rows,
  };
}

export function helpText() {
  return `Download OpenRouter token usage, spend, models and attribution by key.

Usage: OPENROUTER_MANAGEMENT_KEY=... node scripts/openrouter-usage.mjs [options]

Options:
  --days N             Last N completed UTC days (1-30; default 30)
  --workspace ID       Export one workspace; default exports every workspace
  --format csv|json    Output format (default csv)
  --output FILE        Write to file instead of stdout (default stdout)
  --active-only        Exclude disabled keys (default includes them for history)
  --include-disabled   Include disabled keys (default)
  --help               Show this help

The API exposes only the last 30 completed UTC days. Archive exports daily
for longer history. Management keys are account-wide admin credentials:
use an expiring key in your secret manager, never in browser code or git.

Creator attribution is not necessarily the person consuming a shared key.
Reasoning/cached token counts are reported separately, not added to total_tokens.
Cache-write tokens are not exposed by this endpoint. Spend and BYOK inference
spend are kept separate; do not assume they have the same billing basis.
Files contain key hashes (not secret keys), user identifiers and spend: treat
them as sensitive. CSV neutralizes spreadsheet formulas; JSON preserves values.
`;
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const managementKey = env.OPENROUTER_MANAGEMENT_KEY;
  if (!managementKey)
    throw new Error(
      "Set OPENROUTER_MANAGEMENT_KEY to a Management API key. See https://openrouter.ai/settings/management-keys",
    );
  const result = await downloadUsage({
    managementKey,
    days: options.days,
    workspaceId: options.workspace,
    includeDisabled: options.includeDisabled,
  });
  const output =
    options.format === "json"
      ? JSON.stringify(result, null, 2) + "\n"
      : toCsv(result.rows);
  if (options.output === "-") process.stdout.write(output);
  else
    await writeFile(options.output, output, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
  process.stderr.write(
    `Exported ${result.rows.length} usage rows for ${result.workspaces.length} workspace(s), ${result.range.from} through ${result.range.to}.\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`openrouter-usage: ${error.message}\n`);
    process.exitCode = 1;
  });
}
