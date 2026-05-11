import { describe, expect, it } from 'vitest';
import releaseSyncScript from '../scripts/aerodrome-dashboard-release-sync.mjs?raw';
import { managedPositions, positionHistory } from '../src/positions';
import positionsSource from '../src/positions.ts?raw';

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

describe('position registry history', () => {
  it('keeps the dashboard release sync insertion markers typed and present', () => {
    expect(positionsSource).toContain('export const managedPositions: ManagedPositionRecord[] = [\n');
    expect(positionsSource).toContain('export const positionHistory = [\n');
    expect(positionsSource).toContain('satisfies PositionHistoryRecord[];');
    expect(releaseSyncScript).toContain("const historyMarker = 'export const positionHistory = [\\n';");
    expect(releaseSyncScript).toContain('satisfies PositionHistoryRecord[]');
  });

  it('anchors the current managed LP while retaining audited prior range history', () => {
    expect(managedPositions.length).toBeGreaterThan(0);
    const current = managedPositions[0];
    const currentHistory = positionHistory.find((event) =>
      event.tokenId === current.tokenId &&
      event.event.includes(`#${current.tokenId.toString()}`) &&
      event.event.startsWith('Entered')
    );

    expect(currentHistory).toBeDefined();
    expect(positionHistory.some((event) => event.tokenId === 346478n && event.event.startsWith('Entered'))).toBe(true);
    expect(positionHistory.some((event) => event.tokenId === 341439n && event.event.startsWith('Entered'))).toBe(true);
    expect(positionHistory.some((event) => event.tokenId === 341002n && event.event.startsWith('Rejected'))).toBe(true);
  });

  it('uses valid transaction hashes and does not retain known-invalid negative mint telemetry', () => {
    for (const event of positionHistory) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.event.trim()).toBe(event.event);
      expect(event.detail.trim()).toBe(event.detail);
      expect(event.detail).not.toContain('Mint used -');
      if (event.tx) expect(event.tx).toMatch(TX_HASH_RE);
    }
  });
});
