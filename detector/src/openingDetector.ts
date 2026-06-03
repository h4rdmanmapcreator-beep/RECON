import {
  DetectionResult,
  DetectorInput,
  Faction,
  NormalizedEvent,
  Thresholds,
  TacticTemplate,
} from "./types";
import { extractFeatures } from "./featureExtractor";
import { evaluateRule, passesGates, evaluateCapCondition } from "./rules/ruleEvaluator";
import { toConfidence } from "./scoring";
import { resolveCandidates } from "./resolver";
import { loadTactics } from "./tacticLoader";

const DEFAULT_OPENING_END = 300;
const DEFAULT_THRESHOLDS: Thresholds = {
  detected: 70,
  possible: 55,
  ambiguous_margin: 10,
};

// ── Public API ────────────────────────────────────────────────────────────────

export function detectOpenings(input: DetectorInput): DetectionResult[] {
  return input.players.map((player) =>
    detectPlayer(player.player_id, player.faction, player.normalized_events)
  );
}

export function detectPlayer(
  playerId: number,
  faction: Faction,
  events: NormalizedEvent[]
): DetectionResult {
  // 1. Load tactics for this faction
  const tactics = loadTactics(faction);

  // 2. Score each tactic
  const scoredCandidates = tactics
    .map((tactic) => scoreTactic(tactic, events))
    .filter((c) => c !== null) as Array<{ id: string; score: number; evidence: string[] }>;

  // 3. Resolve ambiguity and return
  const thresholds =
    tactics[0]?.detection?.thresholds ?? DEFAULT_THRESHOLDS;

  return resolveCandidates(playerId, scoredCandidates, thresholds);
}

// ── Per-tactic scoring ────────────────────────────────────────────────────────

function scoreTactic(
  tactic: TacticTemplate,
  events: NormalizedEvent[]
): { id: string; score: number; evidence: string[] } | null {
  const det = tactic.detection;
  const openingEnd =
    det.opening_window_seconds?.end ?? DEFAULT_OPENING_END;

  // Step 4 — Extract features
  const features = extractFeatures(events, openingEnd);

  // Step 5 — Gate check
  if (det.gates?.length && !passesGates(det.gates, features)) return null;

  // Step 6 — Score positive rules
  let positivePoints = 0;
  let maxPositivePoints = 0;
  const evidence: string[] = [];

  for (const rule of det.positive_rules ?? []) {
    const result = evaluateRule(rule, features);
    positivePoints += result.points;
    maxPositivePoints += result.maxPoints;
    if (result.matched && result.evidence) evidence.push(result.evidence);
  }

  // Step 7 — Apply negative rules
  let penaltyPoints = 0;
  for (const rule of det.negative_rules ?? []) {
    const result = evaluateRule(rule, features);
    // Negative rules carry `penalty` not `weight`
    const penalty = (rule as any).penalty ?? (rule as any).weight ?? 0;
    if (result.matched) {
      penaltyPoints += penalty;
      const desc = result.evidence ?? `${(rule as any).object} penalty`;
      evidence.push(`[-${penalty}] ${desc}`);
    }
  }

  // Step 8 — Compute raw confidence
  let confidence = toConfidence(positivePoints, penaltyPoints, maxPositivePoints);

  // Step 8b — Apply caps
  for (const cap of det.caps ?? []) {
    const conditionMet = evaluateCapCondition(cap.if_missing, features);
    if (!conditionMet && confidence > cap.max_score) {
      confidence = cap.max_score;
    }
  }

  return { id: tactic.id, score: confidence, evidence };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  const sampleInput: DetectorInput = {
    game_id: "replay_demo",
    map: "Tournament Desert",
    players: [
      {
        player_id: 1,
        faction: "china",
        normalized_events: [
          { time: 5, player_id: 1, event: "building_start", object: "supply_center" },
          { time: 20, player_id: 1, event: "building_start", object: "barracks" },
          { time: 60, player_id: 1, event: "unit_start", object: "supply_truck" },
          { time: 72, player_id: 1, event: "building_start", object: "war_factory" },
          { time: 92, player_id: 1, event: "building_start", object: "war_factory" },
          { time: 104, player_id: 1, event: "building_start", object: "airfield" },
          { time: 116, player_id: 1, event: "unit_start", object: "gattling_tank" },
          { time: 122, player_id: 1, event: "unit_start", object: "tank_hunter" },
          { time: 130, player_id: 1, event: "unit_start", object: "tank_hunter" },
          { time: 145, player_id: 1, event: "unit_start", object: "gattling_tank" },
          { time: 165, player_id: 1, event: "unit_start", object: "helix" },
        ],
      },
    ],
  };

  const results = detectOpenings(sampleInput);
  console.log(JSON.stringify(results, null, 2));
}
