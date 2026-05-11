import type { WalletUptimeStats } from './uptime';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type PerformanceTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface WalletTierInput {
  id: string;
  uptime: WalletUptimeStats;
  emissionAprPct?: number;
  feeAprPct?: number;
  volatilityPct?: number;
  holdVsLpPct?: number;
  pendingRewardsUsd?: number;
  lpUsd?: number;
  outOfRange?: boolean;
}

export interface WalletTierScore {
  id: string;
  score: number;
  tier: PerformanceTier;
  tierClass: string;
  trackedMs: number;
  uptimePct: number;
  activePct: number;
  yieldScore: number;
  peerScore: number;
}

interface PreliminaryScore extends WalletTierScore {
  rawScore: number;
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function numeric(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

function uptimePct(stats: WalletUptimeStats): number {
  const total = trackedMs(stats);
  return total > 0 ? (stats.inRangeMs / total) * 100 : 0;
}

function activePct(stats: WalletUptimeStats): number {
  const total = trackedMs(stats);
  return total > 0 ? ((stats.inRangeMs + stats.outOfRangeMs) / total) * 100 : 0;
}

function trackedMs(stats: WalletUptimeStats): number {
  return Math.max(0, stats.inRangeMs + stats.outOfRangeMs + stats.noPositionMs);
}

function riskAdjustedYieldPct(input: WalletTierInput): number {
  const emissionApr = numeric(input.emissionAprPct);
  const feeApr = numeric(input.feeAprPct);
  const pendingBoost = input.pendingRewardsUsd && input.lpUsd && input.lpUsd > 0
    ? Math.min(10, (input.pendingRewardsUsd / input.lpUsd) * 100)
    : 0;
  const volatilityPenalty = Math.max(0, numeric(input.volatilityPct)) * 0.25;
  const ilPenalty = Math.max(0, -numeric(input.holdVsLpPct)) * 0.5;
  const rangePenalty = input.outOfRange ? 18 : 0;
  return Math.max(0, emissionApr + feeApr + pendingBoost - volatilityPenalty - ilPenalty - rangePenalty);
}

function yieldScore(input: WalletTierInput): number {
  const adjustedYieldPct = riskAdjustedYieldPct(input);
  return clamp((1 - Math.exp(-adjustedYieldPct / 75)) * 100);
}

function uptimeQualityScore(value: number): number {
  const uptime = clamp(value);
  if (uptime < 50) return uptime;
  return 50 + Math.sqrt((uptime - 50) / 50) * 50;
}

function tierFor(score: Omit<WalletTierScore, 'tier' | 'tierClass' | 'id'>): PerformanceTier {
  if (
    score.score >= 96 &&
    score.trackedMs >= 7 * DAY_MS &&
    score.uptimePct >= 99.5 &&
    score.activePct >= 99.5 &&
    score.yieldScore >= 80
  ) {
    return 'S';
  }
  if (score.score >= 88 && score.trackedMs >= 3 * DAY_MS && score.uptimePct >= 97 && score.activePct >= 98) return 'A';
  if (score.score >= 50 && score.uptimePct >= 50 && score.activePct >= 90) return 'B';
  if (score.score >= 42 && score.uptimePct >= 35) return 'C';
  if (score.score >= 32) return 'D';
  return 'F';
}

function preliminaryScore(input: WalletTierInput): PreliminaryScore {
  const observedUptimePct = uptimePct(input.uptime);
  const observedActivePct = activePct(input.uptime);
  const observedTrackedMs = trackedMs(input.uptime);
  const currentYieldScore = yieldScore(input);
  const historyScore = uptimeQualityScore(observedUptimePct) * 0.85 + observedActivePct * 0.15;
  const rawScore = historyScore * 0.78 + currentYieldScore * 0.22;
  const confidence = clamp(observedTrackedMs / (6 * HOUR_MS), 0, 1);
  const score = rawScore * (0.85 + confidence * 0.15);

  return {
    id: input.id,
    score,
    tier: 'F',
    tierClass: 'tier-f',
    trackedMs: observedTrackedMs,
    uptimePct: observedUptimePct,
    activePct: observedActivePct,
    yieldScore: currentYieldScore,
    peerScore: 50,
    rawScore,
  };
}

export function scoreWalletTiers(inputs: WalletTierInput[]): WalletTierScore[] {
  const preliminary = inputs.map(preliminaryScore);
  return preliminary.map((item) => {
    const peers = preliminary.filter((peer) => peer.id !== item.id);
    const peerAverage = peers.length > 0
      ? peers.reduce((sum, peer) => sum + peer.rawScore, 0) / peers.length
      : item.rawScore;
    const peerScore = peers.length > 0 ? clamp(50 + (item.rawScore - peerAverage) * 0.7) : item.rawScore;
    const score = clamp(item.score * 0.85 + peerScore * 0.15);
    const tierInput = {
      score,
      trackedMs: item.trackedMs,
      uptimePct: item.uptimePct,
      activePct: item.activePct,
      yieldScore: item.yieldScore,
      peerScore,
    };
    const tier = tierFor(tierInput);

    return {
      id: item.id,
      score,
      tier,
      tierClass: `tier-${tier.toLowerCase()}`,
      trackedMs: item.trackedMs,
      uptimePct: item.uptimePct,
      activePct: item.activePct,
      yieldScore: item.yieldScore,
      peerScore,
    };
  });
}
