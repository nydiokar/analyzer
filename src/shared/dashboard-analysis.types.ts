export const DASHBOARD_ANALYSIS_SCOPES = ['flash', 'working', 'deep'] as const;
export type DashboardAnalysisScope = (typeof DASHBOARD_ANALYSIS_SCOPES)[number];

export const DASHBOARD_TRIGGER_SOURCES = ['auto', 'manual', 'system'] as const;
export type DashboardAnalysisTriggerSource = (typeof DASHBOARD_TRIGGER_SOURCES)[number];
