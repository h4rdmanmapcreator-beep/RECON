package detect

import (
	"testing"
)

func TestDetectPlayer_China_DualWF(t *testing.T) {
	// Simulate a China player going Dual WF (two war factories before 100s)
	events := []NormalizedEvent{
		{Time: 5, Event: "building_start", Object: "supply_center"},
		{Time: 20, Event: "building_start", Object: "barracks"},
		{Time: 60, Event: "unit_start", Object: "supply_truck"},
		{Time: 75, Event: "building_start", Object: "war_factory"},
		{Time: 95, Event: "building_start", Object: "war_factory"},
		{Time: 120, Event: "unit_start", Object: "gattling_tank"},
		{Time: 135, Event: "unit_start", Object: "gattling_tank"},
		{Time: 150, Event: "unit_start", Object: "tank_hunter"},
	}

	result, err := DetectPlayer(1, "china", events)
	if err != nil {
		t.Fatalf("DetectPlayer returned error: %v", err)
	}

	if result.Status == "unknown" {
		t.Errorf("expected a detection, got status=unknown (confidence=%v)", result.Confidence)
	}

	t.Logf("status=%s detected=%q confidence=%.0f", result.Status, result.DetectedTactic, result.Confidence)
	for _, ev := range result.Evidence {
		t.Logf("  evidence: %s", ev)
	}
	t.Logf("top candidates:")
	for _, c := range result.Candidates {
		t.Logf("  %s → %.0f", c.ID, c.Score)
	}
}

func TestDetectPlayer_UnknownFaction(t *testing.T) {
	result, err := DetectPlayer(1, "martian", []NormalizedEvent{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != "unknown" {
		t.Errorf("expected unknown, got %s", result.Status)
	}
}

func TestDetectPlayer_EmptyEvents(t *testing.T) {
	result, err := DetectPlayer(1, "usa", []NormalizedEvent{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// With no events every rule scores 0, so result should be unknown/possible-at-most
	t.Logf("empty events → status=%s confidence=%.0f", result.Status, result.Confidence)
}

// candidateScore returns the raw score of a candidate id, or -1 if absent.
func candidateScore(result DetectionResult, id string) float64 {
	for _, c := range result.Candidates {
		if c.ID == id {
			return c.Score
		}
	}
	return -1
}

// TestDetectPlayer_TankDrop guards the Phase D fix: usa_1v1_007_tank_drop
// previously had only a positional "drop" rule, so its achievable score was 0
// and it could never be detected. It now carries observable proxies
// (war factory, mass Crusaders, Chinook, dual supply) and must score.
func TestDetectPlayer_TankDrop(t *testing.T) {
	events := []NormalizedEvent{
		{Time: 30, Event: "building_start", Object: "supply_center"},
		{Time: 80, Event: "building_start", Object: "supply_center"},
		{Time: 90, Event: "building_start", Object: "war_factory"},
		{Time: 120, Event: "unit_start", Object: "crusader_tank"},
		{Time: 130, Event: "unit_start", Object: "crusader_tank"},
		{Time: 140, Event: "unit_start", Object: "crusader_tank"},
		{Time: 145, Event: "unit_start", Object: "chinook"},
	}
	result, err := DetectPlayer(1, "usa", events)
	if err != nil {
		t.Fatalf("DetectPlayer error: %v", err)
	}
	if score := candidateScore(result, "usa_1v1_007_tank_drop"); score < 70 {
		t.Errorf("tank_drop should score >= 70 on its observable signature, got %.0f (status=%s)", score, result.Status)
	}
	t.Logf("tank_drop: status=%s top=%q conf=%.0f", result.Status, result.DetectedTactic, result.Confidence)
}

// TestDetectPlayer_LocationRuleNotDeflating guards the Phase A fix. A tactic
// that mixes observable rules with unmatchable positional rules
// (usa_1v1_008_fast_pat_drop) must still be able to reach the detected
// threshold — the positional rule must contribute 0 to the score denominator.
func TestDetectPlayer_LocationRuleNotDeflating(t *testing.T) {
	events := []NormalizedEvent{
		{Time: 55, Event: "building_start", Object: "supply_center"},
		{Time: 100, Event: "building_start", Object: "patriot"},
		{Time: 130, Event: "unit_start", Object: "crusader_tank"},
		{Time: 140, Event: "unit_start", Object: "chinook"},
		{Time: 150, Event: "unit_start", Object: "dozer"},
	}
	result, err := DetectPlayer(1, "usa", events)
	if err != nil {
		t.Fatalf("DetectPlayer error: %v", err)
	}
	if score := candidateScore(result, "usa_1v1_008_fast_pat_drop"); score < 70 {
		t.Errorf("fast_pat_drop capped below detected despite full observable match: %.0f", score)
	}
}
