// Package detect runs the Zero Hour tactic-detection JavaScript bundle inside
// a goja (pure-Go) JS runtime.  The bundle and tactics data are embedded in
// the binary — no Node.js or external runtime is required.
package detect

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/dop251/goja"
)

// ─── Embedded assets ──────────────────────────────────────────────────────────

//go:embed bundle.js
var bundleJS string

//go:embed tactics/china.json
var chinaTacticsJSON []byte

//go:embed tactics/usa.json
var usaTacticsJSON []byte

//go:embed tactics/gla.json
var glaTacticsJSON []byte

// ─── Public types ─────────────────────────────────────────────────────────────

// NormalizedEvent is the minimal event format the detector consumes.
// The zhreplay package is responsible for converting raw BodyChunks into this
// form before calling DetectPlayer.
type NormalizedEvent struct {
	Time   float64 `json:"time"`            // seconds from game start
	Event  string  `json:"event"`           // building_start | unit_start | upgrade_start | sell_building
	Object string  `json:"object"`          // canonical object name
	Source string  `json:"source,omitempty"` // producing building (optional)
}

// DetectionResult is returned for a single player.
type DetectionResult struct {
	PlayerID           int              `json:"player_id"`
	DetectedTactic     string           `json:"detected_tactic,omitempty"`
	Confidence         float64          `json:"confidence"`
	Status             string           `json:"status"` // detected | possible | ambiguous | unknown
	Candidates         []CandidateScore `json:"candidates"`
	Evidence           []string         `json:"evidence"`
	TacticName         string           `json:"tactic_name,omitempty"`
	TacticDescription  string           `json:"tactic_description,omitempty"`
	TacticCategory     string           `json:"tactic_category,omitempty"`
	TacticMatchups     string           `json:"tactic_matchups,omitempty"`
}

// CandidateScore is one entry in the ranked candidate list.
type CandidateScore struct {
	ID    string  `json:"id"`
	Score float64 `json:"score"`
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

var (
	rt          *goja.Runtime
	detectFn    goja.Callable
	engineOnce  sync.Once
	engineErr   error
	engineMu    sync.Mutex
)

func initEngine() {
	rt = goja.New()

	// Load the bundle (defines detectFromJSON, registerTactics in global scope)
	if _, err := rt.RunString(bundleJS); err != nil {
		engineErr = fmt.Errorf("tactic detector bundle load failed: %w", err)
		return
	}

	// Register each faction's tactics by calling registerTactics(faction, array)
	registerFn, ok := goja.AssertFunction(rt.Get("registerTactics"))
	if !ok {
		engineErr = fmt.Errorf("registerTactics not found in bundle")
		return
	}

	factionData := map[string][]byte{
		"china": chinaTacticsJSON,
		"usa":   usaTacticsJSON,
		"gla":   glaTacticsJSON,
	}
	for faction, raw := range factionData {
		var tactics interface{}
		if err := json.Unmarshal(raw, &tactics); err != nil {
			engineErr = fmt.Errorf("failed to unmarshal %s tactics: %w", faction, err)
			return
		}
		if _, err := registerFn(goja.Undefined(), rt.ToValue(faction), rt.ToValue(tactics)); err != nil {
			engineErr = fmt.Errorf("registerTactics(%s) failed: %w", faction, err)
			return
		}
	}

	// Cache the detectFromJSON callable
	fn, ok := goja.AssertFunction(rt.Get("detectFromJSON"))
	if !ok {
		engineErr = fmt.Errorf("detectFromJSON not found in bundle")
		return
	}
	detectFn = fn
}

// DetectPlayer runs the JavaScript detector for one player and returns a
// DetectionResult.  faction must be one of "china", "usa", "gla".
// If the engine failed to load, a zero DetectionResult with status "unknown"
// is returned so that the caller can still serve a response.
func DetectPlayer(playerID int, faction string, events []NormalizedEvent) (DetectionResult, error) {
	engineOnce.Do(initEngine)

	empty := DetectionResult{PlayerID: playerID, Status: "unknown", Evidence: []string{}, Candidates: []CandidateScore{}}

	if engineErr != nil {
		return empty, engineErr
	}

	eventsJSON, err := json.Marshal(events)
	if err != nil {
		return empty, fmt.Errorf("marshal events: %w", err)
	}

	engineMu.Lock()
	defer engineMu.Unlock()

	val, err := detectFn(
		goja.Undefined(),
		rt.ToValue(playerID),
		rt.ToValue(faction),
		rt.ToValue(string(eventsJSON)),
	)
	if err != nil {
		return empty, fmt.Errorf("detectFromJSON: %w", err)
	}

	var result DetectionResult
	if err := json.Unmarshal([]byte(val.String()), &result); err != nil {
		return empty, fmt.Errorf("unmarshal detection result: %w", err)
	}
	return result, nil
}
