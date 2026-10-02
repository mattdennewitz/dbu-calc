import test from "node:test";
import assert from "node:assert/strict";
import { calculateCost, effectiveDatabricksRates } from "./calculator.js";

const tokens = { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 };
const model = {
  standard: { input: 10, output: 20, cacheRead: null, cacheWrite: 12.5 },
  regional: true,
  promotion: {
    until: "2026-11-21",
    multiplier: 1,
    afterMultiplier: { input: 1.25, output: 1.5, cacheWrite: 1.25 },
  },
};

test("unpublished cache rates block estimates only when that bucket is used", () => {
  assert.equal(calculateCost(tokens, model.standard).total, 30);
  assert.equal(
    calculateCost({ ...tokens, cacheRead: 1 }, model.standard).total,
    null,
  );
  assert.match(
    calculateCost({ ...tokens, cacheRead: 1 }, model.standard).error,
    /No cache read rate/,
  );
});

test("baked-in promotions expire after the inclusive end date even with discounts disabled", () => {
  assert.equal(
    calculateCost(
      tokens,
      effectiveDatabricksRates(model, "standard", false, false, "2026-11-21"),
    ).total,
    30,
  );
  assert.equal(
    calculateCost(
      tokens,
      effectiveDatabricksRates(model, "standard", false, false, "2026-11-22"),
    ).total,
    42.5,
  );
  assert.equal(
    calculateCost(
      { ...tokens, input: 0, output: 0, cacheWrite: 1e6 },
      effectiveDatabricksRates(model, "standard", false, true, "2026-11-22"),
    ).total,
    15.625,
  );
});

test("optional promotions and marked regional uplifts compose, without discounting unsupported buckets", () => {
  const discounted = {
    ...model,
    promotion: { until: "2027-01-31", multiplier: 0.8 },
  };
  assert.ok(
    Math.abs(
      calculateCost(
        tokens,
        effectiveDatabricksRates(
          discounted,
          "standard",
          true,
          true,
          "2026-10-01",
        ),
      ).total - 26.4,
    ) < 1e-9,
  );
  assert.equal(
    calculateCost(
      tokens,
      effectiveDatabricksRates(
        { ...discounted, regional: false },
        "standard",
        true,
        false,
        "2026-10-01",
      ),
    ).total,
    30,
  );
  assert.equal(
    effectiveDatabricksRates(discounted, "standard", true, true, "2026-10-01")
      .cacheRead,
    null,
  );
});
