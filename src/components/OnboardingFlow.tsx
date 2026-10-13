import React, { useState } from 'react';
import {
  MetricCategory,
  ThemePreference,
  WidgetType,
  SCHEMA_LIMITS,
  sanitizeString,
} from '../types';
import { Check, ArrowRight, ArrowLeft } from 'lucide-react';

interface OnboardingFlowProps {
  defaultDisplayName: string;
  email: string;
  isDark: boolean;
  onCompleteOnboarding: (payload: {
    displayName: string;
    organizationName: string;
    jobTitle: string;
    themePreference: ThemePreference;
    selectedPacks: Array<{
      title: string;
      widgetType: WidgetType;
      metricCategory: MetricCategory;
      colSpan: 4 | 6 | 8 | 12;
      targetThreshold: number;
    }>;
    seedInitialTelemetry: boolean;
  }) => Promise<void>;
}

const PRESET_WIDGET_OPTIONS: Array<{
  id: string;
  title: string;
  description: string;
  widgetType: WidgetType;
  metricCategory: MetricCategory;
  colSpan: 4 | 6 | 8 | 12;
  targetThreshold: number;
}> = [
  {
    id: 'pack_rev_kpi',
    title: 'Net Recurring Revenue Velocity',
    description: 'KPI progress tracker comparing current ARR intake against target threshold.',
    widgetType: 'kpi_card',
    metricCategory: 'revenue',
    colSpan: 4,
    targetThreshold: 145000,
  },
  {
    id: 'pack_tput_kpi',
    title: 'Event Ingestion Throughput',
    description: 'Real-time operational ingestion volume across regional edge clusters.',
    widgetType: 'kpi_card',
    metricCategory: 'throughput',
    colSpan: 4,
    targetThreshold: 12000,
  },
  {
    id: 'pack_conv_kpi',
    title: 'Enterprise Activation Rate',
    description: 'Trial-to-production workspace conversion percentage against quarterly goal.',
    widgetType: 'kpi_card',
    metricCategory: 'conversion',
    colSpan: 4,
    targetThreshold: 6.5,
  },
  {
    id: 'pack_rev_area',
    title: 'Revenue Trajectory vs Baseline',
    description: 'Time-series area chart plotting multi-period revenue against historical baseline.',
    widgetType: 'area_chart',
    metricCategory: 'revenue',
    colSpan: 8,
    targetThreshold: 150000,
  },
  {
    id: 'pack_region_ring',
    title: 'Regional Cluster Load Share',
    description: 'Proportional telemetry distribution across US-West, US-East, EU, and APAC.',
    widgetType: 'distribution_ring',
    metricCategory: 'throughput',
    colSpan: 4,
    targetThreshold: 10000,
  },
  {
    id: 'pack_lat_bar',
    title: 'P95 API Latency Benchmark',
    description: 'Horizontal bar comparison of actual endpoint response times versus SLA baseline.',
    widgetType: 'bar_chart',
    metricCategory: 'latency',
    colSpan: 6,
    targetThreshold: 45,
  },
  {
    id: 'pack_ret_table',
    title: 'Cohort Net Retention Ledger',
    description: 'High-density tabular view of net dollar retention across active segments.',
    widgetType: 'data_table',
    metricCategory: 'retention',
    colSpan: 6,
    targetThreshold: 112,
  },
];

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  defaultDisplayName,
  email,
  isDark,
  onCompleteOnboarding,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [displayName, setDisplayName] = useState(defaultDisplayName || 'Alex Rivera');
  const [organizationName, setOrganizationName] = useState('Meridian Systems Inc.');
  const [jobTitle, setJobTitle] = useState('Principal Operations Architect');
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    isDark ? 'dark' : 'light'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([
    'pack_rev_kpi',
    'pack_tput_kpi',
    'pack_conv_kpi',
    'pack_rev_area',
    'pack_region_ring',
    'pack_lat_bar',
    'pack_ret_table',
  ]);
  const [seedInitialTelemetry, setSeedInitialTelemetry] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const togglePack = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = sanitizeString(displayName, SCHEMA_LIMITS.DISPLAY_NAME_MAX, '');
    const cleanOrg = sanitizeString(organizationName, SCHEMA_LIMITS.ORG_NAME_MAX, '');
    const cleanRole = sanitizeString(jobTitle, SCHEMA_LIMITS.JOB_TITLE_MAX, '');

    if (!cleanName || !cleanOrg || !cleanRole) {
      setErrorMsg('Please complete your name, organization, and role before continuing.');
      setStep(1);
      return;
    }

    const chosenPacks = PRESET_WIDGET_OPTIONS.filter((p) => selectedIds.includes(p.id));
    if (chosenPacks.length === 0) {
      setErrorMsg('Please select at least one dashboard widget to initialize your workspace.');
      setStep(2);
      return;
    }

    setSubmitting(true);
    try {
      await onCompleteOnboarding({
        displayName: cleanName,
        organizationName: cleanOrg,
        jobTitle: cleanRole,
        themePreference,
        selectedPacks: chosenPacks.map((p) => ({
          title: p.title,
          widgetType: p.widgetType,
          metricCategory: p.metricCategory,
          colSpan: p.colSpan,
          targetThreshold: p.targetThreshold,
        })),
        seedInitialTelemetry,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to save workspace configuration.'
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`min-h-screen flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      <div className="max-w-2xl w-full mx-auto">
        {/* Progress Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
            <span>Workspace Initialization</span>
            <span className="font-mono tabular-nums">Step {step} of 3</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display">
            Configure your Meridian workspace
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Authenticated as <span className="font-mono">{email}</span>. Let’s tailor your
            schema, isolated PII profile, and initial telemetry widgets.
          </p>

          {/* Step Progress Bar */}
          <div className="grid grid-cols-3 gap-2 mt-5" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3}>
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-sm transition-colors ${
                  idx <= step
                    ? 'bg-blue-600 dark:bg-blue-500'
                    : isDark
                    ? 'bg-slate-800'
                    : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Form Container */}
        <form
          onSubmit={handleFinish}
          className={`rounded-lg border p-6 sm:p-8 ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
          }`}
        >
          {errorMsg && (
            <div
              role="alert"
              className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-300"
            >
              {errorMsg}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">01. Identity & Organization Profile</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Your public workspace profile is stored separately from your private verified email
                  record for strict PII isolation.
                </p>
              </div>

              <div>
                <label
                  htmlFor="onboard-name"
                  className="block text-xs font-medium mb-1.5"
                >
                  Full Name ({displayName.length}/{SCHEMA_LIMITS.DISPLAY_NAME_MAX})
                </label>
                <input
                  id="onboard-name"
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.DISPLAY_NAME_MAX}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={`w-full rounded-md border px-3.5 py-2.5 text-sm focus:outline-2 focus:outline-blue-600 ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}
                  placeholder="e.g. Alex Rivera"
                />
              </div>

              <div>
                <label
                  htmlFor="onboard-org"
                  className="block text-xs font-medium mb-1.5"
                >
                  Organization or Team Name ({organizationName.length}/{SCHEMA_LIMITS.ORG_NAME_MAX})
                </label>
                <input
                  id="onboard-org"
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.ORG_NAME_MAX}
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className={`w-full rounded-md border px-3.5 py-2.5 text-sm focus:outline-2 focus:outline-blue-600 ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}
                  placeholder="e.g. Meridian Systems Inc."
                />
              </div>

              <div>
                <label
                  htmlFor="onboard-role"
                  className="block text-xs font-medium mb-1.5"
                >
                  Operational Role ({jobTitle.length}/{SCHEMA_LIMITS.JOB_TITLE_MAX})
                </label>
                <input
                  id="onboard-role"
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.JOB_TITLE_MAX}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className={`w-full rounded-md border px-3.5 py-2.5 text-sm focus:outline-2 focus:outline-blue-600 ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-slate-100'
                      : 'bg-white border-slate-300 text-slate-900'
                  }`}
                  placeholder="e.g. Principal Systems Architect"
                />
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Continue to Widgets
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold">02. Select Initial Dashboard Widgets</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Choose which telemetry visualizations to mount on your customizable dashboard. You
                  can add, resize, or reconfigure widgets at any time.
                </p>
              </div>

              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {PRESET_WIDGET_OPTIONS.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => togglePack(item.id)}
                      className={`w-full text-left rounded-md border p-3.5 transition-colors flex items-start justify-between gap-4 cursor-pointer ${
                        isSelected
                          ? isDark
                            ? 'bg-blue-950/30 border-blue-500/60'
                            : 'bg-blue-50/70 border-blue-600'
                          : isDark
                          ? 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="capitalize">{item.metricCategory}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{item.colSpan}-col span</span>
                        </div>
                        <div className="text-sm font-semibold mt-0.5">{item.title}</div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {item.description}
                        </p>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-sm flex items-center justify-center shrink-0 mt-1 border ${
                          isSelected
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : isDark
                            ? 'border-slate-700'
                            : 'border-slate-300'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isDark
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Continue to Preferences
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">03. Theme & Telemetry Seeding</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Configure your default interface appearance and choose whether to populate
                  baseline operational telemetry records immediately.
                </p>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-medium">Default Interface Appearance</span>
                <div className="grid grid-cols-2 gap-3">
                  {(['dark', 'light'] as ThemePreference[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setThemePreference(mode)}
                      className={`p-3.5 rounded-md border text-left transition-colors cursor-pointer ${
                        themePreference === mode
                          ? isDark
                            ? 'border-blue-500 bg-blue-950/30'
                            : 'border-blue-600 bg-blue-50/70'
                          : isDark
                          ? 'border-slate-800 bg-slate-950'
                          : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-semibold capitalize">{mode} Mode</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {mode === 'dark'
                          ? 'Deep slate canvas optimized for low-light monitoring'
                          : 'High-contrast daylight surface for editorial clarity'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className={`p-4 rounded-md border ${
                  isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seedInitialTelemetry}
                    onChange={(e) => setSeedInitialTelemetry(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="block text-sm font-semibold">
                      Populate initial multi-region telemetry dataset
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Creates 12 realistic time-series records across revenue, throughput, latency,
                      conversion, and retention so your charts render immediately.
                    </span>
                  </div>
                </label>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={submitting}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isDark
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {submitting ? 'Provisioning Workspace...' : 'Launch Workspace Dashboard'}
                  <Check className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
