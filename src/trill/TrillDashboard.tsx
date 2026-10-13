import React, { useState, useEffect, useMemo } from 'react';
import {
  api,
  TrillPerson,
  TrillRecognitionEvent,
  TrillStats,
  STATUS_COLOR,
  STATUS_LABEL,
  fmtDate,
  initials,
} from './engine';
import {
  SlidersHorizontal,
  Eye,
  EyeOff,
  RotateCcw,
  ScanFace,
  Users,
  Activity,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export interface TrillWidgetConfig {
  id: string;
  title: string;
  subtitle: string;
  visible: boolean;
  colSpan: 6 | 12;
  type: 'kpi' | 'distribution' | 'timeline' | 'roster' | 'distance';
}

const DEFAULT_TRILL_WIDGETS: TrillWidgetConfig[] = [
  {
    id: 'w_kpi',
    title: 'Biometric Recognition Summary',
    subtitle: 'Enrolled people, face samples, and live match rate',
    visible: true,
    colSpan: 12,
    type: 'kpi',
  },
  {
    id: 'w_dist',
    title: 'Recognition Status Breakdown',
    subtitle: 'Ratio of Recognized, Possible match, and Unknown detections',
    visible: true,
    colSpan: 6,
    type: 'distribution',
  },
  {
    id: 'w_distance',
    title: 'Euclidean Embedding Distance Curve',
    subtitle: '128-d face descriptor distances across recent recognitions',
    visible: true,
    colSpan: 6,
    type: 'distance',
  },
  {
    id: 'w_roster',
    title: 'Enrolled Gallery Coverage',
    subtitle: 'Sample count per enrolled person (3–5 samples recommended)',
    visible: true,
    colSpan: 6,
    type: 'roster',
  },
  {
    id: 'w_timeline',
    title: 'Recent Device Recognitions',
    subtitle: 'Latest on-device identity events synced to server',
    visible: true,
    colSpan: 6,
    type: 'timeline',
  },
];

const WIDGET_STORAGE_KEY = 'trill.dashboard.widgets.v1';

export const TrillAnalyticsDashboard: React.FC<{
  onNavigate: (tab: 'live' | 'upload' | 'people' | 'log' | 'settings') => void;
}> = ({ onNavigate }) => {
  const [widgets, setWidgets] = useState<TrillWidgetConfig[]>(() => {
    try {
      const saved = localStorage.getItem(WIDGET_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return DEFAULT_TRILL_WIDGETS;
  });
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [stats, setStats] = useState<TrillStats>({
    people: 0,
    faces: 0,
    events: 0,
    eventsToday: 0,
  });
  const [people, setPeople] = useState<TrillPerson[]>([]);
  const [events, setEvents] = useState<TrillRecognitionEvent[]>([]);

  const loadAll = async () => {
    try {
      const [s, p, ev] = await Promise.all([api.stats(), api.people(), api.events(150)]);
      setStats(s);
      setPeople(p);
      setEvents(ev);
    } catch {
      // offline fallback
    }
  };

  useEffect(() => {
    loadAll();
    const onSync = () => loadAll();
    window.addEventListener('trill:gallery-changed', onSync);
    return () => window.removeEventListener('trill:gallery-changed', onSync);
  }, []);

  const saveWidgets = (next: TrillWidgetConfig[]) => {
    setWidgets(next);
    localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(next));
  };

  const toggleWidget = (id: string) => {
    saveWidgets(widgets.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)));
  };

  const toggleColSpan = (id: string) => {
    saveWidgets(
      widgets.map((w) => (w.id === id ? { ...w, colSpan: w.colSpan === 12 ? 6 : 12 } : w))
    );
  };

  const statusCounts = useMemo(() => {
    let match = 0;
    let possible = 0;
    let unknown = 0;
    for (const e of events) {
      if (e.status === 'match') match++;
      else if (e.status === 'possible') possible++;
      else unknown++;
    }
    const total = Math.max(1, match + possible + unknown);
    return {
      match,
      possible,
      unknown,
      matchPct: Math.round((match / total) * 100),
      possiblePct: Math.round((possible / total) * 100),
      unknownPct: Math.round((unknown / total) * 100),
    };
  }, [events]);

  const distancePoints = useMemo(() => {
    return events
      .filter((e) => typeof e.distance === 'number')
      .slice(0, 24)
      .reverse();
  }, [events]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Recognition analytics & widgets
          </h1>
          <p className="text-sm text-slate-500 dark:text-[#8b98b5]">
            Customizable biometric telemetry for your enrolled gallery and recognition log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCustomizerOpen(!customizerOpen)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
            Customize widgets
          </button>
        </div>
      </div>

      {/* Widget Customizer Panel */}
      {customizerOpen && (
        <div className="p-4 rounded-2xl bg-white dark:bg-[#141e33] border border-sky-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-bold uppercase tracking-wider text-sky-400">
              Customize Dashboard Layout
            </strong>
            <button
              type="button"
              onClick={() => saveWidgets(DEFAULT_TRILL_WIDGETS)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-200"
            >
              <RotateCcw className="w-3 h-3" /> Reset layout
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {widgets.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#101828] border border-slate-200 dark:border-[#24314d]"
              >
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate pr-2">
                  {w.title}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleColSpan(w.id)}
                    className="px-2 py-1 rounded bg-slate-200 dark:bg-[#1b2742] text-[10px] font-mono text-slate-700 dark:text-slate-300"
                  >
                    {w.colSpan === 12 ? 'Full' : 'Half'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleWidget(w.id)}
                    aria-label={w.visible ? 'Hide widget' : 'Show widget'}
                    className={`p-1.5 rounded-lg ${
                      w.visible ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400'
                    }`}
                  >
                    {w.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 12-Column Widget Grid */}
      <div className="grid grid-cols-12 gap-4">
        {widgets
          .filter((w) => w.visible)
          .map((w) => (
            <div
              key={w.id}
              className={`${
                w.colSpan === 12 ? 'col-span-12' : 'col-span-12 lg:col-span-6'
              } p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] flex flex-col justify-between`}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {w.title}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-[#8b98b5]">{w.subtitle}</p>
                </div>
              </div>

              {w.type === 'kpi' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#101828] border border-slate-200/70 dark:border-[#24314d]">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8b98b5]">
                      <span>Enrolled people</span>
                      <Users className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                      {stats.people}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#101828] border border-slate-200/70 dark:border-[#24314d]">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8b98b5]">
                      <span>128-d Face samples</span>
                      <ScanFace className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                      {stats.faces}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#101828] border border-slate-200/70 dark:border-[#24314d]">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8b98b5]">
                      <span>Events today</span>
                      <Activity className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                      {stats.eventsToday}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#101828] border border-slate-200/70 dark:border-[#24314d]">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8b98b5]">
                      <span>Recognition rate</span>
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                      {events.length ? `${statusCounts.matchPct}%` : '—'}
                    </div>
                  </div>
                </div>
              )}

              {w.type === 'distribution' && (
                <div className="space-y-4">
                  {[
                    {
                      key: 'match',
                      label: 'Recognized (match)',
                      count: statusCounts.match,
                      pct: statusCounts.matchPct,
                      color: STATUS_COLOR.match,
                    },
                    {
                      key: 'possible',
                      label: 'Possible match (ambiguous)',
                      count: statusCounts.possible,
                      pct: statusCounts.possiblePct,
                      color: STATUS_COLOR.possible,
                    },
                    {
                      key: 'unknown',
                      label: 'Unknown face',
                      count: statusCounts.unknown,
                      pct: statusCounts.unknownPct,
                      color: STATUS_COLOR.unknown,
                    },
                  ].map((row) => (
                    <div key={row.key} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {row.label}
                        </span>
                        <span className="font-mono text-slate-500 dark:text-[#8b98b5]">
                          {row.count} ({row.pct}%)
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-[#101828] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(4, row.pct)}%`, background: row.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {w.type === 'distance' && (
                <div>
                  {distancePoints.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-xs text-slate-500 dark:text-[#8b98b5]">
                      Run Live recognition or Analyze photo to plot Euclidean embedding distances.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <svg viewBox="0 0 400 130" className="w-full h-36 overflow-visible">
                        {/* Threshold 0.50 reference line */}
                        <line
                          x1="0"
                          y1={130 - (0.5 / 0.8) * 110}
                          x2="400"
                          y2={130 - (0.5 / 0.8) * 110}
                          stroke="#38bdf8"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        {distancePoints.map((pt, idx) => {
                          const x =
                            distancePoints.length === 1
                              ? 200
                              : (idx / (distancePoints.length - 1)) * 380 + 10;
                          const d = Math.min(0.8, Math.max(0, pt.distance || 0));
                          const y = 120 - (d / 0.8) * 100;
                          const c = STATUS_COLOR[pt.status] || '#38bdf8';
                          return (
                            <g key={pt.id}>
                              <circle cx={x} cy={y} r="4.5" fill={c} />
                            </g>
                          );
                        })}
                      </svg>
                      <div className="flex justify-between text-[11px] font-mono text-slate-500 dark:text-[#8b98b5]">
                        <span>Dashed line = 0.50 threshold (lower distance = stronger match)</span>
                        <span>{distancePoints.length} samples</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {w.type === 'roster' && (
                <div className="space-y-2.5">
                  {people.length === 0 ? (
                    <div className="py-6 text-center space-y-2">
                      <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
                        No people enrolled in the gallery yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => onNavigate('people')}
                        className="px-3.5 py-1.5 rounded-xl bg-sky-400 text-slate-950 text-xs font-semibold"
                      >
                        Add first person
                      </button>
                    </div>
                  ) : (
                    people.slice(0, 5).map((p) => {
                      const count = p.faceCount || 0;
                      const readiness = Math.min(100, Math.round((count / 4) * 100));
                      return (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-[#101828]"
                        >
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                            style={{ background: p.color }}
                          >
                            {initials(p.name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-xs">
                              <strong className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {p.name}
                              </strong>
                              <span className="font-mono text-slate-500 dark:text-[#8b98b5]">
                                {count} sample{count === 1 ? '' : 's'}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-[#1b2742] mt-1 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${readiness}%`, background: p.color }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {w.type === 'timeline' && (
                <div className="space-y-2">
                  {events.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500 dark:text-[#8b98b5]">
                      No recognition events logged yet.
                    </div>
                  ) : (
                    events.slice(0, 5).map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#101828] text-xs"
                      >
                        <div className="min-w-0">
                          <strong className="font-semibold text-slate-900 dark:text-slate-100 block truncate">
                            {e.label}
                          </strong>
                          <span className="text-[11px] text-slate-500 dark:text-[#8b98b5]">
                            {fmtDate(e.createdAt)} · {e.device || 'device'}
                          </span>
                        </div>
                        <span
                          className="px-2 py-0.5 rounded font-semibold shrink-0"
                          style={{
                            background: `${STATUS_COLOR[e.status]}22`,
                            color: STATUS_COLOR[e.status],
                          }}
                        >
                          {STATUS_LABEL[e.status]}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
};

// ============================================================================
// Onboarding Modal for New Authenticated Users
// ============================================================================
export const TrillOnboardingModal: React.FC<{
  open: boolean;
  displayName: string;
  onComplete: (opts: { detector: 'tiny' | 'ssd'; threshold: number; theme: 'dark' | 'light' }) => void;
  onSkip: () => void;
}> = ({ open, displayName, onComplete, onSkip }) => {
  const [step, setStep] = useState(1);
  const [detector, setDetector] = useState<'tiny' | 'ssd'>('tiny');
  const [threshold, setThreshold] = useState(0.5);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] shadow-2xl overflow-hidden">
        <header className="px-6 py-4 border-b border-slate-200 dark:border-[#24314d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Welcome to Trill Face Rec
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-[#8b98b5]">
            Step {step} of 2
          </span>
        </header>

        <div className="p-6 space-y-4">
          {step === 1 ? (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Hi <strong>{displayName}</strong>! Trill Face Rec runs 128-d face recognition
                directly on your device using TensorFlow.js and syncs your gallery for offline use.
              </p>
              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5]">
                  Choose default detector mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDetector('tiny')}
                    className={`p-3.5 rounded-xl border text-left transition-colors ${
                      detector === 'tiny'
                        ? 'border-sky-400 bg-sky-500/10'
                        : 'border-slate-200 dark:border-[#24314d]'
                    }`}
                  >
                    <strong className="text-sm font-bold text-slate-900 dark:text-slate-100 block">
                      Fast (Tiny)
                    </strong>
                    <span className="text-xs text-slate-500 dark:text-[#8b98b5]">
                      High FPS for live camera tracking on phones and laptops.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetector('ssd')}
                    className={`p-3.5 rounded-xl border text-left transition-colors ${
                      detector === 'ssd'
                        ? 'border-sky-400 bg-sky-500/10'
                        : 'border-slate-200 dark:border-[#24314d]'
                    }`}
                  >
                    <strong className="text-sm font-bold text-slate-900 dark:text-slate-100 block">
                      Accurate (SSD)
                    </strong>
                    <span className="text-xs text-slate-500 dark:text-[#8b98b5]">
                      SSD MobileNet v1 for smaller or angled faces.
                    </span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-1">
                  Match Distance Threshold ({threshold.toFixed(2)})
                </label>
                <input
                  type="range"
                  min="0.35"
                  max="0.65"
                  step="0.01"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-sky-400"
                />
                <p className="text-xs text-slate-500 dark:text-[#8b98b5] mt-1">
                  0.50 is balanced. Lower values require stricter facial similarity.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-2">
                  Interface Theme
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`p-3 rounded-xl border text-sm font-semibold ${
                      theme === 'dark'
                        ? 'border-sky-400 bg-sky-500/10 text-sky-400'
                        : 'border-slate-200 dark:border-[#24314d] text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Dark Studio (Default)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`p-3 rounded-xl border text-sm font-semibold ${
                      theme === 'light'
                        ? 'border-sky-400 bg-sky-500/10 text-sky-500'
                        : 'border-slate-200 dark:border-[#24314d] text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    Daylight High-Contrast
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-slate-200 dark:border-[#24314d] flex items-center justify-between">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            Skip setup
          </button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Back
              </button>
            )}
            {step === 1 ? (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2 rounded-xl bg-sky-400 text-slate-950 text-xs font-bold"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onComplete({ detector, threshold, theme })}
                className="px-4 py-2 rounded-xl bg-sky-400 text-slate-950 text-xs font-bold"
              >
                Finish & Launch
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
