import { rangeStatus, tickToAdjustedPrice } from './aero-math';
import type { DashboardSnapshot, LivePosition } from './rpc';

const LFI_DECIMALS = 18;
const USDC_DECIMALS = 6;

export interface LpRangeOverlay {
  tokenId: string;
  label: string;
  origin: string;
  lowerTick: number;
  upperTick: number;
  lowerPrice: number;
  upperPrice: number;
  status: ReturnType<typeof rangeStatus>;
  color: string;
}

function statusColor(state: string): string {
  if (state === 'IN_RANGE') return '#16c784';
  if (state === 'BELOW_RANGE') return '#f6b73c';
  return '#ff5c7a';
}

export function positionToRangeOverlay(position: LivePosition, currentTick: number): LpRangeOverlay | undefined {
  if (position.tickLower === undefined || position.tickUpper === undefined || position.liveError) return undefined;
  if (position.liquidity === undefined || position.liquidity <= 0n) return undefined;
  const lowerPrice = tickToAdjustedPrice(position.tickLower, LFI_DECIMALS, USDC_DECIMALS);
  const upperPrice = tickToAdjustedPrice(position.tickUpper, LFI_DECIMALS, USDC_DECIMALS);
  const status = rangeStatus(currentTick, position.tickLower, position.tickUpper);

  return {
    tokenId: position.tokenId.toString(),
    label: position.label,
    origin: position.origin,
    lowerTick: position.tickLower,
    upperTick: position.tickUpper,
    lowerPrice: Math.min(lowerPrice, upperPrice),
    upperPrice: Math.max(lowerPrice, upperPrice),
    status,
    color: statusColor(status.state),
  };
}

export function buildRangeOverlays(snapshot: Pick<DashboardSnapshot, 'pool' | 'positions'>): LpRangeOverlay[] {
  return snapshot.positions
    .map((position) => positionToRangeOverlay(position, snapshot.pool.currentTick))
    .filter((overlay): overlay is LpRangeOverlay => Boolean(overlay))
    .sort((a, b) => Number(b.origin === 'hermes-managed') - Number(a.origin === 'hermes-managed'));
}

export function formatChartPrice(price: number): string {
  if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}
