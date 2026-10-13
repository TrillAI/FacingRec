/**
 * Strictly synchronized with firebase-blueprint.json and firestore.rules
 */

export const SCHEMA_LIMITS = {
  ID_MAX_LENGTH: 128,
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  DISPLAY_NAME_MAX: 80,
  ORG_NAME_MAX: 100,
  JOB_TITLE_MAX: 80,
  EMAIL_MAX: 254,
  WIDGET_TITLE_MAX: 80,
  METRIC_LABEL_MAX: 80,
  METRIC_UNIT_MAX: 16,
  PERIOD_LABEL_MAX: 32,
  VALUE_MIN: -1000000000,
  VALUE_MAX: 1000000000,
} as const;

export type ThemePreference = 'light' | 'dark';

export type WidgetType =
  | 'kpi_card'
  | 'area_chart'
  | 'bar_chart'
  | 'distribution_ring'
  | 'data_table';

export type MetricCategory =
  | 'revenue'
  | 'throughput'
  | 'latency'
  | 'conversion'
  | 'retention';

export type MetricRegion = 'us-west' | 'us-east' | 'eu-central' | 'ap-northeast';

export type MetricStatus = 'nominal' | 'warning' | 'critical' | 'archived';

export interface UserPublicProfile {
  uid: string;
  displayName: string;
  organizationName: string;
  jobTitle: string;
  themePreference: ThemePreference;
  onboardingCompleted: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  updatedAt?: unknown;
}

export interface DashboardWidget {
  id: string;
  ownerId: string;
  title: string;
  widgetType: WidgetType;
  metricCategory: MetricCategory;
  colSpan: 4 | 6 | 8 | 12;
  positionIndex: number;
  isVisible: boolean;
  targetThreshold: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MetricRecord {
  id: string;
  ownerId: string;
  label: string;
  category: MetricCategory;
  region: MetricRegion;
  value: number;
  baseline: number;
  unit: string;
  status: MetricStatus;
  periodLabel: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PresenceMember {
  uid: string;
  displayName: string;
  organizationName: string;
  activeTab: string;
  connectedAt: string;
}

export interface SyncEventItem {
  id: string;
  uid: string;
  actorName: string;
  eventType: 'metric:created' | 'metric:updated' | 'widget:configured' | 'session:verified';
  summary: string;
  timestamp: string;
}

export interface ServerAnalyticsDigest {
  totalRecords: number;
  nominalCount: number;
  warningCount: number;
  criticalCount: number;
  meanDeltaPercent: number;
  regionalBreakdown: Record<string, { count: number; totalValue: number }>;
  topOutlier: {
    label: string;
    deltaPercent: number;
    status: string;
    region: string;
  } | null;
  computedAt?: string;
}

export interface JwtSessionStatus {
  authenticated: boolean;
  uid: string;
  email: string | null;
  emailVerified: boolean;
  issuer: string;
  audience: string;
  issuedAt: string;
  expiresAt: string;
  activeCollaborators: number;
}

export function sanitizeString(input: string, maxLength: number, fallback = 'Untitled'): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

export function clampNumber(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.min(max, Math.max(min, val));
}

export function generateSafeDocumentId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  const raw = `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '');
  return raw.slice(0, SCHEMA_LIMITS.ID_MAX_LENGTH);
}
