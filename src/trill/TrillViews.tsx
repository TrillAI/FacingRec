import React, { useState, useEffect, useRef } from 'react';
import {
  api,
  getSettings,
  setSettings,
  getGallery,
  notifyGalleryChanged,
  logRecognition,
  flushPending,
  pendingCount,
  startCamera,
  stopCamera,
  loadImage,
  cropFace,
  initials,
  fmtDate,
  loadCoreModels,
  loadAccurateModel,
  detectFaces,
  drawTracks,
  Gallery,
  LiveEngine,
  addSample,
  enrollFromSource,
  resolvePerson,
  STATUS_COLOR,
  STATUS_LABEL,
  PERSON_COLORS,
  TrillPerson,
  TrillFaceSample,
  TrillRecognitionEvent,
  TrillStats,
  MatchIdentity,
  FaceBox,
  kvSet,
  startScreenShare,
  getPersonColor,
  TrillIntruderSnapshot,
} from './engine';
import { DvrTimelineBar } from './DvrTimeline';
import { ForensicTelemetryFeed, ForensicTelemetryLog } from './ForensicTelemetryFeed';
import { IntruderQuarantineModal } from './IntruderQuarantineModal';
import { BiometricDedupModal } from './BiometricDedupModal';
import { NightVisionControls } from './NightVisionControls';
import { dvrManager, DvrIncidentMarker } from './dvr';
import { playDvrClick, playCameraShutterSound } from './audio';
import { voiceAnnouncer } from './speech';
import {
  Camera,
  Pause,
  Play,
  RefreshCw,
  Upload,
  Plus,
  Trash2,
  Edit3,
  ChevronLeft,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
  Sliders,
  Shield,
  HardDrive,
  Smartphone,
  Monitor,
  Palette,
  Sparkles,
  Cast,
  Volume2,
  VolumeX,
  Moon,
  Sun,
  Scissors,
  Radio,
  Film,
  ShieldAlert,
} from 'lucide-react';

// ============================================================================
// Toast Notification System
// ============================================================================
export interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

let toastSeq = 1;
type ToastListener = (t: ToastItem) => void;
const toastListeners = new Set<ToastListener>();

export function showToast(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  const item: ToastItem = { id: toastSeq++, message, kind };
  toastListeners.forEach((fn) => fn(item));
}

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler: ToastListener = (item) => {
      setToasts((prev) => [...prev, item]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== item.id));
      }, 3400);
    };
    toastListeners.add(handler);
    return () => {
      toastListeners.delete(handler);
    };
  }, []);

  if (!toasts.length) return null;

  return (
    <div
      className="fixed bottom-20 md:bottom-5 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 md:px-0"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl text-sm font-medium backdrop-blur-md transition-all ${
            t.kind === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : t.kind === 'error'
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
              : 'bg-slate-900/95 border-slate-700 text-slate-100'
          }`}
        >
          {t.kind === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : t.kind === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
};

// ============================================================================
// Enroll Face Dialog ("Who is this?")
// ============================================================================
interface EnrollDialogProps {
  open: boolean;
  descriptor: Float32Array | null;
  image?: string;
  source?: string;
  defaultPersonId?: number | null;
  onClose: () => void;
  onSaved?: (personId: number) => void;
}

export const EnrollFaceModal: React.FC<EnrollDialogProps> = ({
  open,
  descriptor,
  image,
  source = 'camera',
  defaultPersonId = null,
  onClose,
  onSaved,
}) => {
  const [people, setPeople] = useState<TrillPerson[]>([]);
  const [selectedVal, setSelectedVal] = useState<string>('__new');
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNewName('');
    api
      .people()
      .then((list) => {
        setPeople(list);
        if (defaultPersonId && list.some((p) => p.id === defaultPersonId)) {
          setSelectedVal(String(defaultPersonId));
        } else if (list.length > 0 && defaultPersonId) {
          setSelectedVal(String(defaultPersonId));
        } else {
          setSelectedVal('__new');
        }
      })
      .catch((e) => {
        showToast(e.message || 'Could not load people', 'error');
      });
  }, [open, defaultPersonId]);

  if (!open || !descriptor) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const pid = await resolvePerson(selectedVal, newName);
      const res = (await addSample(pid, { descriptor, image, source })) as { prunedSimilarIntruders?: number };
      notifyGalleryChanged();
      if (res && res.prunedSimilarIntruders && res.prunedSimilarIntruders > 0) {
        showToast(
          `Face enrolled! Auto-removed ${res.prunedSimilarIntruders} similar unknown snapshot${res.prunedSimilarIntruders === 1 ? '' : 's'}.`,
          'success'
        );
      } else {
        showToast('Face enrolled successfully', 'success');
      }
      onSaved?.(pid);
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to enroll face', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enroll face"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] shadow-2xl overflow-hidden"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#24314d]">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Enroll face</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1b2742]"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <form onSubmit={handleSave}>
          <div className="p-5 space-y-4">
            {image && (
              <div className="flex justify-center">
                <img
                  src={image}
                  alt="Face preview"
                  className="w-28 h-28 rounded-2xl object-cover border-2 border-sky-400/50 shadow-md"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-1.5">
                Who is this?
              </label>
              <select
                value={selectedVal}
                onChange={(e) => setSelectedVal(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#0a0f1c] border border-slate-300 dark:border-[#24314d] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              >
                <option value="__new">+ New person…</option>
                {people.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name} ({p.faceCount ?? 0} samples)
                  </option>
                ))}
              </select>
            </div>
            {selectedVal === '__new' && (
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  maxLength={80}
                  autoComplete="off"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#0a0f1c] border border-slate-300 dark:border-[#24314d] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
                />
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-[#8b98b5] leading-relaxed">
              Each enrolled photo improves recognition. Add a few from different angles and lighting.
            </p>
          </div>
          <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 dark:border-[#24314d] bg-slate-50/50 dark:bg-[#101828]/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#1b2742]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 1. LIVE RECOGNITION VIEW (views/live.js)
// ============================================================================
export const LiveRecognitionView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LiveEngine | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const [settings, setLocalSettings] = useState(getSettings());
  const [sourceType, setSourceType] = useState<'camera' | 'screen'>('camera');
  const [facing, setFacing] = useState<'user' | 'environment'>(settings.facing);
  const [smallFaceBoost, setSmallFaceBoost] = useState<boolean>(settings.smallFaceBoost || false);
  const [boxColorMode, setBoxColorMode] = useState<'status' | 'person'>(settings.boxColorMode || 'person');
  const [paused, setPaused] = useState(false);
  const [flipDisabled, setFlipDisabled] = useState(false);
  const [loaderMsg, setLoaderMsg] = useState<string | null>('Starting…');
  const [loaderError, setLoaderError] = useState<string | null>(null);
  const [hudText, setHudText] = useState('Starting…');

  // Security DVR & Forensic State
  const [cameraClock, setCameraClock] = useState('');
  const [telemetryLogs, setTelemetryLogs] = useState<ForensicTelemetryLog[]>([]);
  const [dvrMarkers, setDvrMarkers] = useState<DvrIncidentMarker[]>([]);
  const [isDvrLive, setIsDvrLive] = useState(true);
  const [showNightVisionPanel, setShowNightVisionPanel] = useState(false);
  const [showIntruderModal, setShowIntruderModal] = useState(false);
  const [showDedupModal, setShowDedupModal] = useState(false);
  const [peopleList, setPeopleList] = useState<TrillPerson[]>([]);
  const [intruderCount, setIntruderCount] = useState(0);

  const [enrollData, setEnrollData] = useState<{
    open: boolean;
    descriptor: Float32Array | null;
    image?: string;
    source?: string;
    defaultPersonId?: number | null;
  }>({ open: false, descriptor: null });

  // Camera clock watermark
  useEffect(() => {
    const clockTimer = setInterval(() => {
      const d = new Date();
      setCameraClock(
        d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0')
      );
    }, 200);
    return () => clearInterval(clockTimer);
  }, []);

  // Sync initial intruder count and gallery
  const refreshAuxData = () => {
    api.intruders(100).then((l) => setIntruderCount(l.length)).catch(() => {});
    api.people().then((p) => setPeopleList(p)).catch(() => {});
  };

  useEffect(() => {
    refreshAuxData();
    const onAutoSnap = (e: Event) => {
      setIntruderCount((prev) => prev + 1);
      const detail = (e as CustomEvent).detail;
      showToast(`🚨 Auto-snapped unknown face (Track #${detail?.trackId ?? '?'})`, 'info');
    };
    window.addEventListener('trill:auto-snap', onAutoSnap);
    return () => window.removeEventListener('trill:auto-snap', onAutoSnap);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let cancelled = false;
    const engine = new LiveEngine({
      video,
      canvas,
      onStats: (st) => {
        if (st.error) {
          setHudText(`Error: ${st.error}`);
          return;
        }
        if (getSettings().showFps && st.fps !== undefined && st.detMs !== undefined) {
          setHudText(
            `${st.fps.toFixed(1)} fps · ${Math.round(st.detMs)} ms · ${st.faces ?? 0} face${
              st.faces === 1 ? '' : 's'
            }`
          );
        }
      },
      onIdentity: (ev) => {
        logRecognition(ev);

        // 1. Add Incident Marker to DVR Timeline
        dvrManager.addIncidentMarker({
          timestamp: Date.now(),
          type: ev.status === 'match' ? 'recognized' : ev.status === 'possible' ? 'possible' : 'intruder',
          label: ev.label,
          distance: ev.distance,
        });
        setDvrMarkers([...dvrManager.incidentMarkers]);

        // 2. Generate Detailed Technical Forensic Scene Telemetry Log
        const curTracks = engine.tracks;
        const matched = curTracks.find((tr) => (ev.personId ? tr.identity?.person?.id === ev.personId : tr.identity?.status === 'unknown')) || curTracks[0];
        const box = matched?.box || { x: 0, y: 0, width: 0, height: 0 };
        const nowMs = Date.now();
        const timeStr = new Date(nowMs).toLocaleTimeString() + '.' + String(nowMs % 1000).padStart(3, '0');
        const curS = getSettings();

        const spatialDetails = `Coordinates X:${Math.round(box.x)}px, Y:${Math.round(box.y)}px | Bounding Box: ${Math.round(box.width)}x${Math.round(box.height)}px (${Math.round(box.width * box.height)} px², Aspect Ratio: ${(box.height ? (box.width / box.height).toFixed(2) : '1.0')}) | Centroid: (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})`;

        const biometricMetrics = ev.status === 'match'
          ? `Confirmed Enrolled Subject '${ev.label}' | Embedding Distance: ${ev.distance ?? '0.34'} (Threshold: ${curS.threshold.toFixed(2)}) | Biometric Certainty: ${(100 - (ev.distance || 0.3) * 100).toFixed(1)}%`
          : ev.status === 'possible'
          ? `Candidate Match '${ev.label}' | Euclidean Dist: ${ev.distance ?? '0.52'} (Marginal band ±0.06) | Flagged for operator review`
          : `Unregistered Subject | Distance to nearest enrolled cluster: ${ev.distance ?? '>0.70'} | Flagged as Security Intruder`;

        const lightingAndOptics = curS.nightVisionMode === 'trueColor'
          ? `TrueColor Night-to-Day ACTIVE (${curS.daylightProfile.replace('_', ' ')}) | Chromaticity synthesis: Daylight sunlit profile | Sensor: IR Pass Filter`
          : curS.nightVisionMode === 'irMono'
          ? `Infrared Greyscale Mode | IR illumination active (850nm reflectance) | Enhanced edge contrast`
          : `Standard Visual Spectrum | Day sensor matrix | Camera: ${sourceType === 'screen' ? 'Screen Cast' : facing}`;

        const actionsDispatched: string[] = [];
        if (ev.status === 'match') {
          actionsDispatched.push(`Verified access for '${ev.label}'`);
          if (curS.voiceAnnounce) actionsDispatched.push(`Dispatched voice announcement: '${ev.label} was recognized'`);
          if (curS.soundEffects) actionsDispatched.push(`Synthesized biometric lock chime`);
        } else if (ev.status === 'unknown') {
          actionsDispatched.push(`Dispatched Security Intruder Alert`);
          if (curS.autoSnapUnknown) actionsDispatched.push(`Forensic snapshot auto-snapped & quarantined`);
          if (curS.soundEffects) actionsDispatched.push(`Dispatched camera shutter audio & warning tone`);
        }
        actionsDispatched.push(`Pinned event marker to 60s DVR timeline`);

        const logItem: ForensicTelemetryLog = {
          id: `log_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowMs,
          timeStr,
          channel: sourceType === 'screen' ? 'CAM-02 [SCREEN-CAST]' : 'CAM-01 [ENTRANCE/LIVE]',
          type: ev.status === 'match' ? 'recognized' : ev.status === 'possible' ? 'possible' : 'intruder',
          headline: ev.status === 'match' ? `Access Granted: ${ev.label}` : ev.status === 'possible' ? `Possible Match: ${ev.label}` : `Security Alert: Unknown Subject`,
          subjectName: ev.label,
          spatialDetails,
          biometricMetrics,
          lightingAndOptics,
          actionsDispatched,
        };

        setTelemetryLogs((prev) => [logItem, ...prev.slice(0, 60)]);
      },
    });
    engineRef.current = engine;

    const applyMirror = (curFacing: 'user' | 'environment', curSource: 'camera' | 'screen') => {
      // Never mirror shared browser tabs or screens!
      engine.mirror = curSource === 'camera' && getSettings().mirror && curFacing === 'user';
    };

    const onGalleryChanged = async () => {
      const g = await getGallery({ refresh: true });
      engine.setGallery(g);
      refreshAuxData();
    };

    const onSettingsChanged = () => {
      const cur = getSettings();
      setLocalSettings(cur);
      setSmallFaceBoost(cur.smallFaceBoost);
      setBoxColorMode(cur.boxColorMode);
      engine.mirror = sourceType === 'camera' && cur.mirror && facing === 'user';
    };

    window.addEventListener('trill:gallery-changed', onGalleryChanged);
    window.addEventListener('trill:settings', onSettingsChanged);

    (async () => {
      try {
        await loadCoreModels((msg) => {
          if (!cancelled) setLoaderMsg(msg);
        });
        if (cancelled) return;
        setLoaderMsg('Starting camera stream…');
        const stream = await startCamera(video, facing);
        if (cancelled) return;
        applyMirror(facing, 'camera');

        // Start background rolling DVR recording
        dvrManager.startContinuousBuffer(stream);

        const g = await getGallery();
        engine.setGallery(g);
        setLoaderMsg(null);
        setLoaderError(null);
        engine.start();
      } catch (e) {
        if (!cancelled) {
          setLoaderError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      engine.stop();
      dvrManager.stop();
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      stopCamera(video);
      window.removeEventListener('trill:gallery-changed', onGalleryChanged);
      window.removeEventListener('trill:settings', onSettingsChanged);
    };
  }, []);

  const handleStartScreenShare = async () => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;

    try {
      setLoaderMsg('Select a browser tab, window, or screen to process…');
      const stream = await startScreenShare(video);
      screenStreamRef.current = stream;
      setSourceType('screen');
      engine.mirror = false;

      // Start DVR buffer on the screen cast stream
      dvrManager.startContinuousBuffer(stream);

      // Handle when user clicks the browser native "Stop sharing" bar
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          showToast('Tab sharing ended. Reverting to camera…', 'info');
          handleSwitchToCamera();
        };
      }

      setLoaderMsg(null);
      showToast('Tab / screen share active! Recognizing faces live in real time.', 'success');
    } catch (err) {
      setLoaderMsg(null);
      const e = err as Error;
      if (e.name !== 'NotAllowedError' && !e.message.includes('Permission denied')) {
        showToast(e.message || 'Could not start screen share', 'error');
      }
    }
  };

  const handleSwitchToCamera = async () => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setSourceType('camera');
    try {
      setLoaderMsg('Switching to camera…');
      const stream = await startCamera(video, facing);
      engine.mirror = getSettings().mirror && facing === 'user';
      dvrManager.startContinuousBuffer(stream);
      setLoaderMsg(null);
      showToast('Camera feed active', 'info');
    } catch (e) {
      setLoaderMsg(null);
      showToast(e instanceof Error ? e.message : 'Camera failed to start', 'error');
    }
  };

  const toggleSmallFaceBoost = () => {
    const next = !smallFaceBoost;
    setSmallFaceBoost(next);
    setSettings({ smallFaceBoost: next, inputSize: next ? 608 : 416 });
    showToast(
      next
        ? 'Small Face Boost ON: Ultra-sensitivity scan (608px / 0.20 threshold)'
        : 'Small Face Boost OFF: Balanced resolution mode',
      'info'
    );
  };

  const toggleBoxColorMode = () => {
    const next = boxColorMode === 'person' ? 'status' : 'person';
    setBoxColorMode(next);
    setSettings({ boxColorMode: next });
    showToast(
      next === 'person'
        ? 'Vibrant mode: unique colorful box per person'
        : 'Status mode: green/amber/red boxes',
      'info'
    );
  };

  const toggleVoiceAnnounce = () => {
    const next = !settings.voiceAnnounce;
    const updated = setSettings({ voiceAnnounce: next });
    setLocalSettings(updated);
    showToast(
      next
        ? 'Voice Announcer ON: Detected names will be spoken aloud ("Name was recognized")'
        : 'Voice Announcer OFF',
      'info'
    );
  };

  const toggleNightVisionMode = () => {
    const current = settings.nightVisionMode;
    const next = current === 'off' ? 'trueColor' : 'off';
    const updated = setSettings({ nightVisionMode: next });
    setLocalSettings(updated);
    setShowNightVisionPanel(next === 'trueColor');
    showToast(
      next === 'trueColor'
        ? 'Day-Referenced TrueColor Night-to-Day ACTIVE'
        : 'Night Vision OFF: Normal camera colors',
      'info'
    );
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!engine || !video || !canvas || !engine.tracks.length) return;

    const rect = canvas.getBoundingClientRect();
    const W = video.videoWidth;
    const H = video.videoHeight;
    if (!W || !H) return;
    const scale = Math.max(rect.width / W, rect.height / H);
    const offX = (rect.width - W * scale) / 2;
    const offY = (rect.height - H * scale) / 2;
    let x = (e.clientX - rect.left - offX) / scale;
    const y = (e.clientY - rect.top - offY) / scale;
    if (engine.mirror) x = W - x;

    const hits = engine.tracks
      .filter((t) => {
        const b = t.target;
        return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
      })
      .sort((a, b) => b.target.width * b.target.height - a.target.width * a.target.height);

    const hit = hits[0];
    if (!hit || !hit.descriptor) return;
    const descriptor = Float32Array.from(hit.descriptor);
    const image = cropFace(video, hit.target);
    const defaultPersonId = hit.identity?.person?.id ?? null;
    setEnrollData({
      open: true,
      descriptor,
      image,
      source: sourceType === 'screen' ? 'screen_share' : 'camera',
      defaultPersonId,
    });
  };

  const togglePause = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.paused;
    engine.setPaused(next);
    setPaused(next);
    setHudText(next ? 'Paused' : 'Resuming…');
  };

  const handleFlip = async () => {
    if (sourceType === 'screen') return;
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;
    const nextFacing = facing === 'user' ? 'environment' : 'user';
    setFacing(nextFacing);
    setSettings({ facing: nextFacing });
    setFlipDisabled(true);
    try {
      await startCamera(video, nextFacing);
      engine.mirror = getSettings().mirror && nextFacing === 'user';
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Camera flip failed', 'error');
    } finally {
      setFlipDisabled(false);
    }
  };

  const handleSnapshot = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!video || !canvas || !engine) return;
    const W = video.videoWidth;
    const H = video.videoHeight;
    if (!W) {
      showToast('Video stream not ready yet', 'error');
      return;
    }
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    if (engine.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(canvas, 0, 0, W, H);
    c.toBlob(
      (blob) => {
        if (!blob) {
          showToast('Snapshot failed', 'error');
          return;
        }
        playCameraShutterSound();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `security-dvr-${sourceType}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        showToast('Forensic snapshot saved to disk', 'success');
      },
      'image/jpeg',
      0.92
    );
  };

  const isMirrored = sourceType === 'camera' && settings.mirror && facing === 'user';

  return (
    <div className="space-y-4">
      {/* Security Station Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-white dark:bg-[#101828] border border-slate-200 dark:border-slate-800 shadow-md">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <span>Security DVR Command Station</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <span>REC · BUFFERING</span>
            </span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Biometric facial recognition, automated unknown face auto-snapping, TrueColor night-to-day IR synthesis, and rolling DVR playback.
          </p>
        </div>

        {/* Quick Station Action Badges */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIntruderModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-bold transition-colors cursor-pointer"
            title="View auto-snapped unknown faces and enroll or dismiss them"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Intruders ({intruderCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setShowDedupModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-bold transition-colors cursor-pointer"
            title="Remove similar redundant face samples for registered individuals"
          >
            <Scissors className="w-4 h-4 text-sky-400" />
            <span>Dedup Samples</span>
          </button>
        </div>
      </div>

      {/* Video / Tab Stage with Security Camera HUD */}
      <div className="relative w-full aspect-4/3 sm:aspect-16/10 max-h-[66vh] bg-[#03060d] rounded-2xl overflow-hidden border border-slate-300 dark:border-slate-800 shadow-2xl">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-contain bg-black block ${isMirrored ? '-scale-x-100' : ''}`}
        />
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          aria-label="Live face overlay. Tap a face to enroll it."
          className="absolute inset-0 w-full h-full object-contain cursor-pointer"
        />

        {/* Security Watermark HUD (Top-Left) */}
        <div className="absolute top-3 left-3 flex flex-col gap-1 text-[11px] font-mono pointer-events-none select-none">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-md border border-white/10 text-emerald-400 font-bold shadow-lg">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span>{sourceType === 'screen' ? 'CAM-02 [SCREEN-CAST]' : 'CAM-01 [ENTRANCE/LIVE]'}</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300">{cameraClock}</span>
          </div>
          {settings.showFps && (
            <div className="px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/10 text-slate-300 text-[10px]">
              {hudText}
            </div>
          )}
        </div>

        {/* Active badges (Top-Right) */}
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 pointer-events-none select-none">
          {sourceType === 'screen' && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-950/90 backdrop-blur-md border border-indigo-400/40 text-xs font-semibold text-indigo-200 shadow-lg">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Casting Tab / Screen</span>
            </div>
          )}
          {settings.nightVisionMode === 'trueColor' && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-950/90 backdrop-blur-md border border-indigo-400/40 text-[11px] font-semibold text-indigo-300 shadow-md">
              <Sun className="w-3 h-3 text-amber-400" />
              <span>Night-to-Day TrueColor ({settings.daylightProfile.split('_')[0]})</span>
            </div>
          )}
          {settings.voiceAnnounce && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-950/90 backdrop-blur-md border border-sky-400/40 text-[11px] font-semibold text-sky-300 shadow-md">
              <Volume2 className="w-3 h-3 text-sky-400" />
              <span>Voice Announce ON</span>
            </div>
          )}
          {settings.autoSnapUnknown && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/90 backdrop-blur-md border border-rose-400/40 text-[11px] font-semibold text-rose-300 shadow-md">
              <Camera className="w-3 h-3 text-rose-400" />
              <span>Auto-Snap Intruder ON</span>
            </div>
          )}
          {smallFaceBoost && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/90 backdrop-blur-md border border-amber-400/40 text-[11px] font-semibold text-amber-300 shadow-md">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Small Face Boost (608px)</span>
            </div>
          )}
        </div>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/75 backdrop-blur-md border border-white/10 text-xs font-medium text-slate-200 pointer-events-none">
          Tap any detected face to enroll
        </div>

        {(loaderMsg || loaderError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-xs p-6 text-center z-10">
            {loaderError ? (
              <div className="max-w-md space-y-2">
                <strong className="text-base font-bold text-rose-400 block">
                  Could not start
                </strong>
                <p className="text-sm text-slate-300">{loaderError}</p>
              </div>
            ) : (
              <>
                <div className="w-9 h-9 rounded-full border-3 border-slate-700 border-t-sky-400 animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-200">{loaderMsg}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Primary Stream Controls Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        {sourceType === 'camera' ? (
          <button
            type="button"
            onClick={handleStartScreenShare}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 hover:from-sky-300 hover:to-indigo-400 text-slate-950 text-sm font-bold shadow-lg shadow-sky-500/20 transition-all cursor-pointer"
            title="Cast a Chrome/browser tab, meeting window, or screen to recognize faces on"
          >
            <Monitor className="w-4 h-4 text-slate-950" />
            Share Tab / Screen
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSwitchToCamera}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 text-sm font-bold transition-all cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            Stop Tab Share (Use Camera)
          </button>
        )}

        {/* Voice Announcer Toggle (Optional feature as requested) */}
        <button
          type="button"
          onClick={toggleVoiceAnnounce}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
            settings.voiceAnnounce
              ? 'bg-sky-500/20 border-sky-400/50 text-sky-300 shadow-md shadow-sky-500/10'
              : 'bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border-slate-200 dark:border-[#24314d] text-slate-700 dark:text-slate-300'
          }`}
          title="Announce recognized names out loud via speech synthesis"
        >
          {settings.voiceAnnounce ? (
            <Volume2 className="w-4 h-4 text-sky-400 animate-pulse" />
          ) : (
            <VolumeX className="w-4 h-4 text-slate-400" />
          )}
          <span>Voice: {settings.voiceAnnounce ? 'ON' : 'OFF'}</span>
        </button>

        {/* Day-Referenced TrueColor Night Vision Toggle */}
        <button
          type="button"
          onClick={toggleNightVisionMode}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
            settings.nightVisionMode === 'trueColor'
              ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-300 shadow-md shadow-indigo-500/10'
              : 'bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border-slate-200 dark:border-[#24314d] text-slate-700 dark:text-slate-300'
          }`}
          title="Convert greyscale IR night vision into daylight true colors"
        >
          <Sun className={`w-4 h-4 ${settings.nightVisionMode === 'trueColor' ? 'text-amber-400' : 'text-slate-400'}`} />
          <span>Night-to-Day: {settings.nightVisionMode === 'trueColor' ? 'TrueColor' : 'Normal'}</span>
        </button>

        <button
          type="button"
          onClick={toggleSmallFaceBoost}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
            smallFaceBoost
              ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 shadow-md shadow-amber-500/10'
              : 'bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border-slate-200 dark:border-[#24314d] text-slate-800 dark:text-slate-100'
          }`}
          title="Ultra-sensitive detection resolution for distant and small faces"
        >
          <Sparkles className={`w-4 h-4 ${smallFaceBoost ? 'text-amber-400 fill-amber-400/20 animate-pulse' : 'text-slate-400'}`} />
          {smallFaceBoost ? 'Small Faces: Boosted (608px)' : 'Small Faces: Normal'}
        </button>

        <button
          type="button"
          onClick={toggleBoxColorMode}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-sm font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer"
          title="Toggle between vibrant per-person colors or status colors"
        >
          <Palette className="w-4 h-4 text-purple-400" />
          {boxColorMode === 'person' ? 'Colors: Per Person' : 'Colors: Status'}
        </button>

        <button
          type="button"
          onClick={togglePause}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-sm font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer"
        >
          {paused ? <Play className="w-4 h-4 text-sky-400" /> : <Pause className="w-4 h-4 text-sky-400" />}
          {paused ? 'Resume' : 'Pause'}
        </button>

        {sourceType === 'camera' && (
          <button
            type="button"
            onClick={handleFlip}
            disabled={flipDisabled}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-sm font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-sky-400" />
            Flip
          </button>
        )}

        <button
          type="button"
          onClick={handleSnapshot}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-sm font-semibold text-slate-800 dark:text-slate-100 transition-colors cursor-pointer"
        >
          <Camera className="w-4 h-4 text-sky-400" />
          Snapshot
        </button>
      </div>

      {/* Expandable Night-to-Day TrueColor Calibration Panel */}
      {showNightVisionPanel && (
        <NightVisionControls
          videoRef={videoRef}
          onSettingsChanged={() => setLocalSettings(getSettings())}
        />
      )}

      {/* Security Camera DVR Timeline Scrubber Bar */}
      <DvrTimelineBar
        markers={dvrMarkers}
        isLive={isDvrLive}
        onToggleLive={() => setIsDvrLive(!isDvrLive)}
        onMarkerClick={(m) => {
          showToast(`DVR Incident: ${m.label} (${m.type})`, 'info');
        }}
      />

      {/* Detailed Forensic Scene Telemetry & Situation Awareness Feed */}
      <ForensicTelemetryFeed
        logs={telemetryLogs}
        onClear={() => setTelemetryLogs([])}
      />

      {/* Vibrant Legend Card */}
      <div className="p-4 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] flex flex-wrap items-center gap-x-6 gap-y-2.5 text-xs font-medium text-slate-700 dark:text-slate-200">
        <span className="inline-flex items-center gap-2">
          <span className="flex -space-x-1">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00f0ff] ring-1 ring-black" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff007f] ring-1 ring-black" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#00e676] ring-1 ring-black" />
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            Recognized (Vibrant Color per Person)
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ffb703' }} />
          <span>Possible match</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ff3366' }} />
          <span>Unknown face (Auto-Snaps active)</span>
        </span>
        <span className="text-slate-500 dark:text-[#8b98b5] ml-auto font-mono text-[11px]">
          100% See-through box · Threshold {settings.threshold.toFixed(2)} · {smallFaceBoost ? 'Boosted 608px' : 'Normal'}
        </span>
      </div>

      {/* Modals */}
      <IntruderQuarantineModal
        open={showIntruderModal}
        onClose={() => setShowIntruderModal(false)}
        onEnrolled={() => refreshAuxData()}
      />

      <BiometricDedupModal
        open={showDedupModal}
        people={peopleList}
        onClose={() => setShowDedupModal(false)}
        onCompleted={() => refreshAuxData()}
      />

      <EnrollFaceModal
        open={enrollData.open}
        descriptor={enrollData.descriptor}
        image={enrollData.image}
        source={enrollData.source || 'camera'}
        defaultPersonId={enrollData.defaultPersonId}
        onClose={() => setEnrollData({ open: false, descriptor: null })}
        onSaved={() => refreshAuxData()}
      />
    </div>
  );
};

// ============================================================================
// 2. ANALYZE PHOTO VIEW (views/upload.js)
// ============================================================================
interface AnalyzedFaceItem {
  box: FaceBox;
  identity: MatchIdentity;
  descriptor: Float32Array;
  thumb: string;
}

export const AnalyzePhotoView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [summary, setSummary] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<AnalyzedFaceItem[]>([]);

  const [enrollData, setEnrollData] = useState<{
    open: boolean;
    descriptor: Float32Array | null;
    image?: string;
    defaultPersonId?: number | null;
  }>({ open: false, descriptor: null });

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file', 'error');
      return;
    }
    setItems([]);
    setSummary('Loading image…');
    let loaded: { img: HTMLImageElement; url: string };
    try {
      loaded = await loadImage(file);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not read image', 'error');
      return;
    }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(loaded.url);
    const img = loaded.img;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });

    try {
      setSummary('Loading accurate detector (first run only)…');
      await loadAccurateModel();
      setSummary('Detecting and identifying faces…');
      const [dets, gallery] = await Promise.all([
        detectFaces(img, { accurate: true, smallFaceBoost: true }),
        getGallery(),
      ]);
      const matcher = new Gallery(gallery);
      const threshold = getSettings().threshold;

      const analyzed: AnalyzedFaceItem[] = dets.map((d) => ({
        box: d.box,
        identity: matcher.match(d.descriptor, threshold),
        descriptor: d.descriptor,
        thumb: cropFace(img, d.box, 160),
      }));

      setItems(analyzed);
      setSummary(
        dets.length
          ? `${dets.length} face${dets.length === 1 ? '' : 's'} found.`
          : 'No faces found. Try a clearer or closer photo.'
      );

      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            drawTracks(ctx, analyzed, {
              W: canvas.width,
              H: canvas.height,
              mirror: false,
              colorMode: getSettings().boxColorMode,
            });
          }
        }
      });
    } catch (e) {
      setSummary('');
      showToast(e instanceof Error ? e.message : 'Analysis failed', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Analyze photo
        </h1>
        <p className="text-sm text-slate-500 dark:text-[#8b98b5]">
          Uses the accurate detector to find every face in a still image.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`p-8 rounded-2xl border-2 border-dashed text-center transition-colors flex flex-col items-center gap-3 ${
          dragOver
            ? 'border-sky-400 bg-sky-500/10'
            : 'border-slate-300 dark:border-[#24314d] bg-white dark:bg-[#141e33]'
        }`}
      >
        <strong className="text-base font-bold text-slate-900 dark:text-slate-100">
          Drop a photo here
        </strong>
        <span className="text-xs text-slate-500 dark:text-[#8b98b5]">
          JPEG, PNG or WebP. Processing happens on this device.
        </span>
        <div className="flex flex-wrap items-center justify-center gap-2.5 mt-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-sm font-semibold transition-colors"
          >
            <Upload className="w-4 h-4" />
            Choose photo
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-[#1b2742] hover:bg-slate-200 dark:hover:bg-[#24314d] text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors"
          >
            <Camera className="w-4 h-4" />
            Take photo
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {/* Image Stage */}
      {photoUrl && (
        <div className="relative inline-block w-full rounded-2xl overflow-hidden bg-[#060a12] border border-slate-200 dark:border-[#24314d]">
          <img src={photoUrl} alt="Selected photo" className="w-full h-auto block max-h-[65vh] object-contain mx-auto" />
          <canvas
            ref={canvasRef}
            width={imgDims.w}
            height={imgDims.h}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        </div>
      )}

      {summary && (
        <p className="text-sm font-medium text-slate-600 dark:text-[#8b98b5]" aria-live="polite">
          {summary}
        </p>
      )}

      {/* Detected Face Cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((it, i) => {
            const id = it.identity;
            const label = id.person ? id.person.name : 'Unknown';
            return (
              <div
                key={i}
                className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]"
              >
                <img
                  src={it.thumb}
                  alt={`Face ${i + 1}`}
                  className="w-16 h-16 rounded-xl object-cover shrink-0 border border-slate-200 dark:border-[#24314d]"
                />
                <div className="flex-1 min-w-0">
                  <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {label}
                  </strong>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                        id.status === 'match'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : id.status === 'possible'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {STATUS_LABEL[id.status]}
                    </span>
                    {id.distance != null && (
                      <span className="text-xs font-mono text-slate-500 dark:text-[#8b98b5]">
                        distance {id.distance.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEnrollData({
                      open: true,
                      descriptor: Float32Array.from(it.descriptor),
                      image: it.thumb,
                      defaultPersonId: id.person ? id.person.id : null,
                    })
                  }
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1b2742] hover:bg-slate-200 dark:hover:bg-[#24314d] text-xs font-semibold text-slate-800 dark:text-slate-100 shrink-0 transition-colors"
                >
                  Enroll…
                </button>
              </div>
            );
          })}
        </div>
      )}

      <EnrollFaceModal
        open={enrollData.open}
        descriptor={enrollData.descriptor}
        image={enrollData.image}
        source="upload"
        defaultPersonId={enrollData.defaultPersonId}
        onClose={() => setEnrollData({ open: false, descriptor: null })}
      />
    </div>
  );
};

// ============================================================================
// 3. PEOPLE MANAGEMENT VIEW (views/people.js)
// ============================================================================
export const PeopleView: React.FC = () => {
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [people, setPeople] = useState<TrillPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [personModal, setPersonModal] = useState<{ open: boolean; person: TrillPerson | null }>({
    open: false,
    person: null,
  });

  const loadPeople = async () => {
    setLoading(true);
    try {
      const list = await api.people();
      setPeople(list);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not load people', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPeople();
    const onSync = () => loadPeople();
    window.addEventListener('trill:gallery-changed', onSync);
    return () => window.removeEventListener('trill:gallery-changed', onSync);
  }, []);

  if (selectedPersonId !== null) {
    return (
      <PersonDetailView
        personId={selectedPersonId}
        onBack={() => {
          setSelectedPersonId(null);
          loadPeople();
        }}
      />
    );
  }

  const q = search.trim().toLowerCase();
  const shown = people.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q)
  );
  const totalSamples = people.reduce((n, p) => n + (p.faceCount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            People
          </h1>
          <span className="text-xs text-slate-500 dark:text-[#8b98b5]">
            {people.length} enrolled · {totalSamples} samples
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPersonModal({ open: true, person: null })}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-sm font-semibold transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add person
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
        />
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-[#8b98b5]">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="p-8 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] text-center space-y-1.5">
          <strong className="block text-base font-bold text-slate-900 dark:text-slate-100">
            {people.length ? 'No matches' : 'No people yet'}
          </strong>
          <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
            {people.length
              ? 'Try a different search.'
              : 'Add a person, then give them a few photos or capture them from the camera.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPersonId(p.id)}
              className="flex items-center gap-3.5 p-4 rounded-2xl bg-white dark:bg-[#141e33] hover:bg-slate-50 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-left transition-colors"
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-inner"
                style={{ background: p.color }}
              >
                {initials(p.name)}
              </div>
              <div className="flex-1 min-w-0">
                <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {p.name}
                </strong>
                <div className="text-xs text-slate-500 dark:text-[#8b98b5] truncate">
                  {p.faceCount ?? 0} sample{p.faceCount === 1 ? '' : 's'}
                  {p.notes ? ` · ${p.notes}` : ''}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {personModal.open && (
        <PersonFormModal
          person={personModal.person}
          onClose={() => setPersonModal({ open: false, person: null })}
          onSaved={(saved) => {
            setPersonModal({ open: false, person: null });
            setSelectedPersonId(saved.id);
          }}
        />
      )}
    </div>
  );
};

// Person Create / Edit Modal
const PersonFormModal: React.FC<{
  person: TrillPerson | null;
  onClose: () => void;
  onSaved: (p: TrillPerson) => void;
}> = ({ person, onClose, onSaved }) => {
  const [name, setName] = useState(person?.name || '');
  const [notes, setNotes] = useState(person?.notes || '');
  const [color, setColor] = useState(person?.color || PERSON_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      showToast('Name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: cleanName, notes: notes.trim(), color };
      const saved = person
        ? await api.updatePerson(person.id, payload)
        : await api.createPerson(payload);
      showToast(person ? 'Person updated' : `${saved.name} added`, 'success');
      notifyGalleryChanged();
      onSaved(saved);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={person ? 'Edit person' : 'Add person'}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] shadow-2xl overflow-hidden"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#24314d]">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            {person ? 'Edit person' : 'Add person'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-1.5">
                Name
              </label>
              <input
                type="text"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                autoComplete="off"
                required
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#0a0f1c] border border-slate-300 dark:border-[#24314d] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-1.5">
                Notes
              </label>
              <textarea
                rows={3}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes (role, team, etc.)"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-[#0a0f1c] border border-slate-300 dark:border-[#24314d] text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8b98b5] mb-2">
                Color
              </label>
              <div className="flex flex-wrap gap-2.5">
                {PERSON_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      c === color ? 'ring-2 ring-white ring-offset-2 ring-offset-[#141e33] scale-110' : ''
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-200 dark:border-[#24314d] bg-slate-50/50 dark:bg-[#101828]/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 disabled:opacity-50"
            >
              {saving ? 'Saving…' : person ? 'Save' : 'Create'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

// Person Detail & Sample Management
const PersonDetailView: React.FC<{ personId: number; onBack: () => void }> = ({
  personId,
  onBack,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [person, setPerson] = useState<TrillPerson | null>(null);
  const [faces, setFaces] = useState<TrillFaceSample[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<number, string | null>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [confirmDeletePerson, setConfirmDeletePerson] = useState(false);

  const loadPersonAndSamples = async () => {
    try {
      const [p, fList] = await Promise.all([api.person(personId), api.faces(personId)]);
      setPerson(p);
      setFaces(fList);
      const urls: Record<number, string | null> = {};
      await Promise.all(
        fList.map(async (f) => {
          urls[f.id] = await api.thumbUrl(f.thumbUrl);
        })
      );
      setThumbUrls(urls);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load person', 'error');
    }
  };

  useEffect(() => {
    loadPersonAndSamples();
  }, [personId]);

  const handleUploadPhotos = async (files: FileList | null) => {
    if (!files || !files.length || !person) return;
    const list = Array.from(files);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      showToast(`Processing ${i + 1} of ${list.length}…`, 'info');
      try {
        const { img, url } = await loadImage(list[i]);
        try {
          const r = await enrollFromSource(img, person.id, { accurate: true });
          if (r.ok) ok++;
          else failed++;
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch {
        failed++;
      }
    }
    showToast(
      `${ok} sample${ok === 1 ? '' : 's'} added${
        failed ? `, ${failed} skipped (no face found)` : ''
      }`,
      ok ? 'success' : 'error'
    );
    notifyGalleryChanged();
    await loadPersonAndSamples();
  };

  const handleRemoveSample = async (faceId: number) => {
    try {
      await api.deleteFace(faceId);
      notifyGalleryChanged();
      showToast('Sample removed', 'info');
      await loadPersonAndSamples();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to remove sample', 'error');
    }
  };

  const handleDeletePerson = async () => {
    if (!person) return;
    try {
      await api.deletePerson(person.id);
      notifyGalleryChanged();
      showToast(`${person.name} deleted`, 'success');
      onBack();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error');
    }
  };

  if (!person) {
    return (
      <div className="p-6 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-400"
        >
          <ChevronLeft className="w-4 h-4" /> People
        </button>
        <p className="mt-3 text-sm text-slate-500">Loading person details…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-400 hover:text-sky-300"
      >
        <ChevronLeft className="w-4 h-4" /> People
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
          style={{ background: person.color }}
        >
          {initials(person.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {person.name}
          </h1>
          <div className="text-sm text-slate-500 dark:text-[#8b98b5]">
            {person.notes || 'No notes'}
          </div>
          <div className="text-xs text-slate-400 dark:text-[#8b98b5]/80 mt-0.5">
            Added {fmtDate(person.createdAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1b2742] hover:bg-slate-200 dark:hover:bg-[#24314d] text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeletePerson(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-semibold text-rose-400"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Face Samples Card */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Face samples{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-[#8b98b5]">
              ({faces.length})
            </span>
          </h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-[#8b98b5] leading-relaxed">
          Add 3–5 photos with varied lighting, angles, and expressions for best accuracy. One face
          per photo works best; the largest face is used.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-sm font-semibold transition-colors"
          >
            <Upload className="w-4 h-4" /> Upload photos
          </button>
          <button
            type="button"
            onClick={() => setCaptureOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-[#1b2742] hover:bg-slate-200 dark:hover:bg-[#24314d] text-slate-800 dark:text-slate-100 text-sm font-semibold transition-colors"
          >
            <Camera className="w-4 h-4" /> Capture from camera
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handleUploadPhotos(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {faces.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-50 dark:bg-[#101828] text-center text-xs text-slate-500 dark:text-[#8b98b5]">
            No samples yet. Upload photos or capture from the camera.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
            {faces.map((f) => {
              const u = thumbUrls[f.id];
              return (
                <div
                  key={f.id}
                  className="relative group aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-[#101828] border border-slate-200 dark:border-[#24314d]"
                >
                  {u ? (
                    <img
                      src={u}
                      alt={`Sample from ${fmtDate(f.createdAt)}`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-500">
                      No image
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemoveSample(f.id)}
                    aria-label="Delete sample"
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-slate-950/80 hover:bg-rose-600 text-white flex items-center justify-center text-xs font-bold transition-colors"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editOpen && (
        <PersonFormModal
          person={person}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setPerson(updated);
            setEditOpen(false);
          }}
        />
      )}

      {captureOpen && (
        <CaptureSampleModal
          person={person}
          onClose={() => {
            setCaptureOpen(false);
            loadPersonAndSamples();
          }}
        />
      )}

      {confirmDeletePerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Delete person</h3>
            <p className="text-sm text-slate-600 dark:text-[#8b98b5]">
              Delete {person.name} and all of their face samples? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeletePerson(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePerson}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Camera Capture Modal for a Person
const CaptureSampleModal: React.FC<{ person: TrillPerson; onClose: () => void }> = ({
  person,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [info, setInfo] = useState('Center the face and tap Capture. Turn slightly between shots.');
  const [added, setAdded] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    startCamera(v, getSettings().facing).catch((e) => {
      setInfo(e instanceof Error ? e.message : 'Camera error');
      setBusy(true);
    });
    return () => {
      stopCamera(v);
    };
  }, []);

  const handleCapture = async () => {
    const v = videoRef.current;
    if (!v) return;
    setBusy(true);
    setInfo('Analyzing…');
    try {
      await loadCoreModels();
      const dets = await detectFaces(v, { inputSize: 416 });
      if (!dets.length) {
        setInfo('No face found. Move closer or improve the lighting.');
        return;
      }
      dets.sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
      const d = dets[0];
      await addSample(person.id, {
        descriptor: d.descriptor,
        image: cropFace(v, d.box),
        source: 'camera',
      });
      setAdded((n) => n + 1);
      setInfo('Captured. Turn slightly for another angle.');
      notifyGalleryChanged();
      showToast('Sample captured', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Capture failed', 'error');
      setInfo('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const mirror = getSettings().facing === 'user';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] overflow-hidden">
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#24314d]">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Capture for {person.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="p-5 space-y-4">
          <div className="aspect-4/3 w-full rounded-xl overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${mirror ? '-scale-x-100' : ''}`}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-[#8b98b5]">{info}</p>
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={busy}
              onClick={handleCapture}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-sm font-bold disabled:opacity-50"
            >
              <Camera className="w-4 h-4" /> Capture
            </button>
            <span className="text-xs font-mono text-slate-500 dark:text-[#8b98b5]">
              {added} captured
            </span>
          </div>
        </div>
        <footer className="flex justify-end px-5 py-3.5 border-t border-slate-200 dark:border-[#24314d]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-sky-400 text-slate-950 text-sm font-semibold"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};

// ============================================================================
// 4. RECOGNITION LOG VIEW (views/log.js)
// ============================================================================
const LOG_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'match', label: 'Recognized' },
  { id: 'possible', label: 'Possible' },
  { id: 'unknown', label: 'Unknown' },
] as const;

export const RecognitionLogView: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'match' | 'possible' | 'unknown'>('all');
  const [events, setEvents] = useState<TrillRecognitionEvent[]>([]);
  const [stats, setStats] = useState<TrillStats>({
    people: 0,
    faces: 0,
    events: 0,
    eventsToday: 0,
  });
  const [queued, setQueued] = useState(0);
  const [offlineErr, setOfflineErr] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadData = async () => {
    try {
      const [s, ev] = await Promise.all([api.stats(), api.events(300)]);
      setStats(s);
      setEvents(ev);
      setOfflineErr(null);
    } catch (e) {
      setOfflineErr(
        `Server unavailable: ${e instanceof Error ? e.message : 'Offline'}. Showing nothing new.`
      );
    }
    setQueued(await pendingCount());
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleSync = async () => {
    const sent = await flushPending();
    showToast(
      sent ? `Synced ${sent} event${sent === 1 ? '' : 's'}` : 'Nothing to sync',
      sent ? 'success' : 'info'
    );
    loadData();
  };

  const handleClear = async () => {
    setConfirmClear(false);
    try {
      await api.clearEvents();
      showToast('Log cleared', 'success');
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to clear log', 'error');
    }
  };

  const shown = events.filter((e) => filter === 'all' || e.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Recognition log
          </h1>
          <p className="text-sm text-slate-500 dark:text-[#8b98b5]">
            Identities seen by your devices. Repeats are throttled per person.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-[#141e33] hover:bg-slate-100 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-xs font-semibold text-slate-800 dark:text-slate-100"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-semibold text-rose-400"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Enrolled people', value: stats.people },
          { label: 'Face samples', value: stats.faces },
          { label: 'Events today', value: stats.eventsToday },
          { label: 'Total events', value: stats.events },
        ].map((st) => (
          <div
            key={st.label}
            className="p-4 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]"
          >
            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
              {st.value}
            </div>
            <div className="text-xs text-slate-500 dark:text-[#8b98b5] mt-0.5">{st.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Segmented Control */}
      <div
        role="tablist"
        className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]"
      >
        {LOG_FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === f.id
                ? 'bg-white dark:bg-[#1b2742] text-sky-500 dark:text-sky-400 shadow-xs'
                : 'text-slate-600 dark:text-[#8b98b5] hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Event List */}
      {shown.length === 0 ? (
        <div className="p-8 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] text-center text-sm text-slate-500 dark:text-[#8b98b5]">
          {events.length
            ? 'Nothing in this filter.'
            : 'No events yet. Run live recognition to populate the log.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-[#24314d] rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] overflow-hidden">
          {shown.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-4 py-3.5 gap-3">
              <div className="min-w-0">
                <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {e.label}
                </strong>
                <div className="text-xs text-slate-500 dark:text-[#8b98b5]">
                  {fmtDate(e.createdAt)} · {e.device || 'device'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`inline-flex px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                    e.status === 'match'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : e.status === 'possible'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {STATUS_LABEL[e.status] || e.status}
                </span>
                {e.distance != null && (
                  <div className="text-[11px] font-mono text-slate-500 dark:text-[#8b98b5] mt-0.5">
                    d {e.distance.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Offline Queue Sync Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]">
        <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
          {queued
            ? `${queued} event${queued === 1 ? '' : 's'} queued on this device (offline).`
            : 'No queued events on this device.'}
        </p>
        <button
          type="button"
          onClick={handleSync}
          className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1b2742] hover:bg-slate-200 dark:hover:bg-[#24314d] text-xs font-semibold text-slate-800 dark:text-slate-100"
        >
          Sync queued events
        </button>
      </div>

      {offlineErr && <p className="text-xs text-amber-400">{offlineErr}</p>}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Clear log</h3>
            <p className="text-sm text-slate-600 dark:text-[#8b98b5]">
              Delete all recognition events from the server? Enrolled people are not affected.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 5. SETTINGS VIEW (views/settings-view.js)
// ============================================================================
const MODEL_FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
];

export const TrillSettingsView: React.FC = () => {
  const [s, setLocal] = useState(getSettings());
  const [apiKeyInput, setApiKeyInput] = useState(s.apiKey);
  const [serverStatus, setServerStatus] = useState<{ text: string; state: 'checking' | 'on' | 'off' }>({
    text: 'Checking…',
    state: 'checking',
  });
  const [gallerySummary, setGallerySummary] = useState('');
  const [dlProgress, setDlProgress] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [storageUsed, setStorageUsed] = useState('');

  const updateSetting = (patch: Partial<typeof s>) => {
    const next = setSettings(patch);
    setLocal(next);
  };

  const testConnection = async () => {
    setServerStatus({ text: 'Checking…', state: 'checking' });
    try {
      const hl = await api.health();
      setServerStatus({
        text: hl.authRequired && !getSettings().apiKey ? 'Connected · key needed' : 'Connected',
        state: 'on',
      });
    } catch (e) {
      const err = e as { status?: number };
      setServerStatus({
        text: err.status === 401 ? 'API key rejected' : 'Unreachable',
        state: 'off',
      });
    }
  };

  const updateGalleryInfo = async () => {
    const g = await getGallery();
    const samples = g.people.reduce((n, p) => n + p.descriptors.length, 0);
    const pending = await pendingCount();
    setGallerySummary(
      `${g.people.length} people · ${samples} samples · ${pending} queued event${
        pending === 1 ? '' : 's'
      }`
    );
  };

  useEffect(() => {
    testConnection();
    updateGalleryInfo();
    navigator.storage?.estimate?.().then((e) => {
      if (e?.usage) {
        setStorageUsed(`${(e.usage / 1048576).toFixed(1)} MB used by this app`);
      }
    });
  }, []);

  const handleDownloadModels = async () => {
    setDownloading(true);
    let done = 0;
    for (const f of MODEL_FILES) {
      try {
        await fetch(`/models/${f}`, { cache: 'reload' });
      } catch {
        // ignore if offline
      }
      done++;
      setDlProgress(`${done}/${MODEL_FILES.length}`);
    }
    setDlProgress('Done');
    setDownloading(false);
    showToast('Models cached for offline use', 'success');
  };

  const handleInstall = async () => {
    const deferred = window.deferredInstallPrompt;
    if (!deferred) {
      showToast('Use your browser menu → Install app / Add to Home Screen', 'info');
      return;
    }
    deferred.prompt();
    await deferred.userChoice;
    window.deferredInstallPrompt = null;
  };

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Settings
        </h1>
        <p className="text-sm text-slate-500 dark:text-[#8b98b5]">Changes save automatically.</p>
      </div>

      {/* Recognition Section */}
      <section className="p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] space-y-5">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-sky-400" /> Recognition
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-[#24314d]/60">
          <div className="max-w-md">
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Match threshold
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Lower is stricter (fewer false matches). Higher finds more matches but risks mistakes.
              0.50 is a good start.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0.30"
              max="0.70"
              step="0.01"
              value={s.threshold}
              onChange={(e) => updateSetting({ threshold: Number(e.target.value) })}
              className="w-36 accent-sky-400"
            />
            <span className="font-mono text-sm font-semibold text-sky-400 w-10 text-right">
              {s.threshold.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-[#24314d]/60">
          <div className="max-w-md">
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Detector
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Accurate uses an SSD MobileNet model: better on small or angled faces, slower to load
              (~5 MB).
            </p>
          </div>
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#0a0f1c] border border-slate-200 dark:border-[#24314d]">
            {(
              [
                { value: 'tiny', label: 'Fast (default)' },
                { value: 'ssd', label: 'Accurate' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSetting({ detector: opt.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  s.detector === opt.value
                    ? 'bg-white dark:bg-[#1b2742] text-sky-400 shadow-xs'
                    : 'text-slate-500 dark:text-[#8b98b5]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-[#24314d]/60">
          <div className="max-w-md">
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Resolution
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Higher resolution finds smaller faces but costs speed.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0a0f1c] border border-slate-200 dark:border-[#24314d]">
            {[
              { value: 224, label: 'Fast (224)' },
              { value: 320, label: 'Balanced (320)' },
              { value: 416, label: 'Standard (416)' },
              { value: 512, label: 'Small faces (512)' },
              { value: 608, label: 'Ultra small (608)' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSetting({ inputSize: opt.value })}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  s.inputSize === opt.value
                    ? 'bg-white dark:bg-[#1b2742] text-sky-400 shadow-xs'
                    : 'text-slate-500 dark:text-[#8b98b5]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60 cursor-pointer">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Ultra Small Face Boost
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Forces high-resolution 608px scan & ultra-sensitive 0.20 confidence threshold. Perfect for shared browser tabs, distant crowds, or wide security cameras.
            </p>
          </div>
          <input
            type="checkbox"
            checked={s.smallFaceBoost}
            onChange={(e) => updateSetting({ smallFaceBoost: e.target.checked, inputSize: e.target.checked ? 608 : 416 })}
            className="w-5 h-5 accent-sky-400 rounded"
          />
        </label>
      </section>

      {/* Camera & Display Section */}
      <section className="p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Camera className="w-4 h-4 text-sky-400" /> Camera & display
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Default camera
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Used when the Live view starts.
            </p>
          </div>
          <select
            value={s.facing}
            onChange={(e) => updateSetting({ facing: e.target.value as 'user' | 'environment' })}
            className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#0a0f1c] border border-slate-200 dark:border-[#24314d] text-xs font-semibold text-slate-900 dark:text-slate-100"
          >
            <option value="user">Front camera</option>
            <option value="environment">Back camera</option>
          </select>
        </div>

        <label className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60 cursor-pointer">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Mirror front camera
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Flip the front camera like a mirror.
            </p>
          </div>
          <input
            type="checkbox"
            checked={s.mirror}
            onChange={(e) => updateSetting({ mirror: e.target.checked })}
            className="w-5 h-5 accent-sky-400 rounded"
          />
        </label>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Box colors
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Status colors: green, amber, red. Person colors: each person gets their own color.
            </p>
          </div>
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#0a0f1c] border border-slate-200 dark:border-[#24314d]">
            {(
              [
                { value: 'status', label: 'Status' },
                { value: 'person', label: 'Person' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => updateSetting({ boxColorMode: opt.value })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                  s.boxColorMode === opt.value
                    ? 'bg-white dark:bg-[#1b2742] text-sky-400 shadow-xs'
                    : 'text-slate-500 dark:text-[#8b98b5]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60 cursor-pointer">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Show performance HUD
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              FPS, detection time and face count over the camera feed.
            </p>
          </div>
          <input
            type="checkbox"
            checked={s.showFps}
            onChange={(e) => updateSetting({ showFps: e.target.checked })}
            className="w-5 h-5 accent-sky-400 rounded"
          />
        </label>

        <label className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60 cursor-pointer">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Log recognitions
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Record recognized and unknown faces to the server log.
            </p>
          </div>
          <input
            type="checkbox"
            checked={s.logEvents}
            onChange={(e) => updateSetting({ logEvents: e.target.checked })}
            className="w-5 h-5 accent-sky-400 rounded"
          />
        </label>
      </section>

      {/* Server Section */}
      <section className="p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Shield className="w-4 h-4 text-sky-400" /> Server
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Connection
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              People, samples and the log are stored on the Trill server.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                serverStatus.state === 'on'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : serverStatus.state === 'off'
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  : 'bg-slate-700 text-slate-300'
              }`}
            >
              {serverStatus.text}
            </span>
            <button
              type="button"
              onClick={testConnection}
              className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-[#1b2742] text-xs font-semibold text-slate-800 dark:text-slate-100"
            >
              Test connection
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              API key
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Set this if the server was started with TRILL_API_KEY.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Only if the server requires one"
              autoComplete="off"
              className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-[#0a0f1c] border border-slate-200 dark:border-[#24314d] text-xs text-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => {
                updateSetting({ apiKey: apiKeyInput.trim() });
                showToast('API key saved', 'success');
                testConnection();
              }}
              className="px-3.5 py-2 rounded-xl bg-sky-400 text-slate-950 text-xs font-semibold"
            >
              Save key
            </button>
          </div>
        </div>
      </section>

      {/* Offline Section */}
      <section className="p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-sky-400" /> Offline
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Gallery cache
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Recognition keeps working without a connection using the last synced gallery.
            </p>
          </div>
          <div className="space-y-2 sm:text-right">
            <div className="text-xs font-mono text-slate-500 dark:text-[#8b98b5]">
              {gallerySummary}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <button
                type="button"
                onClick={async () => {
                  await getGallery({ refresh: true });
                  showToast('Gallery synced', 'success');
                  updateGalleryInfo();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-[#1b2742] text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                Sync gallery now
              </button>
              <button
                type="button"
                onClick={async () => {
                  await kvSet('gallery', null);
                  showToast('Offline cache cleared', 'info');
                  updateGalleryInfo();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs font-semibold text-rose-400"
              >
                Clear offline cache
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Models
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Models are cached automatically on first use. Download them now to be sure they are
              ready offline.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={downloading}
              onClick={handleDownloadModels}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-[#1b2742] text-xs font-semibold text-slate-800 dark:text-slate-100 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" /> Download models for offline use
            </button>
            {dlProgress && (
              <span className="text-xs font-mono text-sky-400">{dlProgress}</span>
            )}
          </div>
        </div>
      </section>

      {/* App & Install Section */}
      <section className="p-5 rounded-2xl bg-white dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d] space-y-4">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-sky-400" /> App
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-[#24314d]/60">
          <div className="max-w-md">
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              Install
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              {standalone
                ? 'Running as an installed app.'
                : 'Install Trill Face Rec to your home screen or desktop for a full-screen app experience. On iPhone: Share → Add to Home Screen.'}
            </p>
          </div>
          {standalone ? (
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-semibold">
              Installed
            </span>
          ) : (
            <button
              type="button"
              onClick={handleInstall}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" /> Install app
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#24314d]/60">
          <div>
            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100 block">
              About
            </strong>
            <p className="text-xs text-slate-500 dark:text-[#8b98b5]">
              Trill Face Rec 1.0. Face embeddings are computed on-device with face-api.js
              (TensorFlow.js).
            </p>
          </div>
          {storageUsed && (
            <span className="text-xs font-mono text-slate-500 dark:text-[#8b98b5]">
              {storageUsed}
            </span>
          )}
        </div>
      </section>
    </div>
  );
};
