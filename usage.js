const NUMERIC = [
  "prompt_tokens",
  "completion_tokens",
  "cached_tokens",
  "reasoning_tokens",
  "requests",
  "spend_usd",
  "byok_spend_usd",
];

function parseCsv(text) {
  const records = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) records.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (cell !== "" || row.length) {
    row.push(cell);
    records.push(row);
  }
  const headers = records.shift();
  if (!headers || new Set(headers).size !== headers.length)
    throw new Error("CSV needs unique column headers.");
  return records.map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(`CSV row ${i + 2} has the wrong number of columns.`);
    return Object.fromEntries(headers.map((h, j) => [h, values[j]]));
  });
}

function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(value.trim());
  if (!match || Number.isNaN(Date.parse(`${match[1]}T00:00:00Z`))) return null;
  return new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) ===
    match[1]
    ? match[1]
    : null;
}

export function parseUsage(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  const json = text.startsWith("{") || text.startsWith("[");
  const payload = json ? JSON.parse(text) : parseCsv(text);
  const rows = json
    ? Array.isArray(payload)
      ? payload
      : payload.rows
    : payload;
  if (!Array.isArray(rows) || !rows.length)
    throw new Error(
      "No usage rows found. Use the CSV or JSON produced by openrouter:usage.",
    );
  return rows.map((row, i) => {
    const date = normalizeDate(row?.date);
    if (!row || !date || !row.model)
      throw new Error(`Usage row ${i + 1} needs a valid date and model.`);
    const normalized = { ...row, date };
    for (const key of NUMERIC) {
      const value = row[key];
      normalized[key] = value == null || value === "" ? null : Number(value);
      if (
        normalized[key] !== null &&
        (!Number.isFinite(normalized[key]) ||
          normalized[key] < 0 ||
          (key.endsWith("_tokens") && !Number.isSafeInteger(normalized[key])))
      )
        throw new Error(`Usage row ${i + 1} has invalid ${key}.`);
    }
    return normalized;
  });
}

export function summarizeUsage(rows) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let spend = 0,
    byok = 0,
    missingSpend = false,
    missingByok = false;
  const warnings = new Set([
    "Cache-write counts are unavailable; cache write is set to 0. Add them manually if known.",
    "Prompt counts minus cache reads estimate uncached input. Reasoning tokens are part of completion totals and are not added again.",
  ]);
  let hasCacheReplay = false;
  let error = rows.length ? null : "No rows match these filters.";
  for (const row of rows) {
    if (
      row.prompt_tokens == null ||
      row.completion_tokens == null ||
      row.cached_tokens == null
    )
      error =
        "Some rows lack prompt, completion, or cached token counts. Select rows with complete counts to apply a workload.";
    else {
      if (row.cached_tokens > row.prompt_tokens) hasCacheReplay = true;
      tokens.input += Math.max(0, row.prompt_tokens - row.cached_tokens);
      tokens.output += row.completion_tokens;
      tokens.cacheRead += row.cached_tokens;
    }
    if (row.spend_usd == null) missingSpend = true;
    else spend += row.spend_usd;
    if (row.byok_spend_usd == null) missingByok = true;
    else byok += row.byok_spend_usd;
  }
  if (missingSpend)
    warnings.add(
      "Some OpenRouter spend values are missing; the baseline is unavailable.",
    );
  if (hasCacheReplay)
    warnings.add(
      "Some cached token counts exceed prompt counts (possible response-cache replay). Uncached input is floored at zero; comparisons for these rows are directional.",
    );
  return {
    tokens,
    spend: missingSpend || !rows.length ? null : spend,
    byok: missingByok || !rows.length ? null : byok,
    error,
    warnings: [...warnings],
    models: [...new Set(rows.map((r) => r.model))],
    dates: [...new Set(rows.map((r) => r.date))].sort(),
  };
}
