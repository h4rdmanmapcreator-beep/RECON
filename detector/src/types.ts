// ─── Core event types ────────────────────────────────────────────────────────

export type Faction = "usa" | "china" | "gla" | "mixed";

export type EventType =
  | "building_start"
  | "building_complete"
  | "unit_start"
  | "unit_complete"
  | "upgrade_start"
  | "upgrade_complete"
  | "sell_building"
  | "cancel"
  | "general_power_pick"
  | "unit_command";

export type NormalizedEvent = {
  time: number;
  player_id: number;
  event: string;
  object: string;
  source?: string;
  source_index?: number;
  x?: number;
  y?: number;
  cancelled?: boolean;
};

// ─── Feature index ────────────────────────────────────────────────────────────

export type OpeningFeatures = {
  /** "event:object" → earliest occurrence time */
  first_time: Record<string, number>;
  /** object name → count in opening window */
  early_units: Record<string, number>;
  early_buildings: Record<string, number>;
  /** ordered list of objects produced (start events only) */
  sequence: string[];
  /** raw events, filtered to opening window, excluding fast-cancels */
  events: NormalizedEvent[];
};

// ─── Rule types ───────────────────────────────────────────────────────────────

export type RuleBase = {
  id?: string;
  type: string;
  source?: string;
};

export type ExistsBeforeRule = RuleBase & {
  type: "exists_before";
  event: string;
  object: string;
  /** used in gates (strict) or negative rules */
  before?: number;
  /** used in positive rules (soft timing) */
  ideal_before?: number;
  hard_before?: number;
  weight?: number;
  penalty?: number;
};

export type CountBeforeRule = RuleBase & {
  type: "count_before";
  event: string;
  object: string;
  count: number;
  before?: number;
  ideal_before?: number;
  hard_before?: number;
  weight?: number;
  penalty?: number;
};

export type ExistsBetweenRule = RuleBase & {
  type: "exists_between";
  event: string;
  object: string;
  from: number;
  to: number;
  weight?: number;
  penalty?: number;
};

export type CountBetweenRule = RuleBase & {
  type: "count_between";
  event: string;
  object: string;
  count: number;
  from: number;
  to: number;
  weight?: number;
  penalty?: number;
};

export type FirstBeforeRule = RuleBase & {
  type: "first_before";
  event: string;
  object: string;
  ideal_before: number;
  hard_before: number;
  weight: number;
};

export type SequenceOrderRule = RuleBase & {
  type: "sequence_order";
  a: { event: string; object: string };
  b: { event: string; object: string };
  /** max seconds between a and b — optional, no limit if absent */
  max_gap?: number;
  weight: number;
};

export type NotExistsBeforeRule = RuleBase & {
  type: "not_exists_before";
  event: string;
  object: string;
  before: number;
  weight: number;
};

export type SourceCountBeforeRule = RuleBase & {
  type: "source_count_before";
  event: string;
  object: string;
  source: string;
  source_count: number;
  before: number;
  weight: number;
};

export type RatioBeforeRule = RuleBase & {
  type: "ratio_before";
  before: number;
  numerator: { event: string; object?: string; object_group?: string };
  denominator: { event: string; object?: string; object_group?: string };
  min_ratio: number;
  weight: number;
};

export type LocationRegionRule = RuleBase & {
  type: "location_region" | "location_or_transport_signal";
  event?: string;
  object?: string;
  region?: string;
  weight?: number;
  penalty?: number;
};

export type SellSignalRule = RuleBase & {
  type: "sell_signal";
  object: string;
  before: number;
  weight: number;
};

export type CancelPenaltyRule = RuleBase & {
  type: "cancel_penalty";
  event: string;
  object: string;
  within_seconds: number;
  penalty: number;
};

export type AnyRule =
  | ExistsBeforeRule
  | CountBeforeRule
  | ExistsBetweenRule
  | CountBetweenRule
  | FirstBeforeRule
  | SequenceOrderRule
  | NotExistsBeforeRule
  | SourceCountBeforeRule
  | RatioBeforeRule
  | LocationRegionRule
  | SellSignalRule
  | CancelPenaltyRule
  | RuleBase;

// ─── Caps & thresholds ────────────────────────────────────────────────────────

export type CapCondition = {
  type: string;
  event?: string;
  object?: string;
  count?: number;
  before?: number;
};

export type Cap = {
  if_missing: CapCondition;
  max_score: number;
};

export type Thresholds = {
  detected: number;
  possible: number;
  ambiguous_margin: number;
};

// ─── Tactic template (as stored in JSON) ─────────────────────────────────────

export type TacticTemplate = {
  id: string;
  name: string;
  faction: Faction | Faction[];
  allowed_generals?: string[];
  scope?: string;
  category?: string[];
  matchup_targets?: string[];
  enabled_for_detection?: boolean;
  detection: {
    opening_window_seconds?: { start: number; end: number };
    gates?: AnyRule[];
    positive_rules: AnyRule[];
    negative_rules?: AnyRule[];
    caps?: Cap[];
    thresholds?: Thresholds;
  };
};

// ─── Detector I/O ─────────────────────────────────────────────────────────────

export type DetectorInput = {
  game_id: string;
  map?: string;
  players: Array<{
    player_id: number;
    faction: Faction;
    normalized_events: NormalizedEvent[];
  }>;
};

export type CandidateScore = {
  id: string;
  score: number;
};

export type DetectionResult = {
  player_id: number;
  detected_tactic: string | null;
  confidence: number;
  status: "detected" | "possible" | "ambiguous" | "unknown";
  candidates: CandidateScore[];
  evidence: string[];
};

export type RuleResult = {
  matched: boolean;
  points: number;
  maxPoints: number;
  evidence?: string;
};
