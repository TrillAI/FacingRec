import React, { useState, useEffect } from 'react';
import { dvrManager, DvrIncidentMarker } from './dvr';
import { playDvrClick } from './audio';
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  Radio,
  Download,
  AlertTriangle,
  UserCheck,
  HelpCircle,
  Clock,
  Film,
} from 'lucide-react';

interface DvrTimelineProps {
  markers: DvrIncidentMarker[];
  isLive: boolean;
  onToggleLive: () => void;
  onMarkerClick?: (marker: DvrIncidentMarker) => void;
}

export const DvrTimelineBar: React.FC<DvrTimelineProps> = ({
  markers,
  isLive,
  onToggleLive,
  onMarkerClick,
}) => {
  const [bufferSec, setBufferSec] = useState(dvrManager.bufferDurationSec);
  const [scrubPositionSec, setScrubPositionSec] = useState(0); // 0 = live, -15 = 15s ago
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setBufferSec(dvrManager.bufferDurationSec);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRewind10 = () => {
    playDvrClick();
    const next = Math.max(-60, scrubPositionSec - 10);
    setScrubPositionSec(next);
    if (isLive) onToggleLive();
  };

  const handleForward10 = () => {
    playDvrClick();
    const next = Math.min(0, scrubPositionSec + 10);
    setScrubPositionSec(next);
    if (next === 0 && !isLive) {
      onToggleLive();
    }
  };

  const handleJumpToLive = () => {
    playDvrClick();
    setScrubPositionSec(0);
    if (!isLive) onToggleLive();
  };

  const handleExportClip = () => {
    setExporting(true);
    playDvrClick();
    dvrManager.exportDvrClip('security-cam01-incident');
    setTimeout(() => setExporting(false), 1200);
  };

  const now = Date.now();
  const maxSpanMs = 60000; // 60s window

  return (
    <div className="w-full bg-[#0a0f1c] border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
      {/* Top Scrubber Legend & Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-300">
            <Film className="w-3.5 h-3.5 text-sky-400" />
            <span>DVR BUFFER: {bufferSec}s / 60s</span>
          </span>
          {isLive ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE BROADCAST</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-500/40 text-amber-300 font-bold">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>DVR PLAYBACK ({scrubPositionSec}s)</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Unknown Intruder
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Recognized VIP
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Possible
          </span>
        </div>
      </div>

      {/* Interactive 60-second Timeline Scrubber Bar with Incident Ticks */}
      <div className="relative w-full h-8 bg-[#040711] rounded-xl border border-slate-800 overflow-hidden cursor-pointer select-none">
        {/* Background second marks */}
        <div className="absolute inset-0 flex justify-between px-2 items-center pointer-events-none opacity-25">
          {[-60, -50, -40, -30, -20, -10, 0].map((t) => (
            <span key={t} className="text-[10px] font-mono text-slate-400">
              {t === 0 ? 'NOW' : `${t}s`}
            </span>
          ))}
        </div>

        {/* Incident Marker Pins */}
        {markers.map((m) => {
          const deltaMs = now - m.timestamp;
          if (deltaMs > maxSpanMs) return null;
          const leftPercent = Math.max(0, Math.min(100, 100 - (deltaMs / maxSpanMs) * 100));

          const colorClass =
            m.type === 'intruder'
              ? 'bg-rose-500 shadow-rose-500/80'
              : m.type === 'recognized'
              ? 'bg-emerald-400 shadow-emerald-400/80'
              : 'bg-amber-400 shadow-amber-400/80';

          return (
            <button
              key={m.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playDvrClick();
                if (onMarkerClick) onMarkerClick(m);
              }}
              title={`[${m.type.toUpperCase()}] ${m.label} at -${Math.round(deltaMs / 1000)}s`}
              style={{ left: `${leftPercent}%` }}
              className={`absolute top-0 bottom-0 w-2.5 -translate-x-1/2 flex items-center justify-center transition-transform hover:scale-150 z-20 group`}
            >
              <span className={`w-1.5 h-6 rounded-full ${colorClass} shadow-md`} />
              {/* Tooltip */}
              <div className="absolute bottom-9 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-30">
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-[11px] whitespace-nowrap shadow-xl">
                  <div className="font-bold flex items-center gap-1">
                    {m.type === 'intruder' && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                    {m.type === 'recognized' && <UserCheck className="w-3 h-3 text-emerald-400" />}
                    {m.type === 'possible' && <HelpCircle className="w-3 h-3 text-amber-400" />}
                    <span>{m.label}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">-{Math.round(deltaMs / 1000)}s ago</span>
                </div>
              </div>
            </button>
          );
        })}

        {/* Playhead indicator */}
        <div
          style={{
            left: `${Math.max(0, Math.min(100, 100 + (scrubPositionSec / 60) * 100))}%`,
          }}
          className="absolute top-0 bottom-0 w-1 bg-sky-400 shadow-[0_0_12px_#38bdf8] -translate-x-1/2 z-10 pointer-events-none"
        >
          <div className="w-3 h-3 rounded-full bg-sky-400 -translate-x-1 -translate-y-1 shadow-lg" />
        </div>
      </div>

      {/* DVR Transport Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRewind10}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
            title="Rewind 10 seconds in DVR buffer"
          >
            <Rewind className="w-3.5 h-3.5 text-sky-400" />
            <span>-10s</span>
          </button>

          <button
            type="button"
            onClick={handleForward10}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
            title="Fast forward 10 seconds"
          >
            <FastForward className="w-3.5 h-3.5 text-sky-400" />
            <span>+10s</span>
          </button>

          <button
            type="button"
            onClick={handleJumpToLive}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              isLive
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : 'bg-sky-400 hover:bg-sky-300 text-slate-950 shadow-md shadow-sky-500/20'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>JUMP TO LIVE</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleExportClip}
          disabled={exporting || bufferSec < 2}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-xs font-bold text-indigo-300 transition-colors disabled:opacity-50 cursor-pointer"
          title="Download the rolling 60-second video buffer as a WebM incident clip"
        >
          <Download className="w-3.5 h-3.5 text-indigo-400" />
          <span>{exporting ? 'Exporting Clip…' : 'Save 60s DVR Clip'}</span>
        </button>
      </div>
    </div>
  );
};
