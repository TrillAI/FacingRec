import React, { useState } from 'react';
import {
  ShieldAlert,
  UserCheck,
  HelpCircle,
  Eye,
  Camera,
  Volume2,
  Moon,
  Trash2,
  Copy,
  Check,
  Pause,
  Play,
  Terminal,
} from 'lucide-react';

export interface ForensicTelemetryLog {
  id: string;
  timestamp: number;
  timeStr: string;
  channel: string;
  type: 'intruder' | 'recognized' | 'possible' | 'system';
  headline: string;
  subjectName?: string;
  spatialDetails: string;
  biometricMetrics: string;
  lightingAndOptics: string;
  actionsDispatched: string[];
}

interface ForensicTelemetryFeedProps {
  logs: ForensicTelemetryLog[];
  onClear: () => void;
}

export const ForensicTelemetryFeed: React.FC<ForensicTelemetryFeedProps> = ({
  logs,
  onClear,
}) => {
  const [filter, setFilter] = useState<'all' | 'intruder' | 'recognized'>('all');
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);

  const filteredLogs = logs.filter((l) => {
    if (filter === 'intruder') return l.type === 'intruder';
    if (filter === 'recognized') return l.type === 'recognized';
    return true;
  });

  const handleCopyLogs = () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${l.timeStr}] [${l.channel}] [${l.headline.toUpperCase()}]\n` +
          `  - Spatial: ${l.spatialDetails}\n` +
          `  - Biometrics: ${l.biometricMetrics}\n` +
          `  - Scene: ${l.lightingAndOptics}\n` +
          `  - Actions: ${l.actionsDispatched.join('; ')}`
      )
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full rounded-2xl bg-[#090d19] border border-slate-800 shadow-2xl overflow-hidden flex flex-col">
      {/* Feed Header */}
      <div className="p-4 bg-[#0d1424] border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-sky-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Forensic Scene Telemetry & Situation Awareness
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </h3>
            <p className="text-[11px] text-slate-400">
              Real-time deep forensic narrative describing every seen subject, spatial coordinate, optical sensor action, and dispatch.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="inline-flex p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
            {(
              [
                { id: 'all', label: 'All Telemetry' },
                { id: 'intruder', label: 'Intruders Only' },
                { id: 'recognized', label: 'VIP Matches' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilter(btn.id)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                  filter === btn.id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPaused(!paused)}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs cursor-pointer"
            title={paused ? 'Resume stream' : 'Pause stream'}
          >
            {paused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-amber-400" />}
          </button>

          <button
            type="button"
            onClick={handleCopyLogs}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs cursor-pointer"
            title="Copy technical logs to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={onClear}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 text-slate-400 hover:text-rose-400 text-xs cursor-pointer"
            title="Clear stream"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrolling Telemetry Log Stream */}
      <div className="p-4 space-y-3 max-h-96 overflow-y-auto font-mono text-xs divide-y divide-slate-800/60">
        {filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-slate-500 space-y-1">
            <Eye className="w-6 h-6 mx-auto text-slate-600 mb-2" />
            <p className="font-sans text-sm font-medium">Telemetry feed listening for active tracks…</p>
            <p className="text-[11px] font-mono">Face movements, auto-snaps, and biometric verifications will stream here in real time.</p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="pt-3 first:pt-0 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-bold">
                    {log.timeStr}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-500/30 text-sky-400">
                    {log.channel}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      log.type === 'intruder'
                        ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        : log.type === 'recognized'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {log.type === 'intruder' && <ShieldAlert className="w-3 h-3" />}
                    {log.type === 'recognized' && <UserCheck className="w-3 h-3" />}
                    {log.type === 'possible' && <HelpCircle className="w-3 h-3" />}
                    <span>{log.headline}</span>
                  </span>
                </div>
              </div>

              {/* Technical breakdown grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-[#070b14] p-2.5 rounded-xl border border-slate-800/80 leading-relaxed text-slate-300">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-semibold">
                    1. Spatial & Kinematics
                  </span>
                  <span>{log.spatialDetails}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-semibold">
                    2. Biometric Metric Analysis
                  </span>
                  <span>{log.biometricMetrics}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-semibold">
                    3. Scene Optics & Night Vision
                  </span>
                  <span>{log.lightingAndOptics}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-semibold">
                    4. Security Actions Dispatched
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-sky-300">
                    {log.actionsDispatched.map((act, i) => (
                      <li key={i}>{act}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
