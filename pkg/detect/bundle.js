// Zero Hour Tactic Detector — vanilla JS bundle
// Translated 1-to-1 from detector/src/*.ts (no type annotations, same logic).
// Runs inside goja (pure-Go JS engine); no Node.js or browser APIs used.
"use strict";

// ─── Scoring ──────────────────────────────────────────────────────────────────

function timeScore(t, ideal, hard, weight) {
  if (t <= ideal) return weight;
  if (t > hard)   return 0;
  return weight * (hard - t) / (hard - ideal);
}

function toConfidence(pos, pen, maxPos) {
  if (maxPos === 0) return 0;
  var v = ((pos - pen) / maxPos) * 100;
  return Math.max(0, Math.min(100, v));
}

// ─── Feature extraction ───────────────────────────────────────────────────────

function extractFeatures(events, openingEnd) {
  var windowed = [];
  for (var i = 0; i < events.length; i++) {
    if (events[i].time <= openingEnd) windowed.push(events[i]);
  }
  windowed.sort(function (a, b) { return a.time - b.time; });

  var firstTime = {};
  for (var i = 0; i < windowed.length; i++) {
    var ev = windowed[i];
    var key = ev.event + ":" + ev.object;
    if (!(key in firstTime)) firstTime[key] = ev.time;
  }
  return { firstTime: firstTime, events: windowed };
}

function firstTimeOf(ft, event, object) {
  var k = event + ":" + object;
  return (k in ft.firstTime) ? ft.firstTime[k] : Infinity;
}

function countBefore(ft, event, object, before) {
  var n = 0;
  for (var i = 0; i < ft.events.length; i++) {
    var ev = ft.events[i];
    if (ev.event === event && ev.object === object && ev.time < before) n++;
  }
  return n;
}

function countBetween(ft, event, object, from, to) {
  var n = 0;
  for (var i = 0; i < ft.events.length; i++) {
    var ev = ft.events[i];
    if (ev.event === event && ev.object === object && ev.time >= from && ev.time <= to) n++;
  }
  return n;
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

function evalRule(r, ft) {
  switch (r.type) {
    case "exists_before":               return evalExistsBefore(r, ft);
    case "count_before":                return evalCountBefore(r, ft);
    case "exists_between":              return evalExistsBetween(r, ft);
    case "count_between":               return evalCountBetween(r, ft);
    case "sequence_order":              return evalSequenceOrder(r, ft);
    case "not_exists_before":           return evalNotExistsBefore(r, ft);
    case "source_count_before":         return evalSourceCountBefore(r, ft);
    case "ratio_before":                return evalRatioBefore(r, ft);
    case "sell_signal":                 return evalSellSignal(r, ft);
    case "location_region":
    case "location_or_transport_signal":
      // No positional data in normalised events — skip silently
      return { matched: false, points: 0, maxPoints: r.weight || 0, ev: "" };
    default:
      return { matched: false, points: 0, maxPoints: 0, ev: "" };
  }
}

function evalExistsBefore(r, ft) {
  var t = firstTimeOf(ft, r.event, r.object);
  var w = r.weight || 0;

  if (r.ideal_before > 0 && r.hard_before > 0) {
    var pts = isFinite(t) ? timeScore(t, r.ideal_before, r.hard_before, w) : 0;
    var matched = pts > 0;
    return {
      matched: matched, points: pts, maxPoints: w,
      ev: matched ? r.object + " at " + t.toFixed(1) + "s (ideal <" + r.ideal_before + "s)" : ""
    };
  }

  // Strict (gate or negative rule)
  var before = r.before || Infinity;
  var matched = isFinite(t) && t < before;
  return {
    matched: matched, points: matched ? w : 0, maxPoints: w,
    ev: matched ? r.object + " at " + t.toFixed(1) + "s" : ""
  };
}

function evalCountBefore(r, ft) {
  var w = r.weight || 0;
  var count = r.count || 1;

  if (r.ideal_before > 0 && r.hard_before > 0) {
    // Find time of the Nth occurrence and apply soft timing to it
    var nth = 0, nthTime = Infinity;
    for (var i = 0; i < ft.events.length; i++) {
      var ev = ft.events[i];
      if (ev.event === r.event && ev.object === r.object) {
        nth++;
        if (nth >= count) { nthTime = ev.time; break; }
      }
    }
    var pts = isFinite(nthTime) ? timeScore(nthTime, r.ideal_before, r.hard_before, w) : 0;
    var matched = pts > 0;
    return {
      matched: matched, points: pts, maxPoints: w,
      ev: matched ? count + "x " + r.object + " at " + nthTime.toFixed(1) + "s" : ""
    };
  }

  // Strict
  var before = r.before || Infinity;
  var n = countBefore(ft, r.event, r.object, before);
  var matched = n >= count;
  return {
    matched: matched, points: matched ? w : 0, maxPoints: w,
    ev: matched ? n + "x " + r.object + " before " + before + "s" : ""
  };
}

function evalExistsBetween(r, ft) {
  var w = r.weight || 0;
  var matched = countBetween(ft, r.event, r.object, r.from, r.to) > 0;
  return {
    matched: matched, points: matched ? w : 0, maxPoints: w,
    ev: matched ? r.object + " between " + r.from + "-" + r.to + "s" : ""
  };
}

function evalCountBetween(r, ft) {
  var w = r.weight || 0;
  var count = r.count || 1;
  var n = countBetween(ft, r.event, r.object, r.from, r.to);
  var matched = n >= count;
  return {
    matched: matched, points: matched ? w : 0, maxPoints: w,
    ev: matched ? n + "x " + r.object + " between " + r.from + "-" + r.to + "s" : ""
  };
}

function evalSequenceOrder(r, ft) {
  var w = r.weight || 0;
  if (!r.a || !r.b) return { matched: false, points: 0, maxPoints: w, ev: "" };
  var tA = firstTimeOf(ft, r.a.event, r.a.object);
  var tB = firstTimeOf(ft, r.b.event, r.b.object);
  if (!isFinite(tA) || !isFinite(tB)) return { matched: false, points: 0, maxPoints: w, ev: "" };
  var inOrder = tA < tB;
  var gapOk = !r.max_gap || (tB - tA) <= r.max_gap;
  var matched = inOrder && gapOk;
  return {
    matched: matched, points: matched ? w : 0, maxPoints: w,
    ev: matched ? r.a.object + " (" + tA.toFixed(1) + "s) -> " + r.b.object + " (" + tB.toFixed(1) + "s)" : ""
  };
}

function evalNotExistsBefore(r, ft) {
  var t = firstTimeOf(ft, r.event, r.object);
  var matched = !isFinite(t) || t >= r.before;
  return {
    matched: matched, points: matched ? r.weight || 0 : 0, maxPoints: r.weight || 0,
    ev: matched ? "no " + r.object + " before " + r.before + "s" : ""
  };
}

function evalSourceCountBefore(r, ft) {
  var n = 0;
  for (var i = 0; i < ft.events.length; i++) {
    var ev = ft.events[i];
    if (ev.event === r.event && ev.object === r.object &&
        ev.source === r.source && ev.time < r.before) n++;
  }
  var sc = r.source_count || 1;
  var matched = n >= sc;
  return {
    matched: matched, points: matched ? r.weight || 0 : 0, maxPoints: r.weight || 0,
    ev: matched ? n + "x " + r.object + " from " + r.source + " before " + r.before + "s" : ""
  };
}

function evalRatioBefore(r, ft) {
  var w = r.weight || 0;
  if (!r.numerator || !r.denominator) return { matched: false, points: 0, maxPoints: w, ev: "" };
  var num = countBefore(ft, r.numerator.event, r.numerator.object || "", r.before);
  var den = countBefore(ft, r.denominator.event, r.denominator.object || "", r.before);
  if (den === 0) return { matched: false, points: 0, maxPoints: w, ev: "" };
  var ratio = num / den;
  var matched = ratio >= r.min_ratio;
  return {
    matched: matched, points: matched ? w : 0, maxPoints: w,
    ev: matched ? (r.numerator.object || "") + " ratio " + ratio.toFixed(2) + " >= " + r.min_ratio : ""
  };
}

function evalSellSignal(r, ft) {
  var t = firstTimeOf(ft, "sell_building", r.object);
  var matched = isFinite(t) && t < r.before;
  return {
    matched: matched, points: matched ? r.weight || 0 : 0, maxPoints: r.weight || 0,
    ev: matched ? "sold " + r.object + " at " + t.toFixed(1) + "s" : ""
  };
}

// evalCapCondition: returns true when the condition IS present (cap fires when it's absent)
function evalCapCondition(c, ft) {
  return evalRule({ type: c.type, event: c.event, object: c.object,
                    count: c.count, before: c.before }, ft).matched;
}

// ─── Per-tactic scoring ───────────────────────────────────────────────────────

function scoreTactic(t, events) {
  var det = t.detection;
  var openingEnd = (det.opening_window_seconds && det.opening_window_seconds.end) || 300;
  var ft = extractFeatures(events, openingEnd);

  // Gates: any failure eliminates this tactic
  var gates = det.gates || [];
  for (var i = 0; i < gates.length; i++) {
    if (!evalRule(gates[i], ft).matched) return null;
  }

  // Positive rules
  var posPoints = 0, maxPos = 0, evidence = [];
  var posRules = det.positive_rules || [];
  for (var i = 0; i < posRules.length; i++) {
    var res = evalRule(posRules[i], ft);
    posPoints += res.points;
    maxPos += res.maxPoints;
    if (res.matched && res.ev) evidence.push(res.ev);
  }

  // Negative rules (penalties)
  var penalty = 0;
  var negRules = det.negative_rules || [];
  for (var i = 0; i < negRules.length; i++) {
    var res = evalRule(negRules[i], ft);
    if (res.matched) {
      var p = negRules[i].penalty || negRules[i].weight || 0;
      penalty += p;
      evidence.push("[-" + p + "] " + (res.ev || negRules[i].object || ""));
    }
  }

  var conf = toConfidence(posPoints, penalty, maxPos);

  // Caps: if the signature thing is missing, cap the score
  var caps = det.caps || [];
  for (var i = 0; i < caps.length; i++) {
    if (!evalCapCondition(caps[i].if_missing, ft) && conf > caps[i].max_score) {
      conf = caps[i].max_score;
    }
  }

  return { id: t.id, score: conf, evidence: evidence };
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

var DEFAULT_THRESHOLDS = { detected: 70, possible: 55, ambiguous_margin: 10 };

function resolve(playerID, candidates, thresh) {
  thresh = thresh || DEFAULT_THRESHOLDS;
  candidates.sort(function (a, b) { return b.score - a.score; });

  // ── Uniqueness penalty ────────────────────────────────────────────────────
  // When many tactics all score at or above the "detected" threshold the raw
  // confidence numbers are misleading (all showing 100%).  For each extra
  // high-scorer beyond two, subtract 7 pts from every candidate so that
  // replays with ambiguous openings produce realistic confidence values.
  var highScorers = 0;
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].score >= thresh.detected) highScorers++;
  }
  if (highScorers > 2) {
    var penalty = Math.min(30, (highScorers - 2) * 7);
    for (var i = 0; i < candidates.length; i++) {
      candidates[i].score = Math.max(0, candidates[i].score - penalty);
    }
  }

  var publicCands = candidates.slice(0, 5).map(function (c) {
    return { id: c.id, score: Math.round(c.score) };
  });

  var base = { player_id: playerID, candidates: publicCands, evidence: [] };

  if (!candidates.length || candidates[0].score < thresh.possible) {
    base.confidence = candidates.length ? Math.round(candidates[0].score) : 0;
    base.status = "unknown";
    return base;
  }

  var top = candidates[0];
  base.evidence = top.evidence || [];

  if (top.score < thresh.detected) {
    base.detected_tactic = top.id;
    base.confidence = Math.round(top.score);
    base.status = "possible";
    return base;
  }

  if (candidates.length > 1 && top.score - candidates[1].score < thresh.ambiguous_margin) {
    base.confidence = Math.round(top.score);
    base.status = "ambiguous";
    base.evidence = [
      "margin too small: " + top.id + " (" + Math.round(top.score) + ") vs " +
      candidates[1].id + " (" + Math.round(candidates[1].score) + ")"
    ].concat(base.evidence);
    return base;
  }

  base.detected_tactic = top.id;
  base.confidence = Math.round(top.score);
  base.status = "detected";
  return base;
}

// ─── Tactic registry ──────────────────────────────────────────────────────────

var _tacticRegistry = {};

function registerTactics(faction, tacticArray) {
  _tacticRegistry[faction] = (tacticArray || []).filter(function (t) {
    return t.enabled_for_detection !== false;
  });
}

// ─── Main entry point (called by goja) ───────────────────────────────────────

// detectFromJSON is the single bridge between Go and the JS engine.
// Input:  playerID (int), faction (string), eventsJSON (JSON string of NormalizedEvent[])
// Output: JSON string of DetectionResult
function detectFromJSON(playerID, faction, eventsJSON) {
  var events = JSON.parse(eventsJSON);
  var tactics = _tacticRegistry[faction] || [];
  if (!tactics.length) {
    return JSON.stringify({
      player_id: playerID, detected_tactic: null, confidence: 0,
      status: "unknown", candidates: [], evidence: []
    });
  }

  var candidates = [];
  for (var i = 0; i < tactics.length; i++) {
    var c = scoreTactic(tactics[i], events);
    if (c !== null) candidates.push(c);
  }

  var thresh = (tactics[0].detection && tactics[0].detection.thresholds) || DEFAULT_THRESHOLDS;
  var result = resolve(playerID, candidates, thresh);

  // ── Attach tactic metadata (name + description) ───────────────────────────
  // Use detected_tactic when confirmed; fall back to top candidate for
  // ambiguous/possible so the UI always has something meaningful to show.
  var tacticId = result.detected_tactic || (result.candidates && result.candidates[0] && result.candidates[0].id);
  if (tacticId) {
    for (var i = 0; i < tactics.length; i++) {
      if (tactics[i].id === tacticId) {
        result.tactic_name = tactics[i].name || '';
        result.tactic_description = (tactics[i].raw && tactics[i].raw.description) || '';
        // Include matchup / category context when present
        if (tactics[i].category && tactics[i].category.length) {
          result.tactic_category = tactics[i].category.join(', ');
        }
        if (tactics[i].matchup_targets && tactics[i].matchup_targets.length) {
          result.tactic_matchups = tactics[i].matchup_targets.join(', ');
        }
        break;
      }
    }
  }

  return JSON.stringify(result);
}
