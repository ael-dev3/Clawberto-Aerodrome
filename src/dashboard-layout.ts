export const DASHBOARD_SECTION_ORDER = [
  'range-control',
  'analytics-bottom',
  'diagnostics-secondary',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_ORDER)[number];
