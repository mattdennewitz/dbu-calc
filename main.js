import "./style.css";
import {
  DATABRICKS_MODELS,
  SOURCES,
  OPENROUTER_SNAPSHOT,
  JEV_NOTE,
  fetchOpenRouterModels,
} from "./pricing.js";
import {
  BUCKETS,
  calculateCost,
  effectiveDatabricksRates,
} from "./calculator.js";
import { mountUsageExplorer } from "./usage-view.js";

const labels = {
  input: "Uncached input",
  output: "Output",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
};
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value);
const number = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(
        value,
      );
let routerModels = OPENROUTER_SNAPSHOT.models;
const defaultModel = (category, hint) =>
  DATABRICKS_MODELS.find(
    (m) => m.category === category && m.name.includes(hint),
  )?.id ?? DATABRICKS_MODELS.find((m) => m.category === category)?.id;
const state = {
  foundation: defaultModel("foundation", "GPT-OSS-120B"),
  commercial: defaultModel("commercial", "Sonnet 4.5"),
  byok:
    routerModels.find((m) => m.id === "anthropic/claude-sonnet-4.5")?.id ??
    routerModels[0]?.id ??
    "custom",
  tokens: { input: 10000000, output: 2000000, cacheRead: 0, cacheWrite: 0 },
  imported: null,
  dbuPrice: SOURCES.dbuDefault ?? 0.07,
  discount: 0,
  gatewayFee: 0,
  regional: false,
  promotions: true,
  tiers: { foundation: "standard", commercial: "standard" },
  custom: Object.fromEntries(
    ["foundation", "commercial", "byok"].map((k) => [
      k,
      { input: 0, output: 0, cacheRead: null, cacheWrite: null },
    ]),
  ),
};
const app = document.querySelector("#app");
app.innerHTML = `
  <header><a class="brand" href="./">TOKEN <span>→</span> DBU</a><span class="pill">WORKLOAD PRICING LAB</span></header>
  <main>
    <section class="intro"><div class="eyebrow">ONE WORKLOAD. THREE WAYS TO SERVE IT.</div><h1>Tokens in.<br><span>Real costs out.</span></h1><p>Compare Databricks open-weight and commercial models with bring-your-own-key pricing. All estimates in USD, all rates visible.</p></section>
    <section id="usage-import" class="panel usage-import"></section>
    <section class="workload panel" aria-labelledby="workload-title"><div class="section-head"><h2 id="workload-title">01 <span id="workload-label">Your monthly workload</span></h2><button id="reset" class="text-button">Reset workload</button></div>
      <div class="token-grid">${BUCKETS.map((k) => `<label>${labels[k]} tokens<input id="tokens-${k}" type="number" min="0" step="1" value="${state.tokens[k]}"></label>`).join("")}</div>
      <p class="hint">Token buckets are mutually exclusive. Uncached input excludes cache reads and writes. Reasoning tokens belong in output. Use the same counts for every scenario.</p>
      <details><summary>Account assumptions & adjustments</summary><div class="account-grid">
        <label>Target cloud<select id="cloud"><option>AWS</option><option>Azure</option><option>GCP</option><option>Other</option></select></label>
        <label>Region / account note<input id="region" placeholder="e.g. us-east-1 · base-region rate"></label>
        <label>Databricks USD / DBU<input id="dbuPrice" type="number" min="0" step="0.001" value="${state.dbuPrice}"></label>
        <label>BYOK provider discount (%)<input id="discount" type="number" min="0" max="100" step="0.1" value="0"></label>
        <label>BYOK gateway charges / selected period (USD)<input id="gatewayFee" type="number" min="0" step="0.01" value="0"></label>
        <label>Enabled gateway features<input id="features" placeholder="e.g. inference tables, usage tracking"></label>
      </div><div class="checks"><label><input id="regional" type="checkbox"> Apply 10% regional-processing uplift to marked models</label><label><input id="promotions" type="checkbox" checked> Apply published, active promotions</label></div>
      <p class="hint">Cloud and region are notes, not automatic rate lookups. Enter your contracted $/DBU. Gateway features may incur separate charges; enter their total explicitly. The regional-processing uplift is separate from regional $/DBU pricing.</p></details>
    </section>
    <div class="section-head compare-heading"><h2>02 <span>Compare serving options</span></h2><button id="refresh" class="text-button">Refresh OpenRouter prices ↗</button></div>
    <p id="price-status" class="hint" role="status"></p>
    <p id="actual-spend" class="actual-spend" hidden></p>
    <section class="comparison" aria-label="Monthly scenario comparison">${[
      ["foundation", "DATABRICKS", "Open-weight models", "DBU / 1M tokens"],
      ["commercial", "DATABRICKS", "Commercial models", "DBU / 1M tokens"],
      [
        "byok",
        "BRING YOUR OWN KEY",
        "Provider / OpenRouter",
        "USD / 1M tokens",
      ],
    ]
      .map(
        ([
          key,
          tag,
          title,
          unit,
        ]) => `<article class="scenario panel ${key}" id="card-${key}"><div class="eyebrow">${tag}</div><h3>${title}</h3>
      ${key === "byok" ? '<label class="search-label">Filter presets<input id="model-search" type="search" placeholder="Search model or provider…"></label>' : ""}
      <label>Model<select id="model-${key}"></select></label>
      ${key !== "byok" ? `<label>Serving tier<select id="tier-${key}"><option value="standard">Standard pay-per-token</option><option value="priority">Priority pay-per-token</option></select></label>` : '<p class="hint byok-note">OpenRouter reference prices. For a direct-provider quote or negotiated rates, select Custom rates.</p>'}
      <div class="rate-head">${unit}<span>Input · output · cache</span></div><div class="rate-grid">${BUCKETS.map((k) => `<label>${labels[k]}<input id="rate-${key}-${k}" type="number" min="0" step="any" placeholder="Not published"></label>`).join("")}</div>
      <p id="note-${key}" class="model-note"></p><div class="total-area"><span class="eyebrow">ESTIMATED MONTHLY COST</span><div id="total-${key}" class="total">—</div><div id="detail-${key}" class="hint"></div></div>
      <div id="breakdown-${key}" class="breakdown"></div><p id="error-${key}" class="error" role="status"></p>
      <p id="delta-${key}" class="hint"></p>
    </article>`,
      )
      .join("")}</section>
    <section class="method panel"><h2>Behind the numbers</h2><div class="formula">Σ (tokens ÷ 1,000,000 × DBU rate) × $/DBU</div><p>BYOK = Σ (tokens ÷ 1,000,000 × USD rate) × (1 − provider discount) + gateway charges.</p><p>This is a workload estimate, not a quote. Different models can tokenize the same text differently. Context thresholds, routing/provider differences, taxes, tool calls, images, audio, storage, and non-token charges are not modeled. Hourly batch and provisioned-throughput rates are not interchangeable with token rates and are excluded.</p>
      <details><summary>Sources & pricing caveats</summary><ul><li><a href="${escape(SOURCES.databricksFoundation)}" target="_blank" rel="noreferrer">Databricks foundation model rates</a></li><li><a href="${escape(SOURCES.databricksCommercial)}" target="_blank" rel="noreferrer">Databricks commercial model rates</a></li><li><a href="${escape(SOURCES.openrouter)}" target="_blank" rel="noreferrer">OpenRouter public model catalog</a></li></ul><p>Databricks snapshot: ${escape(SOURCES.checkedAt)}. ${escape(SOURCES.dbuNote)}</p><p>${escape(JEV_NOTE)}</p><p>Blank cache rates mean unpublished or unsupported, never free. Long-context tiers must be selected explicitly according to the provider's applicable threshold. OpenRouter list prices are not guaranteed direct-provider or BYOK prices. Custom rates are your own assumptions.</p></details>
    </section>
    <footer>No API key needed. Calculations stay in your browser; refreshing prices only requests the public OpenRouter catalog.</footer>
  </main>`;

const $ = (id) => document.getElementById(id);
function fillOptions(key, filter = "") {
  const models =
    key === "byok"
      ? routerModels
      : DATABRICKS_MODELS.filter((m) => m.category === key);
  const visible = models.filter((m) =>
    `${m.name} ${m.id} ${m.family}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const selected = models.find((m) => m.id === state[key]);
  if (selected && !visible.some((m) => m.id === selected.id))
    visible.unshift(selected);
  $(`model-${key}`).innerHTML =
    '<option value="custom">Custom rates</option>' +
    visible
      .map(
        (m) =>
          `<option value="${escape(m.id)}">${escape(m.name)}${m.context ? ` · ${escape(m.context)}` : ""}</option>`,
      )
      .join("");
  $(`model-${key}`).value = state[key];
}
function readNumber(id, nullable = false) {
  const el = $(id);
  if (el.value === "") return nullable ? null : NaN;
  return el.validity.valid ? Number(el.value) : NaN;
}
function update() {
  $("workload-label").textContent = state.imported
    ? `Imported workload · ${state.imported.dates[0]} to ${state.imported.dates.at(-1)}`
    : "Your monthly workload";
  $("actual-spend").hidden = !state.imported;
  if (state.imported)
    $("actual-spend").textContent =
      `Actual OpenRouter credits spent: ${money(state.imported.spend)} · external BYOK inference: ${money(state.imported.byok)} (separate billing). Comparing this period, not a monthly projection. All selected tokens are modeled on each single target model; no automatic model matching.`;
  for (const node of document.querySelectorAll(".total-area > .eyebrow"))
    node.textContent = state.imported
      ? "ESTIMATED IMPORTED-PERIOD COST"
      : "ESTIMATED MONTHLY COST";
  for (const key of ["foundation", "commercial", "byok"]) {
    const custom = state[key] === "custom";
    const model = (key === "byok" ? routerModels : DATABRICKS_MODELS).find(
      (m) => m.id === state[key],
    );
    if (key !== "byok") {
      $(`tier-${key}`).disabled = custom;
      $(`tier-${key}`).querySelector('[value="priority"]').disabled =
        !model?.priority;
    }
    const rates = custom
      ? state.custom[key]
      : key === "byok"
        ? model
        : model &&
          effectiveDatabricksRates(
            model,
            state.tiers[key],
            state.regional,
            state.promotions,
          );
    for (const bucket of BUCKETS) {
      const el = $(`rate-${key}-${bucket}`);
      el.readOnly = !custom;
      if (document.activeElement !== el) el.value = rates?.[bucket] ?? "";
    }
    const notes = [];
    if (custom) notes.push("User-supplied rates; not a published model quote.");
    if (key === "byok" && !custom)
      notes.push(model?.id ?? "No model selected.");
    if (key === "byok" && model?.family === "jev")
      notes.push(
        "Routing model: fixed token prices are not published; this is not a free model.",
      );
    if (key !== "byok" && rates && Number.isFinite(state.dbuPrice))
      notes.push(
        `USD / 1M: input $${number(rates.input * state.dbuPrice)} · output ${rates.output == null ? "not published" : `$${number(rates.output * state.dbuPrice)}`}.`,
      );
    if (model?.regional && state.regional)
      notes.push("Includes 10% regional-processing uplift.");
    if (model?.promotion) {
      notes.push(model.promotion.note);
      if (!state.promotions && model.promotion.multiplier !== 1)
        notes.push("Optional promotional discount disabled.");
    }
    $(`note-${key}`).textContent = notes.join(" ");
    const result = rates
      ? calculateCost(state.tokens, rates)
      : { total: null, error: "No rates available for this serving tier." };
    let error = result.error;
    if (
      key !== "byok" &&
      (!Number.isFinite(state.dbuPrice) || state.dbuPrice < 0)
    )
      error = "Enter a non-negative USD / DBU price.";
    if (
      key === "byok" &&
      (!Number.isFinite(state.discount) ||
        state.discount < 0 ||
        state.discount > 100 ||
        !Number.isFinite(state.gatewayFee) ||
        state.gatewayFee < 0)
    )
      error = "Enter a discount from 0–100% and non-negative gateway charges.";
    const multiplier =
      key === "byok" ? 1 - state.discount / 100 : state.dbuPrice;
    const total = error
      ? null
      : result.total * multiplier + (key === "byok" ? state.gatewayFee : 0);
    $(`total-${key}`).textContent = money(total);
    const baseline = state.imported?.spend;
    $(`delta-${key}`).textContent =
      baseline != null && total != null
        ? `${money(Math.abs(total - baseline))} ${total <= baseline ? "less" : "more"} than actual OpenRouter credits spent${baseline > 0 ? ` (${number((Math.abs(total - baseline) / baseline) * 100)}%)` : ""}. Excludes external BYOK spend.`
        : "";
    $(`detail-${key}`).textContent = error
      ? "Estimate unavailable"
      : key === "byok"
        ? `${state.discount}% provider discount · ${money(state.gatewayFee)} gateway charges`
        : `${number(result.total)} DBU × ${money(state.dbuPrice)} / DBU`;
    $(`error-${key}`).textContent = error ?? "";
    $(`breakdown-${key}`).innerHTML = error
      ? ""
      : BUCKETS.map(
          (k) =>
            `<div><span>${labels[k]}</span><strong>${money(result.breakdown[k] * multiplier)}</strong></div>`,
        ).join("") +
        (key === "byok"
          ? `<div><span>Gateway charges</span><strong>${money(state.gatewayFee)}</strong></div>`
          : "");
  }
}
for (const key of ["foundation", "commercial", "byok"]) {
  fillOptions(key);
  $(`model-${key}`).addEventListener("change", (e) => {
    state[key] = e.target.value;
    if (key !== "byok") {
      state.tiers[key] = "standard";
      $(`tier-${key}`).value = "standard";
    }
    update();
  });
  if (key !== "byok")
    $(`tier-${key}`).addEventListener("change", (e) => {
      state.tiers[key] = e.target.value;
      update();
    });
  for (const bucket of BUCKETS)
    $(`rate-${key}-${bucket}`).addEventListener("input", () => {
      state.custom[key][bucket] = readNumber(`rate-${key}-${bucket}`, true);
      update();
    });
}
for (const bucket of BUCKETS)
  $(`tokens-${bucket}`).addEventListener("input", () => {
    state.tokens[bucket] = readNumber(`tokens-${bucket}`);
    state.imported = null;
    update();
  });
for (const key of ["dbuPrice", "discount", "gatewayFee"])
  $(key).addEventListener("input", () => {
    state[key] = readNumber(key);
    update();
  });
for (const key of ["regional", "promotions"])
  $(key).addEventListener("change", (e) => {
    state[key] = e.target.checked;
    update();
  });
$("model-search").addEventListener("input", (e) =>
  fillOptions("byok", e.target.value),
);
$("reset").addEventListener("click", () => {
  state.imported = null;
  state.tokens = {
    input: 10000000,
    output: 2000000,
    cacheRead: 0,
    cacheWrite: 0,
  };
  for (const k of BUCKETS) $(`tokens-${k}`).value = state.tokens[k];
  update();
});
$("price-status").textContent =
  `OpenRouter saved snapshot: ${OPENROUTER_SNAPSHOT.fetchedAt}. Refresh for current list prices.`;
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  $("price-status").textContent = "Fetching the public OpenRouter catalog…";
  try {
    const fresh = await fetchOpenRouterModels();
    if (!fresh.length)
      throw new Error("The catalog returned no supported presets.");
    routerModels = fresh;
    if (
      state.byok !== "custom" &&
      !routerModels.some((m) => m.id === state.byok)
    ) {
      state.byok = "custom";
      $("price-status").textContent =
        "Selected model is no longer listed. Enter custom rates.";
    } else
      $("price-status").textContent =
        `Live OpenRouter prices · ${new Date().toLocaleString()} · ${fresh.length} presets`;
    fillOptions("byok", $("model-search").value);
    update();
  } catch (error) {
    $("price-status").textContent =
      `Refresh failed: ${error.message}. Retaining the last available catalog; prices may be stale.`;
  } finally {
    $("refresh").disabled = false;
  }
});
update();
mountUsageExplorer($("usage-import"), (summary) => {
  state.tokens = { ...summary.tokens };
  state.imported = summary;
  for (const bucket of BUCKETS)
    $(`tokens-${bucket}`).value = state.tokens[bucket];
  if (
    summary.models.length === 1 &&
    routerModels.some((model) => model.id === summary.models[0])
  ) {
    state.byok = summary.models[0];
    fillOptions("byok", $("model-search").value);
  }
  update();
  $("workload-title").scrollIntoView({ behavior: "smooth", block: "start" });
});
