import React, { useState, useEffect } from 'react';
import { api, TrillIntruderSnapshot, TrillPerson, fmtDate } from './engine';
import { showToast } from './TrillViews';
import {
  ShieldAlert,
  UserPlus,
  Trash2,
  X,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FolderPlus,
} from 'lucide-react';

interface IntruderQuarantineModalProps {
  open: boolean;
  onClose: () => void;
  onEnrolled?: () => void;
}

export const IntruderQuarantineModal: React.FC<IntruderQuarantineModalProps> = ({
  open,
  onClose,
  onEnrolled,
}) => {
  const [intruders, setIntruders] = useState<TrillIntruderSnapshot[]>([]);
  const [people, setPeople] = useState<TrillPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIntruder, setSelectedIntruder] = useState<TrillIntruderSnapshot | null>(null);
  const [enrollMode, setEnrollMode] = useState<'new' | 'existing'>('new');
  const [newName, setNewName] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [list, pList] = await Promise.all([api.intruders(100), api.people()]);
      setIntruders(list);
      setPeople(pList);
      if (pList.length > 0) {
        setSelectedPersonId(String(pList[0].id));
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load intruder snaps', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  const handleDelete = async (id: number) => {
    try {
      await api.deleteIntruder(id);
      setIntruders((prev) => prev.filter((i) => i.id !== id));
      showToast('Intruder snapshot removed', 'info');
    } catch (e) {
      showToast('Could not delete snapshot', 'error');
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Clear all auto-snapped unknown intruder snapshots?')) return;
    try {
      await api.clearIntruders();
      setIntruders([]);
      showToast('All intruder snapshots cleared', 'success');
    } catch {
      showToast('Could not clear intruder snaps', 'error');
    }
  };

  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntruder) return;
    setSubmitting(true);
    try {
      const payload =
        enrollMode === 'new'
          ? { name: newName.trim() }
          : { personId: Number(selectedPersonId) };

      const res = await api.enrollIntruder(selectedIntruder.id, payload);
      showToast(
        `Registered successfully! ${res.prunedSimilarIntruders ? `Pruned ${res.prunedSimilarIntruders} similar unknown intruder duplicate(s).` : ''}`,
        'success'
      );
      setSelectedIntruder(null);
      setNewName('');
      await loadData();
      if (onEnrolled) onEnrolled();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Registration failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

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
        aria-label="Intruder Quarantine & Unknown Snapshots"
        className="w-full max-w-4xl max-h-[90vh] rounded-3xl bg-[#0c1220] border border-slate-800 shadow-2xl flex flex-col overflow-hidden text-slate-100"
      >
        {/* Header */}
        <header className="px-6 py-4.5 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                Unknown Intruder Quarantine & Evidence Snaps
                <span className="px-2 py-0.5 rounded-full text-xs bg-rose-500/20 text-rose-400 font-mono font-bold">
                  {intruders.length} captured
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Automatic photos snapped when unknown faces appeared on camera. Enroll them to register their identity, or dismiss.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {intruders.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-semibold text-rose-300 transition-colors cursor-pointer"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Body content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <span>Loading intruder snaps…</span>
            </div>
          ) : intruders.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto opacity-75" />
              <strong className="block text-base font-bold text-slate-200">
                No unknown intruders in quarantine
              </strong>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                When an unknown or unregistered face enters the camera frame, a forensic evidence photo will automatically be snapped and archived here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {intruders.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl bg-slate-900 border border-slate-800 p-3 flex flex-col gap-2.5 hover:border-slate-700 transition-all shadow-md"
                >
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-black border border-slate-800">
                    {item.thumbUrl ? (
                      <img
                        src={`/api/${item.thumbUrl}`}
                        alt="Unknown intruder snapshot"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        No image
                      </div>
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-xs text-[10px] font-mono text-rose-400 border border-rose-500/30">
                      Auto-Snapped
                    </span>
                  </div>

                  <div className="space-y-0.5 text-xs">
                    <strong className="block text-slate-200 font-semibold truncate">
                      {item.label}
                    </strong>
                    <span className="text-[11px] text-slate-400 block truncate">
                      {fmtDate(item.createdAt)}
                    </span>
                    {item.note && (
                      <span className="text-[10px] text-slate-500 block truncate font-mono">
                        {item.note}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 pt-1 mt-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIntruder(item);
                        setNewName('');
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Enroll…</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Dismiss intruder snapshot"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Enrollment Sub-Dialog */}
        {selectedIntruder && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
            <div className="w-full max-w-md rounded-2xl bg-[#0f172a] border border-slate-700 shadow-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-sky-400" />
                  Enroll Unknown Intruder Snapshot
                </h3>
                <button
                  type="button"
                  onClick={() => setSelectedIntruder(null)}
                  className="p-1 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleEnrollSubmit} className="space-y-4">
                {/* Mode toggle */}
                <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => setEnrollMode('new')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      enrollMode === 'new'
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        : 'text-slate-400'
                    }`}
                  >
                    New Person
                  </button>
                  <button
                    type="button"
                    onClick={() => setEnrollMode('existing')}
                    disabled={people.length === 0}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                      enrollMode === 'existing'
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                        : 'text-slate-400'
                    }`}
                  >
                    Existing Person ({people.length})
                  </button>
                </div>

                {enrollMode === 'new' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      Select Registered Person
                    </label>
                    <select
                      value={selectedPersonId}
                      onChange={(e) => setSelectedPersonId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
                    >
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.faceCount || 0} samples)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-500/20 text-xs text-sky-300 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span>
                    Enrolling will automatically remove other redundant unknown intruder captures of this person from the quarantine archive!
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSelectedIntruder(null)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-400 hover:bg-sky-300 text-slate-950 disabled:opacity-50"
                  >
                    {submitting ? 'Registering…' : 'Save & Prune Duplicates'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
