/**
 * Minimal test runner — add labeled samples here, compare against expected tactic IDs.
 *
 * Usage:  ts-node src/test/runTests.ts
 */

import { detectPlayer } from "../openingDetector";
import { Faction, NormalizedEvent } from "../types";

type LabeledSample = {
  id: string;
  faction: Faction;
  expected: string;
  events: NormalizedEvent[];
};

const samples: LabeledSample[] = [
  // ── China: Normal Dual WF ──────────────────────────────────────────────────
  {
    id: "china_dual_wf_basic",
    faction: "china",
    expected: "china_1v1_001_normal_dual_wf",
    events: [
      { time: 5, player_id: 1, event: "building_start", object: "supply_center" },
      { time: 20, player_id: 1, event: "building_start", object: "barracks" },
      { time: 60, player_id: 1, event: "unit_start", object: "supply_truck" },
      { time: 75, player_id: 1, event: "building_start", object: "war_factory" },
      { time: 95, player_id: 1, event: "building_start", object: "war_factory" },
      { time: 120, player_id: 1, event: "unit_start", object: "gattling_tank" },
      { time: 135, player_id: 1, event: "unit_start", object: "gattling_tank" },
      { time: 150, player_id: 1, event: "unit_start", object: "tank_hunter" },
    ],
  },

  // ── USA: 2 Airfields ───────────────────────────────────────────────────────
  {
    id: "usa_2af_basic",
    faction: "usa",
    expected: "usa_1v1_006_2_airfields",
    events: [
      { time: 5, player_id: 1, event: "building_start", object: "supply_center" },
      { time: 50, player_id: 1, event: "building_start", object: "airfield" },
      { time: 100, player_id: 1, event: "building_start", object: "airfield" },
      { time: 140, player_id: 1, event: "unit_start", object: "king_raptor" },
      { time: 160, player_id: 1, event: "unit_start", object: "king_raptor" },
      { time: 180, player_id: 1, event: "unit_start", object: "king_raptor" },
    ],
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

type SampleResult = {
  id: string;
  expected: string;
  actual: string | null;
  status: string;
  confidence: number;
  top2Hit: boolean;
  pass: boolean;
};

function runTests(): void {
  const results: SampleResult[] = [];

  for (const sample of samples) {
    const det = detectPlayer(1, sample.faction, sample.events);
    const top2Ids = det.candidates.slice(0, 2).map((c) => c.id);
    const top2Hit = top2Ids.includes(sample.expected);
    const pass = det.detected_tactic === sample.expected;

    results.push({
      id: sample.id,
      expected: sample.expected,
      actual: det.detected_tactic,
      status: det.status,
      confidence: det.confidence,
      top2Hit,
      pass,
    });
  }

  const total = results.length;
  const top1Pass = results.filter((r) => r.pass).length;
  const top2Pass = results.filter((r) => r.top2Hit).length;
  const unknown = results.filter((r) => r.status === "unknown").length;
  const ambiguous = results.filter((r) => r.status === "ambiguous").length;

  console.log("=== Zero Hour Tactic Detector Test Results ===\n");
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    const top2 = r.top2Hit && !r.pass ? " (top-2 hit)" : "";
    console.log(
      `${icon} [${r.id}] expected=${r.expected} actual=${r.actual ?? "null"} conf=${r.confidence} status=${r.status}${top2}`
    );
    if (!r.pass) {
      // Print candidates for debugging
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Top-1 accuracy:  ${top1Pass}/${total} (${((top1Pass / total) * 100).toFixed(0)}%)`);
  console.log(`  Top-2 accuracy:  ${top2Pass}/${total} (${((top2Pass / total) * 100).toFixed(0)}%)`);
  console.log(`  Unknown rate:    ${unknown}/${total}`);
  console.log(`  Ambiguous rate:  ${ambiguous}/${total}`);
}

runTests();
