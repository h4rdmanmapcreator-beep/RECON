import { NormalizedEvent, OpeningFeatures } from "./types";

const OPENING_PRIORITY_EVENTS = new Set([
  "building_start",
  "unit_start",
  "upgrade_start",
  "sell_building",
  "cancel",
  "general_power_pick",
]);

const FAST_CANCEL_THRESHOLD_S = 5;

/**
 * Build the feature index for a single player's events within the opening window.
 *
 * Cancels within FAST_CANCEL_THRESHOLD_S seconds of the matching start are
 * treated as accidents and removed from the event list before indexing.
 */
export function extractFeatures(
  events: NormalizedEvent[],
  openingEnd: number
): OpeningFeatures {
  const windowed = events
    .filter((e) => e.time <= openingEnd)
    .sort((a, b) => a.time - b.time);
  const filtered = removeFastCancels(windowed);

  const first_time: Record<string, number> = {};
  const early_units: Record<string, number> = {};
  const early_buildings: Record<string, number> = {};
  const sequence: string[] = [];

  for (const ev of filtered) {
    if (!OPENING_PRIORITY_EVENTS.has(ev.event)) continue;

    const key = `${ev.event}:${ev.object}`;
    if (!(key in first_time)) {
      first_time[key] = ev.time;
    }

    if (ev.event === "unit_start") {
      sequence.push(ev.object);
      early_units[ev.object] = (early_units[ev.object] ?? 0) + 1;
    } else if (ev.event === "building_start") {
      sequence.push(ev.object);
      early_buildings[ev.object] = (early_buildings[ev.object] ?? 0) + 1;
    }
  }

  return { first_time, early_units, early_buildings, sequence, events: filtered };
}

/**
 * Remove start events whose matching cancel arrives within FAST_CANCEL_THRESHOLD_S.
 * A "matching cancel" shares the same player_id and object name.
 */
function removeFastCancels(events: NormalizedEvent[]): NormalizedEvent[] {
  const cancels = events.filter((e) => e.event === "cancel");
  const fastCancelledKeys = new Set<string>();

  for (const cancel of cancels) {
    // Look back for the most recent start of the same object
    const startEvent = [...events]
      .reverse()
      .find(
        (e) =>
          e.time <= cancel.time &&
          e.object === cancel.object &&
          e.player_id === cancel.player_id &&
          (e.event === "building_start" || e.event === "unit_start" || e.event === "upgrade_start")
      );

    if (startEvent && cancel.time - startEvent.time <= FAST_CANCEL_THRESHOLD_S) {
      // Tag by time+object to be specific enough
      fastCancelledKeys.add(`${startEvent.time}:${startEvent.object}`);
    }
  }

  return events.filter((e) => {
    if (e.event === "cancel") return false; // always strip cancel events from final list
    return !fastCancelledKeys.has(`${e.time}:${e.object}`);
  });
}

/** Count events matching event+object before a given time. */
export function countBefore(
  features: OpeningFeatures,
  event: string,
  object: string,
  before: number
): number {
  return features.events.filter(
    (e) => e.event === event && e.object === object && e.time < before
  ).length;
}

/** Count events matching event+object+source before a given time. */
export function countSourceBefore(
  features: OpeningFeatures,
  event: string,
  object: string,
  source: string,
  before: number
): number {
  return features.events.filter(
    (e) =>
      e.event === event &&
      e.object === object &&
      e.source === source &&
      e.time < before
  ).length;
}

/** First time a given event+object occurred (Infinity if never). */
export function firstTime(
  features: OpeningFeatures,
  event: string,
  object: string
): number {
  return features.first_time[`${event}:${object}`] ?? Infinity;
}

/** Count events matching event+object between two times (inclusive). */
export function countBetween(
  features: OpeningFeatures,
  event: string,
  object: string,
  from: number,
  to: number
): number {
  return features.events.filter(
    (e) => e.event === event && e.object === object && e.time >= from && e.time <= to
  ).length;
}
