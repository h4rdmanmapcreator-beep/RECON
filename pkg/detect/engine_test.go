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
