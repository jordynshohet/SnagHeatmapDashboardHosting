"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const scoring = require("../scoring.js");

const completeCampus = Object.fromEntries(
  scoring.indicators.map((indicator) => [indicator.key, indicator.min])
);

test("normalizes indicators in the configured directions and applies their weights", () => {
  const campus = {
    ...completeCampus,
    undergrad_enrollment: 62031,
    walk_score: 98,
    convenience_1mi: 3
  };
  const [result] = scoring.scoreComparisons([campus]);
  const enrollment = result.indicators.find((indicator) => indicator.key === "undergrad_enrollment");
  const walkScore = result.indicators.find((indicator) => indicator.key === "walk_score");
  const convenience = result.indicators.find((indicator) => indicator.key === "convenience_1mi");

  assert.equal(enrollment.normalizedScore, 100);
  assert.equal(walkScore.normalizedScore, 100);
  assert.equal(convenience.normalizedScore, 60);
  assert.equal(enrollment.weightedContribution, 30);
  assert.equal(result.total, result.conditionSubtotals.marketSize +
    result.conditionSubtotals.marketNeed + result.conditionSubtotals.marketAttractiveness +
    result.conditionSubtotals.operationalFeasibility);
  assert.equal(result.provisional, false);
});

test("clamps indicator scores at both ends of each fixed range", () => {
  const aboveMaximum = Object.fromEntries(scoring.indicators.map((indicator) => [indicator.key, indicator.max + 100]));
  const belowMinimum = Object.fromEntries(scoring.indicators.map((indicator) => [indicator.key, indicator.min - 100]));
  const [above, below] = scoring.scoreComparisons([aboveMaximum, belowMinimum]);

  for (const indicator of above.indicators) {
    assert.equal(indicator.normalizedScore, indicator.direction === "higher" ? 100 : 0);
  }
  for (const indicator of below.indicators) {
    assert.equal(indicator.normalizedScore, indicator.direction === "higher" ? 0 : 100);
  }
});

test("parses valid numeric strings without accepting malformed values", () => {
  const [valid, invalid] = scoring.scoreComparisons([
    { ...completeCampus, undergrad_enrollment: "62,031" },
    { ...completeCampus, undergrad_enrollment: "62,03" }
  ]);

  assert.equal(valid.indicators[0].rawValue, "62,031");
  assert.equal(valid.indicators[0].normalizedScore, 100);
  assert.equal(invalid.indicators[0].normalizedScore, null);
  assert.equal(invalid.indicators[0].weightedContribution, null);
  assert.equal(invalid.provisional, true);
});

test("keeps missing values unscored and does not reweight provisional totals", () => {
  const campus = {
    undergrad_enrollment: 36000,
    pct_on_campus: null,
    median_family_income: undefined,
    walk_score: Number.NaN,
    convenience_1mi: "unknown"
  };
  const [result] = scoring.scoreComparisons([campus]);
  const enrollment = result.indicators[0];

  assert.equal(enrollment.normalizedScore, 100 * (36000 - 10224) / (62031 - 10224));
  assert.equal(enrollment.weightedContribution, enrollment.normalizedScore * 0.30);
  assert.equal(result.total, enrollment.weightedContribution);
  assert.equal(result.provisional, true);
  assert.deepEqual(result.dataCompleteness, {
    availableCount: 1,
    indicatorCount: 5,
    fraction: 1 / 5,
    missingKeys: [
      "pct_on_campus",
      "convenience_1mi",
      "median_family_income",
      "walk_score"
    ]
  });
  for (const indicator of result.indicators.slice(1)) {
    assert.equal(indicator.normalizedScore, null);
    assert.equal(indicator.weightedContribution, null);
  }
});

test("exposes indicator weights that sum to one", () => {
  assert.deepEqual(scoring.indicators.map((indicator) => [indicator.key, indicator.weight]), [
    ["undergrad_enrollment", 0.30],
    ["pct_on_campus", 0.10],
    ["convenience_1mi", 0.20],
    ["median_family_income", 0.20],
    ["walk_score", 0.20]
  ]);
  assert.deepEqual(scoring.conditions.map((condition) => [condition.key, condition.weight]), [
    ["marketSize", 0.40],
    ["marketNeed", 0.20],
    ["marketAttractiveness", 0.20],
    ["operationalFeasibility", 0.20]
  ]);
  assert.deepEqual(scoring.conditions.map((condition) => [condition.label, condition.indicators]), [
    ["Market Size", ["undergrad_enrollment", "pct_on_campus"]],
    ["Market Need", ["convenience_1mi"]],
    ["Market Attractiveness", ["median_family_income"]],
    ["Operational Feasibility", ["walk_score"]]
  ]);
  assert.deepEqual(scoring.indicators.map((indicator) => indicator.key), [
    "undergrad_enrollment",
    "pct_on_campus",
    "convenience_1mi",
    "median_family_income",
    "walk_score"
  ]);
  assert.ok(scoring.indicators.every((indicator) =>
    !["pct_pell", "grocery_1mi", "nearest_grocery_mi"].includes(indicator.key)
  ));
  const summedWeights = scoring.indicators.reduce((sum, indicator) => sum + indicator.weight, 0);
  assert.ok(Math.abs(scoring.totalWeight - 1) < 1e-12);
  assert.ok(Math.abs(summedWeights - 1) < 1e-12);
});

test("recalculates totals using valid updated weights", () => {
  const weights = Object.fromEntries(scoring.indicators.map((indicator) => [indicator.key, 0]));
  weights.undergrad_enrollment = 1;
  const campus = {
    ...completeCampus,
    undergrad_enrollment: 62031
  };
  const [result] = scoring.scoreComparisons([campus], weights);

  assert.equal(result.total, 100);
  assert.equal(result.indicators[0].weight, 1);
  assert.equal(result.indicators[0].weightedContribution, 100);
  assert.ok(result.indicators.slice(1).every((indicator) => indicator.weight === 0));
});

test("rejects custom weights that do not sum to one", () => {
  const weights = Object.fromEntries(scoring.indicators.map((indicator) => [indicator.key, indicator.weight]));
  weights.undergrad_enrollment = 0.4;

  assert.throws(() => scoring.scoreComparisons([completeCampus], weights), /weights must sum to 1/);
});

test("scores only the 19 comparison campuses in the existing data file", () => {
  global.window = global;
  require("../dashboard-data.js");
  const data = global.SNAG_DATA;
  const results = scoring.scoreComparisons(data.comparisons);

  assert.equal(data.benchmarks.length, 12);
  assert.equal(data.comparisons.length, 19);
  assert.deepEqual(results.map((result) => result.id), data.comparisons.map((campus) => campus.id));
  assert.deepEqual([...results].sort((a, b) => b.total - a.total || a.campus.localeCompare(b.campus))
    .map((result) => result.id), [
    "arizona-state",
    "south-carolina",
    "university-of-michigan",
    "texas-am",
    "florida-state",
    "kentucky",
    "purdue",
    "indiana-university",
    "cal-poly-slo",
    "colorado-state",
    "penn-state",
    "illinois-state",
    "central-michigan",
    "western-michigan",
    "kent-state",
    "baylor",
    "university-of-toledo",
    "eastern-michigan",
    "louisville"
  ]);
  assert.ok(results.every((result) => result.dataCompleteness.availableCount === 5));
  assert.ok(results.every((result) => !result.provisional));
  assert.ok(results.flatMap((result) => result.indicators).every((indicator) =>
    indicator.normalizedScore >= 0 && indicator.normalizedScore <= 100
  ));
  assert.ok(results.every((result) => result.total === Object.values(result.conditionSubtotals)
    .reduce((sum, subtotal) => sum + subtotal, 0)));

  const researchedCampuses = [...data.comparisons, ...data.benchmarks];
  const incomes = researchedCampuses.map((campus) => campus.median_family_income);
  assert.equal(incomes.length, 31);
  assert.ok(incomes.every((value) => typeof value === "number" && Number.isFinite(value)));
  assert.equal(Math.min(...incomes), 72300);
  assert.equal(Math.max(...incomes), 187300);
});

test("higher enrollment, housing, income, and walkability increase priority; more convenience stores decrease it", () => {
  const base = Object.fromEntries(scoring.indicators.map((indicator) => [indicator.key, (indicator.min + indicator.max) / 2]));
  const [baseScore] = scoring.scoreComparisons([base]);
  const [higherEnrollment] = scoring.scoreComparisons([{ ...base, undergrad_enrollment: 62031 }]);
  const [higherHousing] = scoring.scoreComparisons([{ ...base, pct_on_campus: 51 }]);
  const [higherIncome] = scoring.scoreComparisons([{ ...base, median_family_income: 187300 }]);
  const [higherWalk] = scoring.scoreComparisons([{ ...base, walk_score: 98 }]);
  const [moreConvenience] = scoring.scoreComparisons([{ ...base, convenience_1mi: 6 }]);

  assert.ok(higherEnrollment.total > baseScore.total);
  assert.ok(higherHousing.total > baseScore.total);
  assert.ok(higherIncome.total > baseScore.total);
  assert.ok(higherWalk.total > baseScore.total);
  assert.ok(moreConvenience.total < baseScore.total);
});
