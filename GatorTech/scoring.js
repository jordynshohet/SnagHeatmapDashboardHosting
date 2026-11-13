(function (root, factory) {
  const scoring = factory();
  if (typeof module === "object" && module.exports) module.exports = scoring;
  if (root) root.SNAG_SCORING = scoring;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  const indicators = Object.freeze([
    Object.freeze({ key: "undergrad_enrollment", min: 10224, max: 62031, direction: "higher", weight: 0.30 }),
    Object.freeze({ key: "pct_on_campus", min: 5, max: 51, direction: "higher", weight: 0.10 }),
    Object.freeze({ key: "convenience_1mi", min: 1, max: 6, direction: "lower", weight: 0.20 }),
    Object.freeze({ key: "median_family_income", min: 72300, max: 187300, direction: "higher", weight: 0.20 }),
    Object.freeze({ key: "walk_score", min: 34, max: 98, direction: "higher", weight: 0.20 })
  ]);
  const conditions = Object.freeze([
    Object.freeze({
      key: "marketSize",
      label: "Market Size",
      question: "How many potential customers are there?",
      description: "Undergraduate enrollment measures the size of the potential student customer base; on-campus housing measures the concentration of students living on campus.",
      weight: 0.40,
      indicators: Object.freeze(["undergrad_enrollment", "pct_on_campus"])
    }),
    Object.freeze({
      key: "marketNeed",
      label: "Market Need",
      question: "How much value could Snag provide students?",
      description: "Fewer nearby convenience stores may indicate a greater unmet need for snack and convenience delivery.",
      weight: 0.20,
      indicators: Object.freeze(["convenience_1mi"])
    }),
    Object.freeze({
      key: "marketAttractiveness",
      label: "Market Attractiveness",
      question: "Do students have the purchasing power to use Snag's service?",
      description: "Higher median family income is treated as a proxy for purchasing power.",
      weight: 0.20,
      indicators: Object.freeze(["median_family_income"])
    }),
    Object.freeze({
      key: "operationalFeasibility",
      label: "Operational Feasibility",
      question: "How suitable is the campus environment for Snag's scooter-based delivery model?",
      description: "Higher Walk Score is assumed to indicate more favorable pedestrian connectivity for scooter-based delivery. Walk Score does not directly measure scooter regulations or infrastructure.",
      weight: 0.20,
      indicators: Object.freeze(["walk_score"])
    })
  ]);

  const totalWeight = indicators.reduce((sum, indicator) => sum + indicator.weight, 0);
  if (Math.abs(totalWeight - 1) > Number.EPSILON * indicators.length) {
    throw new Error(`Scoring indicator weights must sum to 1; received ${totalWeight}.`);
  }
  function numericValue(rawValue) {
    if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue : null;
    if (typeof rawValue !== "string") return null;

    const normalized = rawValue.trim();
    if (!/^[-+]?(?:\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    const value = Number(normalized.replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }

  function normalizedScore(value, indicator) {
    const span = indicator.max - indicator.min;
    const score = indicator.direction === "higher"
      ? 100 * (value - indicator.min) / span
      : 100 * (indicator.max - value) / span;
    return Math.max(0, Math.min(100, score));
  }

  function scoreComparisons(comparisons, weights = null) {
    if (!Array.isArray(comparisons)) {
      throw new TypeError("scoreComparisons expects an array of comparison campuses.");
    }

    const activeWeights = new Map(indicators.map((indicator) => {
      const weight = weights === null ? indicator.weight : weights[indicator.key];
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
        throw new TypeError(`Weight for ${indicator.key} must be a finite, non-negative number.`);
      }
      return [indicator.key, weight];
    }));
    const activeWeightTotal = [...activeWeights.values()].reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(activeWeightTotal - 1) > 1e-10) {
      throw new RangeError(`Scoring weights must sum to 1; received ${activeWeightTotal}.`);
    }

    return comparisons.map((campus) => {
      const scoredIndicators = indicators.map((indicator) => {
        const rawValue = campus[indicator.key] ?? null;
        const value = numericValue(rawValue);
        const score = value === null ? null : normalizedScore(value, indicator);
        const weight = activeWeights.get(indicator.key);

        return {
          key: indicator.key,
          rawValue,
          normalizedScore: score,
          weight,
          weightedContribution: score === null ? null : score * weight,
          min: indicator.min,
          max: indicator.max,
          direction: indicator.direction
        };
      });

      const available = scoredIndicators.filter((indicator) => indicator.normalizedScore !== null);
      const completeness = {
        availableCount: available.length,
        indicatorCount: indicators.length,
        fraction: available.length / indicators.length,
        missingKeys: scoredIndicators
          .filter((indicator) => indicator.normalizedScore === null)
          .map((indicator) => indicator.key)
      };
      const conditionSubtotals = Object.fromEntries(conditions.map((condition) => {
        const subtotal = scoredIndicators
          .filter((indicator) => condition.indicators.includes(indicator.key))
          .reduce((sum, indicator) => sum + (indicator.weightedContribution ?? 0), 0);
        return [condition.key, subtotal];
      }));
      const total = available.length
        ? Object.values(conditionSubtotals).reduce((sum, subtotal) => sum + subtotal, 0)
        : null;

      return {
        id: campus.id ?? null,
        campus: campus.campus ?? null,
        state: campus.state ?? null,
        total,
        conditionSubtotals,
        provisional: completeness.availableCount !== completeness.indicatorCount,
        dataCompleteness: completeness,
        indicators: scoredIndicators
      };
    });
  }

  return Object.freeze({
    indicators,
    conditions,
    totalWeight,
    scoreComparisons
  });
});
