export const BUCKETS = ["input", "output", "cacheRead", "cacheWrite"];

export function calculateCost(tokens, rates) {
  let total = 0;
  const breakdown = {};
  for (const bucket of BUCKETS) {
    const count = tokens[bucket];
    if (!Number.isFinite(count) || count < 0)
      return { total: null, error: "Enter non-negative token counts." };
    if (count === 0) {
      breakdown[bucket] = 0;
      continue;
    }
    const rate = rates[bucket];
    if (rate === null || rate === undefined)
      return {
        total: null,
        error: `No ${bucket.replace(/([A-Z])/g, " $1").toLowerCase()} rate is published. Set that token count to zero or enter a custom rate.`,
      };
    if (!Number.isFinite(rate) || rate < 0)
      return { total: null, error: "Enter non-negative rates." };
    breakdown[bucket] = (count * rate) / 1e6;
    total += breakdown[bucket];
  }
  return { total, breakdown, error: null };
}

export function effectiveDatabricksRates(
  model,
  tier,
  regional,
  promotions,
  today = new Date().toISOString().slice(0, 10),
) {
  const rates = model[tier];
  if (!rates) return null;
  const promo = model.promotion;
  const expired = promo && today > promo.until;
  const active = promotions && promo && !expired;
  const regionalMultiplier = regional && model.regional ? 1.1 : 1;
  return Object.fromEntries(
    BUCKETS.map((key) => {
      const adjustment = expired
        ? typeof promo.afterMultiplier === "object"
          ? (promo.afterMultiplier[key] ?? 1)
          : (promo.afterMultiplier ?? 1)
        : active
          ? promo.multiplier
          : 1;
      return [
        key,
        rates[key] == null
          ? null
          : rates[key] * adjustment * regionalMultiplier,
      ];
    }),
  );
}
