# Zero Hour Tactic Detector

Scores each player's opening build order against a library of tactic templates
and reports the most likely tactic with a confidence value.

## Components

| Path | Role |
| --- | --- |
| `pkg/detect/bundle.js` | **Authoritative runtime.** Plain JS executed inside goja (pure-Go) by `pkg/detect/engine.go`. This is what production actually runs. |
| `detector/src/*.ts` | TypeScript **reference implementation** of the same logic. Useful for local iteration, but it is not what ships. Keep it in sync with `bundle.js` by hand — there is no build step wiring one to the other, so the two can drift. |
| `detector/tactics/*.json` | Source-of-truth tactic templates (includes `mixed.json`). |
| `pkg/detect/tactics/*.json` | Embedded copy the Go binary compiles in. Regenerate with `make sync-tactics` after editing the source templates (China/USA/GLA only; `mixed` is not embedded). |

## How scoring works

For each tactic the engine extracts opening-window features, checks the tactic's
gates (any failure eliminates it), then sums matched `positive_rules` points
over the maximum achievable points to get a 0–100 confidence, minus any
`negative_rules` penalties, clamped by `caps`. The resolver then picks
`detected` / `possible` / `ambiguous` / `unknown` from the ranked candidates.

### Rules the engine cannot evaluate

Normalized replay events carry **no positional data**, so `location_region` and
`location_or_transport_signal` rules can never match. These rules therefore
contribute **0 to the score denominator** (`maxPoints: 0`) — otherwise their
weight would cap the achievable confidence of the whole tactic and make it
undetectable. A tactic whose *only* signals are positional cannot be detected
from production events; give it observable proxy rules (buildings/units/upgrades
it implies) or set `enabled_for_detection: false`.

### Object normalization

`pkg/zhreplay/normalized_events.go` maps raw INI object names
(`AmericaTankCrusader`, `Upgrade_AmericaTOWMissile`, …) to the canonical
snake_case names the templates use (`crusader_tank`, `tow_missiles`, …).
General-specific prefixes (`Infa_`, `AirF_`, `SupW_`, …) are stripped first.
If a referenced object is not mapped, its rule silently never fires — and, for a
positive rule, still counts against the score — so every object used in a
template must be observable and mapped.

## Tests

- `go test ./pkg/detect/...` — runs against the authoritative `bundle.js`,
  including `TestTacticSelfConsistency`, which feeds every enabled tactic its
  own signature and asserts the result is not `unknown` (guards against tactics
  that become permanently undetectable).
- `go test ./pkg/zhreplay/...` — covers object/upgrade normalization.
- `npm test` (in `detector/`) — exercises the TypeScript reference engine
  against labeled samples.

## Known limitations / future work

- **Near-identical openings tie.** Many templates share an early signature
  (e.g. China dual-WF variants), so a bare opening resolves to `ambiguous` with
  the correct tactic as the top candidate. Reducing this safely (signature-based
  tie-breaking, `ambiguous_margin` tuning) needs a labeled set of real replays
  to validate against — it should not be tuned blind.
- **No positional detection.** Flank/drop/placement tactics are only detected
  through observable proxies. Real positional support would require plumbing
  `x`/`y` and map spawn data through normalization.
