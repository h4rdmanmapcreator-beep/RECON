import * as fs from "fs";
import * as path from "path";
import { Faction, TacticTemplate } from "./types";

const TACTICS_DIR = path.join(__dirname, "..", "tactics");

const tacticCache: Map<Faction, TacticTemplate[]> = new Map();

export function loadTactics(faction: Faction): TacticTemplate[] {
  if (tacticCache.has(faction)) return tacticCache.get(faction)!;

  const file = path.join(TACTICS_DIR, `${faction}.json`);
  if (!fs.existsSync(file)) return [];

  const raw: TacticTemplate[] = JSON.parse(fs.readFileSync(file, "utf-8"));
  const enabled = raw.filter((t) => t.enabled_for_detection !== false);
  tacticCache.set(faction, enabled);
  return enabled;
}

/** Load all tactics for validation purposes. */
export function loadAllTactics(): TacticTemplate[] {
  const factions: Faction[] = ["usa", "china", "gla", "mixed"];
  return factions.flatMap(loadTactics);
}

// ── Validation ────────────────────────────────────────────────────────────────

type ValidationError = { tacticId: string; error: string };

export function validateAllTactics(): ValidationError[] {
  const tactics = loadAllTactics();
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();

  for (const t of tactics) {
    const err = (msg: string) => errors.push({ tacticId: t.id ?? "(no id)", error: msg });

    if (!t.id) err("Missing id");
    if (seenIds.has(t.id)) err("Duplicate id");
    seenIds.add(t.id);

    if (!t.faction) err("Missing faction");

    const window = t.detection?.opening_window_seconds;
    if (!window) err("Missing opening_window_seconds");

    if (!t.detection?.positive_rules?.length && !t.detection?.gates?.length) {
      err("No gates and no positive rules");
    }

    for (const r of t.detection?.positive_rules ?? []) {
      if ((r as any).weight === undefined) err(`Positive rule ${(r as any).id ?? r.type} missing weight`);
    }

    for (const r of t.detection?.negative_rules ?? []) {
      if ((r as any).penalty === undefined && (r as any).weight === undefined) {
        err(`Negative rule ${(r as any).id ?? r.type} missing penalty`);
      }
    }

    if (!t.detection?.thresholds) err("Missing thresholds");
  }

  return errors;
}

// If run directly: validate and print
if (require.main === module) {
  const errors = validateAllTactics();
  if (errors.length === 0) {
    console.log("All tactics valid.");
  } else {
    console.error(`${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  [${e.tacticId}] ${e.error}`);
    process.exit(1);
  }
}
