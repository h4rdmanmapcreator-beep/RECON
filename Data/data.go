// Package inidata bundles the Generals/Zero Hour INI tree so the GUI
// works without asking the user for a path to inizh on disk.
//
// The directory layout under FS mirrors what iniparse expects, so the
// embedded FS can be passed to the *FS constructors in pkg/iniparse.
package inidata

import "embed"

// FS contains the bundled INI directory tree, with paths like
// "INI/Object/AmericaVehicle.ini" relative to the FS root.
//
//go:embed INI
var FS embed.FS
