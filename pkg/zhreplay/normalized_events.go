package zhreplay

import (
	"strings"

	"github.com/bill-rich/cncstats/pkg/detect"
	"github.com/bill-rich/cncstats/pkg/zhreplay/body"
)

const replayFPS = 30.0

// order codes that carry detection-relevant information
const (
	ocCreateUnit   = 1047 // unit queued
	ocBuildObject  = 1049 // building queued
	ocBuildUpgrade = 1045 // upgrade queued
	ocSell         = 1052 // building sold
)

// eventsForPlayer collects and normalises all body chunks belonging to
// playerName into the format the JS tactic detector expects.
func eventsForPlayer(chunks []*body.BodyChunk, playerName string) []detect.NormalizedEvent {
	var events []detect.NormalizedEvent
	for _, chunk := range chunks {
		if chunk.PlayerName != playerName {
			continue
		}
		if ev, ok := chunkToEvent(chunk); ok {
			events = append(events, ev)
		}
	}
	return events
}

// chunkToEvent maps one BodyChunk to a NormalizedEvent.
// Returns (event, true) for order codes the detector cares about.
func chunkToEvent(chunk *body.BodyChunk) (detect.NormalizedEvent, bool) {
	timeSec := float64(chunk.TimeCode) / replayFPS

	switch chunk.OrderCode {
	case ocCreateUnit:
		if chunk.Details == nil {
			return detect.NormalizedEvent{}, false
		}
		return detect.NormalizedEvent{
			Time:   timeSec,
			Event:  "unit_start",
			Object: canonicalObjectName(chunk.Details.GetName()),
		}, true

	case ocBuildObject:
		if chunk.Details == nil {
			return detect.NormalizedEvent{}, false
		}
		return detect.NormalizedEvent{
			Time:   timeSec,
			Event:  "building_start",
			Object: canonicalObjectName(chunk.Details.GetName()),
		}, true

	case ocBuildUpgrade:
		if chunk.Details == nil {
			return detect.NormalizedEvent{}, false
		}
		return detect.NormalizedEvent{
			Time:   timeSec,
			Event:  "upgrade_start",
			Object: canonicalObjectName(chunk.Details.GetName()),
		}, true

	case ocSell:
		// The body chunk for a sell doesn't carry the building name — the object
		// name is empty here.  sell_signal rules that need a specific name won't
		// fire, but generic presence of a sell is still recorded.
		return detect.NormalizedEvent{
			Time:   timeSec,
			Event:  "sell_building",
			Object: "",
		}, true
	}

	return detect.NormalizedEvent{}, false
}

// canonicalFaction maps a friendly side string ("China Nuke", "USA Airforce",
// "GLA Demo", …) to the detector's faction key ("china", "usa", "gla").
// Returns "" for observers and unknown sides.
func canonicalFaction(side string) string {
	s := strings.ToLower(side)
	switch {
	case strings.HasPrefix(s, "china"):
		return "china"
	case strings.HasPrefix(s, "usa"), strings.HasPrefix(s, "america"):
		return "usa"
	case strings.HasPrefix(s, "gla"):
		return "gla"
	}
	return ""
}

// generalPrefixes are faction-general prefixes prepended to INI object names
// for general-specific variants.  Strip one before looking up the base name.
var generalPrefixes = []string{
	"Infa_", "Nuke_", "Tank_",
	"AirF_", "Lazr_", "SupW_",
	"Slth_", "Chem_", "Demo_",
}

// canonicalObjectName converts a raw INI object name to the canonical name
// used in tactic templates.  Unknown names are returned as-is so that any
// tactic rules using the exact INI name still match.
func canonicalObjectName(iniName string) string {
	for _, pfx := range generalPrefixes {
		if strings.HasPrefix(iniName, pfx) {
			iniName = iniName[len(pfx):]
			break
		}
	}
	if canon, ok := objectNormMap[iniName]; ok {
		return canon
	}
	return iniName
}

// objectNormMap maps base INI object names to canonical tactic-template names.
var objectNormMap = map[string]string{
	// ── China buildings ───────────────────────────────────────────────────────
	"ChinaCommandCenter":           "command_center",
	"ChinaSupplyCenter":            "supply_center",
	"ChinaPowerPlant":              "power_plant",
	"NukeReactor":                  "power_plant",
	"ChinaBarracks":                "barracks",
	"ChinaWarFactory":              "war_factory",
	"ChinaAirfield":                "airfield",
	"ChinaPropagandaCenter":        "propaganda_center",
	"ChinaBunker":                  "bunker",
	// ── China units ───────────────────────────────────────────────────────────
	"ChinaVehicleDozer":            "dozer",
	"ChinaVehicleSupplyTruck":      "supply_truck",
	"ChinaVehicleGattlingTank":     "gattling_tank",
	"ChinaVehicleBattleMaster":     "battlemaster",
	"ChinaVehicleDragonTank":       "dragon_tank",
	"ChinaVehicleHelix":            "helix",
	"ChinaVehicleNukeCannon":       "nuke_cannon",
	"ChinaVehicleOverlord":         "overlord",
	"ChinaVehicleMig":              "mig",
	"ChinaVehicleTroopCrawler":     "troop_crawler",
	"ChinaVehicleListeningOutpost": "listening_outpost",
	"ChinaVehicleECMTank":          "ecm_tank",
	"ChinaInfantryTankHunter":      "tank_hunter",
	"ChinaInfantryRedGuard":        "red_guard",
	// ── USA buildings ─────────────────────────────────────────────────────────
	"AmericaCommandCenter":    "command_center",
	"AmericaSupplyCenter":     "supply_center",
	"AmericaPowerPlant":       "power_plant",
	"AmericaBarracks":         "barracks",
	"AmericaAirfield":         "airfield",
	"AmericaStrategyCenter":   "strategy_center",
	"AmericaPatriotBattery":   "patriot",
	"AmericaFireBase":         "firebase",
	// ── USA units ─────────────────────────────────────────────────────────────
	"AmericaVehicleDozer":            "dozer",
	"AmericaVehicleHumvee":           "humvee",
	"AmericaVehiclePaladin":          "paladin",
	"AmericaAircraftComanche":        "comanche",
	"AmericaAircraftKingRaptor":      "king_raptor",
	"AmericaAircraftChinook":         "chinook",
	"AmericaAircraftCombatChinook":   "combat_chinook",
	"AmericaInfantryRanger":          "ranger",
	"AmericaInfantryMissileDefender": "missile_defender",
	// ── GLA buildings ─────────────────────────────────────────────────────────
	"GLACommandCenter": "command_center",
	"GLASupplyStash":   "supply_center",
	"GLABarracks":      "barracks",
	"GLAArmsDealer":    "arms_dealer",
	"GLATunnelNetwork": "tunnel_network",
	"GLAPalace":        "palace",
	"GLADemoTrap":      "demo_trap",
	// ── GLA units ─────────────────────────────────────────────────────────────
	"GLAInfantryWorker":            "worker",
	"GLAInfantryRPGTrooper":        "rpg_trooper",
	"GLAInfantryRebel":             "rebel",
	"GLAInfantryTerrorist":         "terrorist",
	"GLAInfantryHijacker":          "hijacker",
	"GLAInfantryJarmenKell":        "jarmen_kell",
	"GLAInfantryToxinRebel":        "toxin_rebel",
	"GLAVehicleTechnical":          "technical",
	"GLAVehicleScorpionTank":       "scorpion_tank",
	"GLAVehicleMarauderTank":       "marauder_tank",
	"GLAVehicleQuadCannon":         "quad_cannon",
	"GLAVehicleAmbulance":          "ambulance",
	"GLAVehicleAttackOutpost":      "attack_outpost",
	"GLAVehicleAttackTroopCrawler": "attack_troop_crawler",
	"GLAVehicleLotusAssassin":      "lotus",
}
