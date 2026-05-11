import { describe, expect, it } from 'vitest';
import mainSource from '../src/main.ts?raw';

describe('dashboard tracking reset keys', () => {
  it('resets only uptime while preserving the current PnL performance cycle', () => {
    expect(mainSource).toContain("const UPTIME_EPOCH_KEY = 'uptime-reset-2026-05-11T20-21-33+02-00';");
    expect(mainSource).toContain("const PNL_EPOCH_KEY = 'performance-reset-2026-05-11T16-27-18+02-00';");
    expect(mainSource).toContain('const UPTIME_STORAGE_KEY = `clawberto-range-uptime-v5-${UPTIME_EPOCH_KEY}`;');
    expect(mainSource).toContain('const PNL_STORAGE_KEY = `clawberto-overall-pnl-v3-${PNL_EPOCH_KEY}`;');
    expect(mainSource).toContain("'clawberto-range-uptime-v5-performance-reset-2026-05-11T16-27-18+02-00'");
    expect(mainSource).not.toContain('const PNL_STORAGE_KEY = `clawberto-overall-pnl-v3-${UPTIME_EPOCH_KEY}`;');
  });
});
