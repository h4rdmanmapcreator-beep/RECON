import {
  AnyRule,
  OpeningFeatures,
  RuleResult,
  ExistsBeforeRule,
  CountBeforeRule,
  ExistsBetweenRule,
  CountBetweenRule,
  SequenceOrderRule,
  NotExistsBeforeRule,
  SourceCountBeforeRule,
  RatioBeforeRule,
  LocationRegionRule,
  SellSignalRule,
  CapCondition,
} from "../types";
import { timeScore } from "../scoring";
import { countBefore, countBetween, countSourceBefore, firstTime } from "../featureExtractor";

export function evaluateRule(rule: AnyRule, features: OpeningFeatures): RuleResult {
  switch (rule.type) {
    case "exists_before":
      return evaluateExistsBefore(rule as ExistsBeforeRule, features);
    case "count_before":
      return evaluateCountBefore(rule as CountBeforeRule, features);
    case "exists_between":
      return evaluateExistsBetween(rule as ExistsBetweenRule, features);
    case "count_between":
      return evaluateCountBetween(rule as CountBetweenRule, features);
    case "sequence_order":
      return evaluateSequenceOrder(rule as SequenceOrderRule, features);
    case "not_exists_before":
      return evaluateNotExistsBefore(rule as NotExistsBeforeRule, features);
    case "source_count_before":
      return evaluateSourceCountBefore(rule as SourceCountBeforeRule, features);
    case "ratio_before":
      return evaluateRatioBefore(rule as RatioBeforeRule, features);
    case "sell_signal":
      return evaluateSellSignal(rule as SellSignalRule, features);
    // location_region and location_or_transport_signal: no positional data in normalized events
    case "location_region":
    case "location_or_transport_signal":
      return evaluateLocationRegion(rule as LocationRegionRule, features);
    case "cancel_penalty":
      // cancel events are already stripped; always 0 penalty here
      return { matched: false, points: 0, maxPoints: 0 };
    default:
      return { matched: false, points: 0, maxPoints: 0 };
  }
}

// ── exists_before ─────────────────────────────────────────────────────────────

function evaluateExistsBefore(
  rule: ExistsBeforeRule,
  features: OpeningFeatures
): RuleResult {
  const t = firstTime(features, rule.event, rule.object);
  const weight = rule.weight ?? 0;
  const penalty = rule.penalty ?? 0;
  const maxPoints = Math.max(weight, penalty);

  // Positive rule (has ideal/hard timings)
  if (rule.ideal_before !== undefined && rule.hard_before !== undefined) {
    const points = t < Infinity ? timeScore(t, rule.ideal_before, rule.hard_before, weight) : 0;
    const matched = points > 0;
    const evidence = matched
      ? `${rule.object} started at ${t.toFixed(1)}s (ideal <${rule.ideal_before}s)`
      : undefined;
    return { matched, points, maxPoints: weight, evidence };
  }

  // Gate / negative rule (strict before)
  const before = rule.before ?? rule.hard_before ?? Infinity;
  const matched = t < before;
  const evidence = matched
    ? `${rule.object} at ${t.toFixed(1)}s`
    : undefined;
  return { matched, points: matched ? weight : 0, maxPoints: weight, evidence };
}

// ── count_before ──────────────────────────────────────────────────────────────

function evaluateCountBefore(
  rule: CountBeforeRule,
  features: OpeningFeatures
): RuleResult {
  const weight = rule.weight ?? 0;

  if (rule.ideal_before !== undefined && rule.hard_before !== undefined) {
    // Find the time of the Nth occurrence
    let nth = 0;
    let nthTime = Infinity;
    for (const ev of features.events) {
      if (ev.event === rule.event && ev.object === rule.object) {
        nth++;
        if (nth >= rule.count) {
          nthTime = ev.time;
          break;
        }
      }
    }
    const points = nthTime < Infinity
      ? timeScore(nthTime, rule.ideal_before, rule.hard_before, weight)
      : 0;
    const matched = points > 0;
    const evidence = matched
      ? `${rule.count}x ${rule.object} (${rule.event}) reached at ${nthTime.toFixed(1)}s`
      : undefined;
    return { matched, points, maxPoints: weight, evidence };
  }

  // Strict gate / negative rule
  const before = rule.before ?? rule.hard_before ?? Infinity;
  const count = countBefore(features, rule.event, rule.object, before);
  const matched = count >= rule.count;
  const evidence = matched
    ? `${count}x ${rule.object} before ${before}s`
    : undefined;
  return { matched, points: matched ? (rule.weight ?? 0) : 0, maxPoints: weight, evidence };
}

// ── exists_between ────────────────────────────────────────────────────────────

function evaluateExistsBetween(
  rule: ExistsBetweenRule,
  features: OpeningFeatures
): RuleResult {
  const weight = rule.weight ?? 0;
  const count = countBetween(features, rule.event, rule.object, rule.from, rule.to);
  const matched = count > 0;
  return {
    matched,
    points: matched ? weight : 0,
    maxPoints: weight,
    evidence: matched ? `${rule.object} between ${rule.from}s–${rule.to}s` : undefined,
  };
}

// ── count_between ─────────────────────────────────────────────────────────────

function evaluateCountBetween(
  rule: CountBetweenRule,
  features: OpeningFeatures
): RuleResult {
  const weight = rule.weight ?? 0;
  const count = countBetween(features, rule.event, rule.object, rule.from, rule.to);
  const matched = count >= rule.count;
  return {
    matched,
    points: matched ? weight : 0,
    maxPoints: weight,
    evidence: matched
      ? `${count}x ${rule.object} between ${rule.from}s–${rule.to}s`
      : undefined,
  };
}

// ── sequence_order ────────────────────────────────────────────────────────────

function evaluateSequenceOrder(
  rule: SequenceOrderRule,
  features: OpeningFeatures
): RuleResult {
  const tA = firstTime(features, rule.a.event, rule.a.object);
  const tB = firstTime(features, rule.b.event, rule.b.object);
  if (tA === Infinity || tB === Infinity) {
    return { matched: false, points: 0, maxPoints: rule.weight };
  }
  const inOrder = tA < tB;
  const gapOk = rule.max_gap === undefined || tB - tA <= rule.max_gap;
  const matched = inOrder && gapOk;
  return {
    matched,
    points: matched ? rule.weight : 0,
    maxPoints: rule.weight,
    evidence: matched
      ? `${rule.a.object} (${tA.toFixed(1)}s) → ${rule.b.object} (${tB.toFixed(1)}s)`
      : undefined,
  };
}

// ── not_exists_before ─────────────────────────────────────────────────────────

function evaluateNotExistsBefore(
  rule: NotExistsBeforeRule,
  features: OpeningFeatures
): RuleResult {
  const t = firstTime(features, rule.event, rule.object);
  const matched = t >= rule.before;
  return {
    matched,
    points: matched ? rule.weight : 0,
    maxPoints: rule.weight,
    evidence: matched ? `No ${rule.object} before ${rule.before}s` : undefined,
  };
}

// ── source_count_before ───────────────────────────────────────────────────────

function evaluateSourceCountBefore(
  rule: SourceCountBeforeRule,
  features: OpeningFeatures
): RuleResult {
  const n = countSourceBefore(features, rule.event, rule.object, rule.source, rule.before);
  const matched = n >= rule.source_count;
  return {
    matched,
    points: matched ? rule.weight : 0,
    maxPoints: rule.weight,
    evidence: matched
      ? `${n}x ${rule.object} from ${rule.source} before ${rule.before}s`
      : undefined,
  };
}

// ── ratio_before ──────────────────────────────────────────────────────────────

function evaluateRatioBefore(
  rule: RatioBeforeRule,
  features: OpeningFeatures
): RuleResult {
  const numCount = rule.numerator.object
    ? countBefore(features, rule.numerator.event, rule.numerator.object, rule.before)
    : features.events.filter(
        (e) => e.event === rule.numerator.event && e.time < rule.before
      ).length;

  const denCount = rule.denominator.object
    ? countBefore(features, rule.denominator.event, rule.denominator.object, rule.before)
    : features.events.filter(
        (e) => e.event === rule.denominator.event && e.time < rule.before
      ).length;

  if (denCount === 0) return { matched: false, points: 0, maxPoints: rule.weight };
  const ratio = numCount / denCount;
  const matched = ratio >= rule.min_ratio;
  return {
    matched,
    points: matched ? rule.weight : 0,
    maxPoints: rule.weight,
    evidence: matched
      ? `${rule.numerator.object ?? "units"} ratio ${ratio.toFixed(2)} >= ${rule.min_ratio}`
      : undefined,
  };
}

// ── location_region ───────────────────────────────────────────────────────────

function evaluateLocationRegion(
  rule: LocationRegionRule,
  _features: OpeningFeatures
): RuleResult {
  // Normalized events carry no positional data, so these rules can never match.
  // maxPoints must stay 0 or their weight would inflate the score denominator
  // and cap the achievable confidence of the whole tactic.
  return { matched: false, points: 0, maxPoints: 0 };
}

// ── sell_signal ───────────────────────────────────────────────────────────────

function evaluateSellSignal(
  rule: SellSignalRule,
  features: OpeningFeatures
): RuleResult {
  const t = firstTime(features, "sell_building", rule.object);
  const matched = t < rule.before;
  return {
    matched,
    points: matched ? rule.weight : 0,
    maxPoints: rule.weight,
    evidence: matched ? `Sold ${rule.object} at ${t.toFixed(1)}s` : undefined,
  };
}

// ── Gate check (strict, no scoring) ──────────────────────────────────────────

/**
 * Gates are pass/fail. If any gate fails, this tactic is impossible.
 */
export function passesGates(gates: AnyRule[], features: OpeningFeatures): boolean {
  for (const gate of gates) {
    const result = evaluateRule(gate, features);
    if (!result.matched) return false;
  }
  return true;
}

/**
 * Evaluate a cap condition (same logic as a gate — matched = condition present).
 * A cap fires when the condition is NOT met (if_missing).
 */
export function evaluateCapCondition(
  cond: CapCondition,
  features: OpeningFeatures
): boolean {
  const syntheticRule = { ...cond } as AnyRule;
  const result = evaluateRule(syntheticRule, features);
  return result.matched;
}

