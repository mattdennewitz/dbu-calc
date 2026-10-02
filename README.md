# Token → DBU

A browser-based calculator for comparing the same token workload across Databricks-hosted open-weight models, Databricks-hosted commercial models, and provider/BYOK pricing. Observable Plot charts make imported OpenRouter spend explorable by date and model.

## Local development

Requires Node.js 24 or newer and npm. GitHub Actions uses Node.js 24.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No API key is needed for the calculator.

## Calculate costs

Enter uncached input, output, cache-read, and cache-write tokens. The buckets are mutually exclusive. Choose models independently for each scenario; selecting different models does not imply equivalent capabilities or tokenization.

Databricks estimates use:

```text
USD = (Σ token count / 1,000,000 × DBU rate) × USD per DBU
```

The editable base-region default is **$0.07/DBU**. Enter your contracted rate for the target account, cloud, and region. Cloud/region fields are notes, not automatic pricing lookups. Available controls include standard/priority token rates, published promotions, the 10% regional-processing uplift for marked models, BYOK provider discounts, and explicit gateway charges for the selected period.

OpenRouter presets are reference list prices, not guaranteed direct-provider or BYOK quotes. Use **Refresh OpenRouter prices** for the current public catalog or **Custom rates** for your own quote. Databricks rates are a bundled snapshot; dates and caveats are displayed under **Sources & pricing caveats**. Hourly batch/provisioned throughput, taxes, and other non-token charges are not modeled.

## Export OpenRouter usage

Create an expiring [Management API key](https://openrouter.ai/settings/management-keys). A normal inference key is insufficient. Management keys have account-wide administrative permissions: keep the key in your secret manager/environment, never in the browser or committed files.

```sh
export OPENROUTER_MANAGEMENT_KEY='your-management-key'
npm run openrouter:usage -- --days 30 --format csv --output usage.csv
```

JSON is also supported:

```sh
npm run openrouter:usage -- --days 7 --format json --output usage.json
```

Options:

- `--days N`: last 1–30 completed UTC days; defaults to 30.
- `--workspace ID`: export one workspace; otherwise exports all workspaces.
- `--active-only`: exclude disabled keys. Disabled keys are included by default for historical spend.
- `--format csv|json`: defaults to CSV.
- `--output FILE`: defaults to stdout. New export files are created with `0600` permissions.
- `--help`: print all options and accounting caveats.

Exports include daily model/provider activity, key names/hashes, creator attribution, request/token counts, OpenRouter spend, and separate external BYOK inference spend. Key creator attribution is not necessarily the consumer of a shared key. The activity API exposes only the last **30 completed UTC days**; archive exports daily for longer history. Export files contain sensitive user identifiers and spend, even though key hashes are not credentials.

## Import and explore

1. Choose the exported CSV or JSON in **Explore actual OpenRouter usage**.
2. Filter by workspace, API key, key creator, model, provider, and UTC date range. Charts, totals, and the complete provider/model spend breakdown update together.
3. Click **Apply selected workload & actual spend**.
4. Select Databricks target models and compare their estimated costs with actual OpenRouter credits spent.

The spend breakdown lists every matching provider/model pair, including zero-spend usage, with requests, prompt/output/cache-read tokens, OpenRouter spend, spend share, and separate BYOK spend. Missing values remain unavailable. Scroll the table to see all rows and columns; it is separate from the single-target scenario cards.

The selected period is compared as-is, not extrapolated to a month. All selected rows are combined into one workload and modeled on each selected target model; the calculator does not automatically map every source model to a Databricks equivalent. A single imported model selects its OpenRouter preset when an exact catalog match exists. Manual token edits or workload reset detach the actual-spend baseline.

Files are parsed locally and are not uploaded. The import limit is 25 MB. Prompt tokens minus cache reads estimate uncached input; completion counts are used without adding reasoning counts again. Cache-write counts are unavailable in the export and are set to zero with a warning. Response-cache rows where cache reads exceed prompt counts use zero uncached input and show a directional-estimate warning. Missing required token counts block workload application rather than silently produce a zero cost. External BYOK inference spend stays separate from OpenRouter credits spent.

## Build a static site

```sh
npm ci
npm run build:static
npm run preview
```

Deploy **only `dist/`** to a static host. The static build uses relative asset URLs, so it works at a domain root or a repository subpath such as `/dbu-cal/`. No backend, OpenRouter credentials, usage exports, or source files are required on the host.

`npm run build` remains the default Vite build for root-hosted sites. `npm run preview` is for checking a build locally, not a production server.

The browser fetches OpenRouter's public model catalog only when you refresh prices. Styling also requests fonts from Google Fonts; imported usage never leaves the browser.

## GitHub Pages

1. In the repository, open **Settings → Pages → Build and deployment**.
2. Set **Source** to **GitHub Actions**. Ensure Actions and Pages are allowed for the repository/account.
3. Push to `main`, or run **Deploy GitHub Pages** manually from the Actions tab.

`.github/workflows/pages.yml` installs locked dependencies with `npm ci`, runs the regression tests, builds the static site, uploads `dist/` as a Pages artifact, and deploys it using the `github-pages` environment. The deployment job receives only the Pages/OIDC permissions it needs. No custom deployment secret or OpenRouter key is required. The workflow deployment exposes the published URL.

Do not include private usage exports or credentials in the repository or Pages artifact. The workflow uploads only `dist/`.

## Verification

```sh
node --test calculator.test.js usage.test.js scripts/openrouter-usage.test.mjs
npm run build:static
```

## Pricing and API sources

- [Databricks proprietary foundation model serving](https://www.databricks.com/product/pricing/proprietary-foundation-model-serving)
- [Databricks foundation model serving](https://www.databricks.com/product/pricing/foundation-model-serving)
- [OpenRouter public model catalog](https://openrouter.ai/api/v1/models)
- [OpenRouter activity API](https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity-grouped-by-endpoint)
- [OpenRouter management keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)
