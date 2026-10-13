import React, { useMemo } from 'react';
import { MetricRecord, DashboardWidget } from '../types';
import { ArrowUpRight, ArrowDownRight, EyeOff, SlidersHorizontal } from 'lucide-react';

interface DataVisualizationsProps {
  widget: DashboardWidget;
  metrics: MetricRecord[];
  isDark: boolean;
  onConfigureWidget: (widget: DashboardWidget) => void;
  onToggleVisibility: (widget: DashboardWidget) => void;
}

export const WidgetRenderer: React.FC<DataVisualizationsProps> = ({
  widget,
  metrics,
  isDark,
  onConfigureWidget,
  onToggleVisibility,
}) => {
  const categoryMetrics = useMemo(() => {
    const filtered = metrics.filter(
      (m) => m.category === widget.metricCategory && m.status !== 'archived'
    );
    return filtered.length > 0 ? filtered : metrics.filter((m) => m.status !== 'archived');
  }, [metrics, widget.metricCategory]);

  const summary = useMemo(() => {
    if (categoryMetrics.length === 0) {
      return {
        latestValue: 0,
        baselineValue: 0,
        deltaPercent: 0,
        unit: '',
        status: 'nominal' as const,
      };
    }
    const latest = categoryMetrics[0];
    const totalVal = categoryMetrics.reduce((acc, item) => acc + item.value, 0);
    const totalBase = categoryMetrics.reduce((acc, item) => acc + item.baseline, 0);
    const avgVal = Number((totalVal / categoryMetrics.length).toFixed(2));
    const avgBase = Number((totalBase / categoryMetrics.length).toFixed(2));
    const safeBase = avgBase !== 0 ? Math.abs(avgBase) : 1;
    const delta = Number((((avgVal - avgBase) / safeBase) * 100).toFixed(1));

    const hasCritical = categoryMetrics.some((m) => m.status === 'critical');
    const hasWarning = categoryMetrics.some((m) => m.status === 'warning');

    return {
      latestValue: avgVal,
      baselineValue: avgBase,
      deltaPercent: delta,
      unit: latest.unit,
      status: hasCritical ? 'critical' : hasWarning ? 'warning' : 'nominal',
    };
  }, [categoryMetrics]);

  const formatMetricValue = (val: number, unit: string) => {
    if (unit === '$' || unit === 'USD') {
      return `$${val.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
    }
    if (unit === '%') {
      return `${val.toFixed(1)}%`;
    }
    return `${val.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
  };

  return (
    <article
      aria-label={widget.title}
      className={`flex flex-col justify-between rounded-lg border p-5 transition-opacity duration-150 ${
        isDark
          ? 'bg-slate-900 border-slate-800 text-slate-100'
          : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="capitalize">{widget.metricCategory}</span>
            <span aria-hidden="true">·</span>
            <span>Target {formatMetricValue(widget.targetThreshold, summary.unit || '')}</span>
          </div>
          <h3 className="text-base font-semibold tracking-tight truncate">{widget.title}</h3>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onConfigureWidget(widget)}
            aria-label={`Configure ${widget.title}`}
            title="Configure widget threshold and span"
            className={`p-2 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              isDark
                ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggleVisibility(widget)}
            aria-label={`Hide ${widget.title}`}
            title="Hide widget from canvas"
            className={`p-2 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
              isDark
                ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <EyeOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body Visualization by Widget Type */}
      {categoryMetrics.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          No active records in this category. Log or seed telemetry entries to populate.
        </div>
      ) : widget.widgetType === 'kpi_card' ? (
        <div className="space-y-3 my-auto">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-3xl font-bold font-mono tabular-nums tracking-tight">
              {formatMetricValue(summary.latestValue, summary.unit)}
            </span>
            <span
              className={`inline-flex items-center gap-1 text-xs font-mono tabular-nums font-medium ${
                summary.deltaPercent >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {summary.deltaPercent >= 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" />
              )}
              {summary.deltaPercent >= 0 ? `+${summary.deltaPercent}%` : `${summary.deltaPercent}%`} vs baseline
            </span>
          </div>

          {/* Progress toward target threshold */}
          <div className="space-y-1.5 pt-2">
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span>Baseline: {formatMetricValue(summary.baselineValue, summary.unit)}</span>
              <span>
                {Math.min(
                  100,
                  Math.max(
                    0,
                    Math.round(
                      (summary.latestValue / (widget.targetThreshold || 1)) * 100
                    )
                  )
                )}
                % of goal
              </span>
            </div>
            <div className="w-full h-2 rounded-sm overflow-hidden bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full bg-blue-600 dark:bg-blue-500 transition-transform duration-150 origin-left"
                style={{
                  transform: `scaleX(${Math.min(
                    1,
                    Math.max(0.05, summary.latestValue / (widget.targetThreshold || 1))
                  )})`,
                }}
              />
            </div>
          </div>
        </div>
      ) : widget.widgetType === 'area_chart' ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono tabular-nums">
              {formatMetricValue(summary.latestValue, summary.unit)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {categoryMetrics.length} intervals tracked
            </span>
          </div>
          <AreaChartSvg records={categoryMetrics.slice(0, 8).reverse()} isDark={isDark} />
        </div>
      ) : widget.widgetType === 'bar_chart' ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold font-mono tabular-nums">
              {formatMetricValue(summary.latestValue, summary.unit)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Actual vs Baseline Comparison
            </span>
          </div>
          <BarChartSvg records={categoryMetrics.slice(0, 6)} isDark={isDark} />
        </div>
      ) : widget.widgetType === 'distribution_ring' ? (
        <DistributionBreakdown records={categoryMetrics} isDark={isDark} />
      ) : (
        <CompactWidgetTable records={categoryMetrics.slice(0, 5)} isDark={isDark} />
      )}

      {/* Footer Metadata Line */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          State:{' '}
          <strong
            className={
              summary.status === 'critical'
                ? 'text-red-600 dark:text-red-400 font-semibold'
                : summary.status === 'warning'
                ? 'text-amber-600 dark:text-amber-400 font-semibold'
                : 'text-emerald-600 dark:text-emerald-400 font-semibold'
            }
          >
            {summary.status === 'critical'
              ? 'Critical Alert'
              : summary.status === 'warning'
              ? 'Warning Threshold'
              : 'Nominal Operation'}
          </strong>
        </span>
        <span className="font-mono tabular-nums">{categoryMetrics.length} records</span>
      </div>
    </article>
  );
};

const AreaChartSvg: React.FC<{ records: MetricRecord[]; isDark: boolean }> = ({
  records,
  isDark,
}) => {
  const width = 460;
  const height = 140;
  const padX = 24;
  const padY = 18;

  const values = records.map((r) => r.value);
  const baselines = records.map((r) => r.baseline);
  const allNums = [...values, ...baselines, 1];
  const minVal = Math.min(...allNums) * 0.85;
  const maxVal = Math.max(...allNums) * 1.1;
  const range = maxVal - minVal || 1;

  const getCoords = (arr: number[]) =>
    arr.map((val, idx) => {
      const x =
        arr.length === 1
          ? width / 2
          : padX + (idx / (arr.length - 1)) * (width - padX * 2);
      const y = height - padY - ((val - minVal) / range) * (height - padY * 2);
      return { x, y, val };
    });

  const valPoints = getCoords(values);
  const basePoints = getCoords(baselines);

  const linePath = valPoints
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const basePath = basePoints
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    valPoints.length > 0
      ? `${linePath} L ${valPoints[valPoints.length - 1].x.toFixed(1)} ${(
          height - padY
        ).toFixed(1)} L ${valPoints[0].x.toFixed(1)} ${(height - padY).toFixed(1)} Z`
      : '';

  return (
    <div className="w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-36 overflow-visible"
        role="img"
        aria-label="Time-series area chart comparing actual metric values against baseline"
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity={isDark ? 0.38 : 0.24} />
            <stop offset="100%" stopColor="#2563EB" stopOpacity={0.0} />
          </linearGradient>
        </defs>

        {/* Horizontal Reference Grid Lines */}
        {[0.2, 0.5, 0.8].map((ratio, idx) => {
          const y = padY + ratio * (height - padY * 2);
          return (
            <line
              key={idx}
              x1={padX}
              y1={y}
              x2={width - padX}
              y2={y}
              stroke={isDark ? '#1E293B' : '#E2E8F0'}
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          );
        })}

        {/* Baseline Dashed Curve */}
        {basePoints.length > 1 && (
          <path
            d={basePath}
            fill="none"
            stroke={isDark ? '#64748B' : '#94A3B8'}
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}

        {/* Primary Area & Line */}
        {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="#2563EB"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data Nodes & Period Labels */}
        {valPoints.map((pt, idx) => (
          <g key={records[idx]?.id || idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r="3.5"
              fill={isDark ? '#0F172A' : '#FFFFFF'}
              stroke="#2563EB"
              strokeWidth="2"
            />
            <text
              x={pt.x}
              y={height - 3}
              textAnchor="middle"
              fill={isDark ? '#94A3B8' : '#64748B'}
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              {(records[idx]?.periodLabel || '').slice(0, 7)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const BarChartSvg: React.FC<{ records: MetricRecord[]; isDark: boolean }> = ({
  records,
  isDark,
}) => {
  const maxVal = Math.max(
    ...records.flatMap((r) => [r.value, r.baseline]),
    1
  );

  return (
    <div className="space-y-2.5 pt-1">
      {records.map((rec) => {
        const valPct = Math.min(100, Math.max(4, Math.round((rec.value / maxVal) * 100)));
        const basePct = Math.min(100, Math.max(4, Math.round((rec.baseline / maxVal) * 100)));
        return (
          <div key={rec.id} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate max-w-[180px] font-medium">{rec.label}</span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {rec.value.toLocaleString()} / {rec.baseline.toLocaleString()} {rec.unit}
              </span>
            </div>
            <div className="relative h-2.5 w-full rounded-sm bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-blue-600 dark:bg-blue-500 rounded-sm"
                style={{ width: `${valPct}%` }}
              />
              <div
                title={`Baseline: ${rec.baseline}`}
                className={`absolute inset-y-0 w-0.5 ${
                  isDark ? 'bg-amber-400' : 'bg-slate-900'
                }`}
                style={{ left: `${basePct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DistributionBreakdown: React.FC<{ records: MetricRecord[]; isDark: boolean }> = ({
  records,
}) => {
  const byRegion = useMemo(() => {
    const map: Record<string, number> = {
      'us-west': 0,
      'us-east': 0,
      'eu-central': 0,
      'ap-northeast': 0,
    };
    for (const r of records) {
      map[r.region] = (map[r.region] || 0) + Math.abs(r.value);
    }
    const total = Object.values(map).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(map).map(([region, sum]) => ({
      region,
      sum: Number(sum.toFixed(1)),
      pct: Math.round((sum / total) * 100),
    }));
  }, [records]);

  const colors: Record<string, string> = {
    'us-west': 'bg-blue-600',
    'us-east': 'bg-emerald-600',
    'eu-central': 'bg-amber-500',
    'ap-northeast': 'bg-indigo-500',
  };

  return (
    <div className="space-y-3 my-auto">
      {/* Stacked horizontal bar */}
      <div className="h-3 w-full rounded-sm overflow-hidden flex bg-slate-100 dark:bg-slate-800">
        {byRegion.map((item) =>
          item.pct > 0 ? (
            <div
              key={item.region}
              style={{ width: `${item.pct}%` }}
              className={`${colors[item.region] || 'bg-blue-600'} h-full`}
              title={`${item.region}: ${item.pct}%`}
            />
          ) : null
        )}
      </div>

      {/* Regional tabular legend */}
      <div className="grid grid-cols-2 gap-2.5 pt-1">
        {byRegion.map((item) => (
          <div
            key={item.region}
            className="flex items-center justify-between text-xs border-b border-slate-100 dark:border-slate-800/70 pb-1.5"
          >
            <span className="uppercase font-mono text-slate-500 dark:text-slate-400">
              {item.region}
            </span>
            <span className="font-mono tabular-nums font-semibold">{item.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const CompactWidgetTable: React.FC<{ records: MetricRecord[]; isDark: boolean }> = ({
  records,
  isDark,
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr
            className={`border-b ${
              isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
            }`}
          >
            <th className="py-2 pr-2 font-medium">Metric</th>
            <th className="py-2 px-2 font-medium">Region</th>
            <th className="py-2 pl-2 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {records.map((rec) => (
            <tr key={rec.id} className="h-9">
              <td className="py-1.5 pr-2 font-medium truncate max-w-[140px]">{rec.label}</td>
              <td className="py-1.5 px-2 font-mono text-slate-500 dark:text-slate-400">
                {rec.region}
              </td>
              <td className="py-1.5 pl-2 text-right font-mono tabular-nums font-semibold">
                {rec.value.toLocaleString()} {rec.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
