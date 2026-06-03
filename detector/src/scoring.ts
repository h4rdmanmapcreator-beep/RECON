/**
 * Soft-timing score for a rule with ideal and hard deadlines.
 *
 *   t <= ideal_before  → full weight
 *   t in (ideal, hard] → linear decay
 *   t > hard_before    → 0
 */
export function timeScore(
  actualTime: number,
  idealBefore: number,
  hardBefore: number,
  weight: number
): number {
  if (actualTime <= idealBefore) return weight;
  if (actualTime > hardBefore) return 0;
  const progress = (hardBefore - actualTime) / (hardBefore - idealBefore);
  return weight * progress;
}

/**
 * Convert raw positive/negative points to a 0–100 confidence value,
 * then clamp to [0, 100].
 */
export function toConfidence(
  positivePoints: number,
  penaltyPoints: number,
  maxPositivePoints: number
): number {
  if (maxPositivePoints === 0) return 0;
  const raw = ((positivePoints - penaltyPoints) / maxPositivePoints) * 100;
  return Math.max(0, Math.min(100, raw));
}
