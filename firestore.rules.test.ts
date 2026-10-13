/**
 * Firestore Security Rules Test Suite (Dirty Dozen Verification)
 * Verifies that all 12 adversarial payloads in security_spec.md are rejected with PERMISSION_DENIED.
 */

export interface DirtyPayloadTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyPayloadTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Widget Creation',
    operation: 'create',
    path: '/widgets/widget_spoof_1',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      ownerId: 'user_B',
      title: 'Revenue Stream',
      widgetType: 'area_chart',
      metricCategory: 'revenue',
      colSpan: 6,
      positionIndex: 0,
      isVisible: true,
      targetThreshold: 1000,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow Field Injection on User Profile',
    operation: 'update',
    path: '/users/user_A',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      displayName: 'Alex Rivera',
      isAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Write Attempt',
    operation: 'create',
    path: '/users/user_unverified',
    auth: { uid: 'user_unverified', email_verified: false },
    payload: {
      uid: 'user_unverified',
      displayName: 'Unverified User',
      organizationName: 'Acme Corp',
      jobTitle: 'Analyst',
      themePreference: 'dark',
      onboardingCompleted: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'PII Cross-User Read',
    operation: 'get',
    path: '/users/user_A/private/info',
    auth: { uid: 'user_B', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'ID Poisoning Attack',
    operation: 'create',
    path: '/metrics/invalid$id!with*spaces',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      ownerId: 'user_A',
      label: 'API Latency',
      category: 'latency',
      region: 'us-west',
      value: 42,
      baseline: 40,
      unit: 'ms',
      status: 'nominal',
      periodLabel: '2026-Q4',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Value Poisoning / Oversized String',
    operation: 'update',
    path: '/widgets/widget_1',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      title: 'A'.repeat(5000),
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Orphaned Write without Master User Profile',
    operation: 'create',
    path: '/widgets/widget_orphan',
    auth: { uid: 'user_no_profile', email_verified: true },
    payload: {
      ownerId: 'user_no_profile',
      title: 'Orphan Widget',
      widgetType: 'kpi_card',
      metricCategory: 'throughput',
      colSpan: 4,
      positionIndex: 1,
      isVisible: true,
      targetThreshold: 500,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Terminal State Bypass on Archived Metric',
    operation: 'update',
    path: '/metrics/metric_archived_1',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      value: 99999,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immortal Field Mutation',
    operation: 'update',
    path: '/metrics/metric_1',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      ownerId: 'user_B',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Forged Client Timestamp',
    operation: 'create',
    path: '/metrics/metric_forged_time',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      ownerId: 'user_A',
      label: 'Conversion Rate',
      category: 'conversion',
      region: 'eu-central',
      value: 4.8,
      baseline: 4.2,
      unit: '%',
      status: 'nominal',
      periodLabel: '2026-10',
      createdAt: '1999-01-01T00:00:00Z',
      updatedAt: '1999-01-01T00:00:00Z',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unconstrained List Query Scraping',
    operation: 'list',
    path: '/metrics',
    auth: { uid: 'user_B', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Invalid Enum / Boundary Violation',
    operation: 'create',
    path: '/widgets/widget_invalid_enum',
    auth: { uid: 'user_A', email_verified: true },
    payload: {
      ownerId: 'user_A',
      title: 'Bad Widget',
      widgetType: 'malicious_iframe',
      metricCategory: 'revenue',
      colSpan: 99,
      positionIndex: 0,
      isVisible: true,
      targetThreshold: 100,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
];
