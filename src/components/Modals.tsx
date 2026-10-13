import React, { useState } from 'react';
import {
  DashboardWidget,
  MetricCategory,
  MetricRecord,
  MetricRegion,
  MetricStatus,
  WidgetType,
  SCHEMA_LIMITS,
  sanitizeString,
  clampNumber,
} from '../types';
import { X, Eye, Trash2, Plus } from 'lucide-react';

interface MetricModalProps {
  isOpen: boolean;
  isDark: boolean;
  initialRecord?: MetricRecord | null;
  onClose: () => void;
  onSaveMetric: (payload: {
    id?: string;
    label: string;
    category: MetricCategory;
    region: MetricRegion;
    value: number;
    baseline: number;
    unit: string;
    status: MetricStatus;
    periodLabel: string;
  }) => Promise<void>;
}

export const MetricEntryModal: React.FC<MetricModalProps> = ({
  isOpen,
  isDark,
  initialRecord,
  onClose,
  onSaveMetric,
}) => {
  const [label, setLabel] = useState(initialRecord?.label || 'Edge Cluster Throughput');
  const [category, setCategory] = useState<MetricCategory>(
    initialRecord?.category || 'throughput'
  );
  const [region, setRegion] = useState<MetricRegion>(initialRecord?.region || 'us-west');
  const [value, setValue] = useState(String(initialRecord?.value ?? 12450));
  const [baseline, setBaseline] = useState(String(initialRecord?.baseline ?? 11000));
  const [unit, setUnit] = useState(initialRecord?.unit || 'req/s');
  const [status, setStatus] = useState<MetricStatus>(initialRecord?.status || 'nominal');
  const [periodLabel, setPeriodLabel] = useState(initialRecord?.periodLabel || '2026-W41');
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveMetric({
        id: initialRecord?.id,
        label: sanitizeString(label, SCHEMA_LIMITS.METRIC_LABEL_MAX, 'Metric Entry'),
        category,
        region,
        value: clampNumber(Number(value), SCHEMA_LIMITS.VALUE_MIN, SCHEMA_LIMITS.VALUE_MAX),
        baseline: clampNumber(Number(baseline), SCHEMA_LIMITS.VALUE_MIN, SCHEMA_LIMITS.VALUE_MAX),
        unit: sanitizeString(unit, SCHEMA_LIMITS.METRIC_UNIT_MAX, 'units'),
        status,
        periodLabel: sanitizeString(periodLabel, SCHEMA_LIMITS.PERIOD_LABEL_MAX, '2026-Q4'),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-modal-title"
    >
      <div
        className={`w-full max-w-lg rounded-lg border p-6 ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
          <h2 id="metric-modal-title" className="text-base font-semibold">
            {initialRecord ? 'Update Telemetry Record' : 'Log New Telemetry Record'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">
              Metric Label ({label.length}/{SCHEMA_LIMITS.METRIC_LABEL_MAX})
            </label>
            <input
              type="text"
              required
              maxLength={SCHEMA_LIMITS.METRIC_LABEL_MAX}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                isDark
                  ? 'bg-slate-950 border-slate-800 text-slate-100'
                  : 'bg-white border-slate-300 text-slate-900'
              }`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MetricCategory)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value="revenue">Revenue</option>
                <option value="throughput">Throughput</option>
                <option value="latency">Latency</option>
                <option value="conversion">Conversion</option>
                <option value="retention">Retention</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Cluster Region</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as MetricRegion)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value="us-west">us-west</option>
                <option value="us-east">us-east</option>
                <option value="eu-central">eu-central</option>
                <option value="ap-northeast">ap-northeast</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Observed Value</label>
              <input
                type="number"
                step="any"
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono tabular-nums ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Baseline Target</label>
              <input
                type="number"
                step="any"
                required
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono tabular-nums ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Unit (e.g. USD, ms, %)</label>
              <input
                type="text"
                required
                maxLength={SCHEMA_LIMITS.METRIC_UNIT_MAX}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Period Identifier</label>
              <input
                type="text"
                required
                maxLength={SCHEMA_LIMITS.PERIOD_LABEL_MAX}
                value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Operational State</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as MetricStatus)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value="nominal">Nominal Operation</option>
                <option value="warning">Warning Threshold</option>
                <option value="critical">Critical Alert</option>
                <option value="archived">Archived (Terminal Lock)</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-md text-xs font-medium border ${
                isDark
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : initialRecord ? 'Save Changes' : 'Create Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface WidgetCustomizerDrawerProps {
  isOpen: boolean;
  isDark: boolean;
  widgets: DashboardWidget[];
  editingWidget: DashboardWidget | null;
  onClose: () => void;
  onCreateWidget: (payload: {
    title: string;
    widgetType: WidgetType;
    metricCategory: MetricCategory;
    colSpan: 4 | 6 | 8 | 12;
    targetThreshold: number;
  }) => Promise<void>;
  onUpdateWidget: (
    widget: DashboardWidget,
    updates: Partial<
      Pick<
        DashboardWidget,
        'title' | 'widgetType' | 'metricCategory' | 'colSpan' | 'isVisible' | 'targetThreshold'
      >
    >
  ) => Promise<void>;
  onDeleteWidget: (widgetId: string) => Promise<void>;
}

export const WidgetCustomizerModal: React.FC<WidgetCustomizerDrawerProps> = ({
  isOpen,
  isDark,
  widgets,
  editingWidget,
  onClose,
  onCreateWidget,
  onUpdateWidget,
  onDeleteWidget,
}) => {
  const [title, setTitle] = useState(editingWidget?.title || 'Regional Conversion Velocity');
  const [widgetType, setWidgetType] = useState<WidgetType>(
    editingWidget?.widgetType || 'area_chart'
  );
  const [metricCategory, setMetricCategory] = useState<MetricCategory>(
    editingWidget?.metricCategory || 'conversion'
  );
  const [colSpan, setColSpan] = useState<4 | 6 | 8 | 12>(editingWidget?.colSpan || 6);
  const [targetThreshold, setTargetThreshold] = useState(
    String(editingWidget?.targetThreshold ?? 100)
  );
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (editingWidget) {
      setTitle(editingWidget.title);
      setWidgetType(editingWidget.widgetType);
      setMetricCategory(editingWidget.metricCategory);
      setColSpan(editingWidget.colSpan);
      setTargetThreshold(String(editingWidget.targetThreshold));
    } else {
      setTitle('Custom Telemetry View');
      setWidgetType('area_chart');
      setMetricCategory('revenue');
      setColSpan(6);
      setTargetThreshold('150000');
    }
  }, [editingWidget]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanTitle = sanitizeString(title, SCHEMA_LIMITS.WIDGET_TITLE_MAX, 'Custom Widget');
      const cleanThreshold = clampNumber(
        Number(targetThreshold),
        SCHEMA_LIMITS.VALUE_MIN,
        SCHEMA_LIMITS.VALUE_MAX
      );

      if (editingWidget) {
        await onUpdateWidget(editingWidget, {
          title: cleanTitle,
          widgetType,
          metricCategory,
          colSpan,
          targetThreshold: cleanThreshold,
        });
      } else {
        await onCreateWidget({
          title: cleanTitle,
          widgetType,
          metricCategory,
          colSpan,
          targetThreshold: cleanThreshold,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const hiddenWidgets = widgets.filter((w) => !w.isVisible);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="widget-customizer-title"
    >
      <div
        className={`w-full max-w-xl rounded-lg border p-6 max-h-[90vh] overflow-y-auto ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4 mb-5">
          <h2 id="widget-customizer-title" className="text-base font-semibold">
            {editingWidget ? `Configure Widget: ${editingWidget.title}` : 'Add Dashboard Widget'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close widget customizer"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">
              Widget Title ({title.length}/{SCHEMA_LIMITS.WIDGET_TITLE_MAX})
            </label>
            <input
              type="text"
              required
              maxLength={SCHEMA_LIMITS.WIDGET_TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`w-full rounded-md border px-3 py-2 text-sm ${
                isDark
                  ? 'bg-slate-950 border-slate-800 text-slate-100'
                  : 'bg-white border-slate-300 text-slate-900'
              }`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Visualization Type</label>
              <select
                value={widgetType}
                onChange={(e) => setWidgetType(e.target.value as WidgetType)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value="kpi_card">KPI Summary Card</option>
                <option value="area_chart">Time-Series Area Chart</option>
                <option value="bar_chart">Baseline Comparison Bar Chart</option>
                <option value="distribution_ring">Regional Distribution Breakdown</option>
                <option value="data_table">Compact Telemetry Table</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Metric Stream Category</label>
              <select
                value={metricCategory}
                onChange={(e) => setMetricCategory(e.target.value as MetricCategory)}
                className={`w-full rounded-md border px-3 py-2 text-sm ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value="revenue">Revenue</option>
                <option value="throughput">Throughput</option>
                <option value="latency">Latency</option>
                <option value="conversion">Conversion</option>
                <option value="retention">Retention</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1">Grid Column Span (12-Col Grid)</label>
              <select
                value={colSpan}
                onChange={(e) => setColSpan(Number(e.target.value) as 4 | 6 | 8 | 12)}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value={4}>4 Columns (One-Third Width)</option>
                <option value={6}>6 Columns (Half Width)</option>
                <option value={8}>8 Columns (Two-Thirds Width)</option>
                <option value={12}>12 Columns (Full Width)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Target Goal Threshold</label>
              <input
                type="number"
                step="any"
                required
                value={targetThreshold}
                onChange={(e) => setTargetThreshold(e.target.value)}
                className={`w-full rounded-md border px-3 py-2 text-sm font-mono tabular-nums ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 text-slate-100'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            {editingWidget ? (
              <button
                type="button"
                onClick={async () => {
                  await onDeleteWidget(editingWidget.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Widget
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-2 rounded-md text-xs font-medium border ${
                  isDark
                    ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : editingWidget ? 'Update Widget' : 'Mount Widget'}
              </button>
            </div>
          </div>
        </form>

        {/* Hidden Widgets Recovery List */}
        {hiddenWidgets.length > 0 && (
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">
              Hidden Widgets ({hiddenWidgets.length})
            </h3>
            <div className="space-y-2">
              {hiddenWidgets.map((hw) => (
                <div
                  key={hw.id}
                  className={`flex items-center justify-between p-2.5 rounded-md border text-xs ${
                    isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div>
                    <span className="font-medium">{hw.title}</span>
                    <span className="text-slate-500 ml-2 capitalize">· {hw.metricCategory}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUpdateWidget(hw, { isVisible: true })}
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium hover:underline"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
