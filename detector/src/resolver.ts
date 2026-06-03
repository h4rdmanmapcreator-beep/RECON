import { CandidateScore, DetectionResult, Thresholds } from "./types";

const DEFAULT_THRESHOLDS: Thresholds = {
  detected: 70,
  possible: 55,
  ambiguous_margin: 10,
};

export function resolveCandidates(
  playerId: number,
  candidates: Array<CandidateScore & { evidence: string[] }>,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): DetectionResult {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];

  const publicCandidates: CandidateScore[] = sorted
    .slice(0, 5)
    .map(({ id, score }) => ({ id, score: Math.round(score) }));

  const baseResult = {
    player_id: playerId,
    candidates: publicCandidates,
    evidence: top?.evidence ?? [],
  };

  if (!top || top.score < thresholds.possible) {
    return { ...baseResult, detected_tactic: null, confidence: top?.score ?? 0, status: "unknown" };
  }

  if (top.score < thresholds.detected) {
    return {
      ...baseResult,
      detected_tactic: top.id,
      confidence: Math.round(top.score),
      status: "possible",
    };
  }

  if (second && top.score - second.score < thresholds.ambiguous_margin) {
    return {
      ...baseResult,
      detected_tactic: null,
      confidence: Math.round(top.score),
      status: "ambiguous",
      evidence: [
        `Top: ${top.id} (${Math.round(top.score)}) vs ${second.id} (${Math.round(second.score)}) — margin too small`,
        ...top.evidence,
      ],
    };
  }

  return {
    ...baseResult,
    detected_tactic: top.id,
    confidence: Math.round(top.score),
    status: "detected",
  };
}
