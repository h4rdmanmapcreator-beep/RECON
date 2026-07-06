package zhreplay

import "testing"

// TestCanonicalObjectName covers the object/upgrade normalization the tactic
// detector depends on, including the Phase B additions (upgrades and units that
// previously fell through unmapped and prevented their rules from firing).
func TestCanonicalObjectName(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		// Base units/buildings.
		{"ChinaWarFactory", "war_factory"},
		{"AmericaTankCrusader", "crusader_tank"},
		{"ChinaInfantryMiniGunner", "minigunner"},
		// General-prefixed variants collapse to the base canonical name.
		{"Lazr_AmericaTankCrusader", "crusader_tank"},
		{"Infa_ChinaInfantryMiniGunner", "minigunner"},
		// Upgrades.
		{"Upgrade_AmericaTOWMissile", "tow_missiles"},
		{"Upgrade_InfantryCaptureBuilding", "capture_building"},
		{"Upgrade_AmericaRangerFlashBangGrenade", "flashbangs"},
		{"AirF_Upgrade_StealthComanche", "stealth_comanche"},
		{"Upgrade_AmericaAdvancedControlRods", "power_plant_upgrade"},
		{"SupW_Upgrade_AmericaAdvancedControlRods", "power_plant_upgrade"},
		// Trailing whitespace in INI names must be trimmed before lookup.
		{"Upgrade_AmericaTOWMissile ", "tow_missiles"},
		// Unknown names pass through unchanged.
		{"SomeModObject", "SomeModObject"},
	}
	for _, c := range cases {
		if got := canonicalObjectName(c.in); got != c.want {
			t.Errorf("canonicalObjectName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
