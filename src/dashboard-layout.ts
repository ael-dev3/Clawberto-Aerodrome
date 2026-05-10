export const DASHBOARD_SECTION_ORDER = [
  'range-control',
  'positions-primary',
  'pool-metrics',
  'wallet-secondary',
  'history-secondary',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_ORDER)[number];
