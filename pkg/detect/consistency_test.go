package detect

import (
	"encoding/json"
	"os"
	"testing"
)

// tacticDoc is a minimal view of the tactic template JSON, just enough to
// synthesize a matching event stream and read the thresholds.
type tacticDoc struct {
	ID                  string `json:"id"`
	EnabledForDetection *bool  `json:"enabled_for_detection"`
	Detection           struct {
		Gates         []ruleDoc `json:"gates"`
		PositiveRules []ruleDoc `json:"positive_rules"`
		Thresholds    struct {
			Detected float64 `json:"detected"`
			Possible float64 `json:"possible"`
		} `json:"thresholds"`
	} `json:"detection"`
}

type ruleDoc struct {
	Type        string  `json:"type"`
	Event       string  `json:"event"`
	Object      string  `json:"object"`
	Count       int     `json:"count"`
	Before      float64 `json:"before"`
	IdealBefore float64 `json:"ideal_before"`
	HardBefore  float64 `json:"hard_before"`
	From        float64 `json:"from"`
}

// synthEvents builds an event stream that satisfies a tactic's gates and the
// observable (non-positional) positive rules at their ideal timing.
func synthEvents(doc tacticDoc) []NormalizedEvent {
	var events []NormalizedEvent
	add := func(r ruleDoc, at float64) {
		if r.Event == "" || r.Object == "" {
			return
		}
		if at < 1 {
			at = 1
		}
		events = append(events, NormalizedEvent{Time: at, Event: r.Event, Object: r.Object})
	}
	for _, g := range doc.Detection.Gates {
		before := g.Before
		if before == 0 {
			before = g.HardBefore
		}
		if before == 0 {
			before = 20
		}
		n := g.Count
		if n == 0 {
			n = 1
		}
		for i := 0; i < n; i++ {
			add(g, before-1-float64(i))
		}
	}
	for _, r := range doc.Detection.PositiveRules {
		switch r.Type {
		case "exists_before":
			add(r, r.IdealBefore-2)
		case "count_before":
			n := r.Count
			if n == 0 {
				n = 1
			}
			for i := 0; i < n; i++ {
				add(r, r.IdealBefore-2-float64(i))
			}
		case "exists_between", "count_between":
			n := r.Count
			if n == 0 {
				n = 1
			}
			for i := 0; i < n; i++ {
				add(r, r.From+1+float64(i))
			}
		}
		// location_* rules carry no observable object and are skipped.
	}
	return events
}

// TestTacticSelfConsistency feeds every enabled tactic an event stream built
// from its own signature and asserts it can score at least the "possible"
// threshold. This guards against tactics whose only signals are unobservable
// (e.g. positional rules that can never match) — which would make them
// permanently undetectable — and against future data regressions.
func TestTacticSelfConsistency(t *testing.T) {
	factions := map[string]string{
		"china": "tactics/china.json",
		"usa":   "tactics/usa.json",
		"gla":   "tactics/gla.json",
	}
	for faction, path := range factions {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		var docs []tacticDoc
		if err := json.Unmarshal(raw, &docs); err != nil {
			t.Fatalf("unmarshal %s: %v", path, err)
		}
		for _, doc := range docs {
			if doc.EnabledForDetection != nil && !*doc.EnabledForDetection {
				continue
			}
			events := synthEvents(doc)
			result, err := DetectPlayer(1, faction, events)
			if err != nil {
				t.Fatalf("DetectPlayer(%s): %v", doc.ID, err)
			}
			// A tactic fed its own signature must produce a scoreable result.
			// "unknown" means nothing reached the possible threshold — the sign
			// of a tactic whose only signals are unobservable (e.g. positional
			// rules that can never match), which makes it permanently
			// undetectable. "ambiguous" is acceptable: near-identical sibling
			// tactics (dual-WF / tunnel variants) legitimately tie, and
			// DetectPlayer only surfaces the top five candidates.
			if result.Status == "unknown" {
				t.Errorf("%s cannot score its own signature (status=unknown, confidence=%.0f)",
					doc.ID, result.Confidence)
			}
		}
	}
}
