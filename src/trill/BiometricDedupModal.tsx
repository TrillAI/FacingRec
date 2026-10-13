import React, { useState } from 'react';
import { api, TrillPerson, notifyGalleryChanged } from './engine';
import { showToast } from './TrillViews';
import {
  Scissors,
  CheckCircle2,
  X,
  Sparkles,
  Layers,
  ShieldCheck,
  RefreshCw,
  Sliders,
} from 'lucide-react';

interface BiometricDedupModalProps {
  open: boolean;
  people: TrillPerson[];
  onClose: () => void;
  onCompleted?: () => void;
}

export const BiometricDedupModal: React.FC<BiometricDedupModalProps> = ({
  open,
  people,
  onClose,
  onCompleted,
}) => {
  const [selectedPersonId, setSelectedPersonId] = useState<string>('all');
  const [threshold, setThreshold] = useState<number>(0.25);
  const [purgeIntruders, setPurgeIntruders] = useState<boolean>(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    prunedCount: number;
    peopleOptimized: number;
    purgedIntruders: number;
    remainingFaces: number;
  } | null>(null);

  if (!open) return null;

  const handleRunDedup = async () => {
    setRunning(true);
    setResult(null);
    try {
      const payload = {
        personId: selectedPersonId === 'all' ? undefined : Number(selectedPersonId),
        threshold,
        purgeSimilarIntruders: purgeIntruders,
      };

      const res = await api.dedup(payload);
      setResult({
        prunedCount: res.prunedCount,
        peopleOptimized: res.peopleOptimized,
        purgedIntruders: res.purgedIntruders,
        remainingFaces: res.remainingFaces,
      });

      notifyGalleryChanged();
      if (onCompleted) onCompleted();
      showToast(
        `Optimization complete: ${res.prunedCount} redundant sample(s) pruned.`,
        'success'
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Deduplication failed', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Biometric Duplicate Pruner & Sample Optimizer"
        className="w-full max-w-lg rounded-3xl bg-[#0c1220] border border-slate-800 shadow-2xl overflow-hidden text-slate-100 p-6 space-y-5"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/20 border border-sky-500/30 text-sky-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Biometric Duplicate Face Pruner</h2>
              <p className="text-xs text-slate-400">
                Removes redundant, near-identical face embeddings for registered people.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Target Person */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Target Scope
            </label>
            <select
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
            >
              <option value="all">Entire Gallery ({people.length} enrolled people)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.faceCount || 0} samples)
                </option>
              ))}
            </select>
          </div>

          {/* Redundancy Sensitivity Threshold */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-slate-300">
                Redundancy Distance Cutoff ({threshold.toFixed(2)})
              </label>
              <span className="font-mono text-sky-400 font-bold">
                {threshold < 0.22 ? 'Aggressive (Keep very distinct only)' : threshold < 0.28 ? 'Balanced (Recommended)' : 'Conservative'}
              </span>
            </div>
            <input
              type="range"
              min="0.15"
              max="0.38"
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full accent-sky-400 cursor-pointer"
            />
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Samples with Euclidean distance below this cutoff are considered duplicates of the same pose/expression and will be safely pruned.
            </p>
          </div>

          {/* Purge matching unknown intruder captures */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
            <div>
              <strong className="block text-xs text-slate-200 font-semibold">
                Purge Matching Unknown Intruders
              </strong>
              <span className="text-[11px] text-slate-400 block">
                If an auto-snapped intruder matches an enrolled person, remove that intruder snap.
              </span>
            </div>
            <input
              type="checkbox"
              checked={purgeIntruders}
              onChange={(e) => setPurgeIntruders(e.target.checked)}
              className="w-5 h-5 accent-sky-400 rounded cursor-pointer"
            />
          </label>

          {/* Result Card */}
          {result && (
            <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Optimization Completed Successfully!</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-lg bg-emerald-900/30 border border-emerald-500/20">
                  <span className="text-emerald-400 block text-lg font-bold">{result.prunedCount}</span>
                  <span className="text-[11px] text-emerald-300">Redundant Samples Pruned</span>
                </div>
                <div className="p-2 rounded-lg bg-emerald-900/30 border border-emerald-500/20">
                  <span className="text-emerald-400 block text-lg font-bold">{result.peopleOptimized}</span>
                  <span className="text-[11px] text-emerald-300">Profiles Streamlined</span>
                </div>
                <div className="p-2 rounded-lg bg-emerald-900/30 border border-emerald-500/20">
                  <span className="text-emerald-400 block text-lg font-bold">{result.purgedIntruders}</span>
                  <span className="text-[11px] text-emerald-300">Intruder Snaps Cleared</span>
                </div>
                <div className="p-2 rounded-lg bg-emerald-900/30 border border-emerald-500/20">
                  <span className="text-emerald-400 block text-lg font-bold">{result.remainingFaces}</span>
                  <span className="text-[11px] text-emerald-300">Remaining Clean Samples</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleRunDedup}
            disabled={running}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-sky-400 hover:bg-sky-300 text-slate-950 shadow-lg shadow-sky-500/20 disabled:opacity-50 cursor-pointer"
          >
            {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
            <span>{running ? 'Optimizing Biometrics…' : 'Run Deduplication & Clean'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
