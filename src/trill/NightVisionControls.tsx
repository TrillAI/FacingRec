import React, { useState } from 'react';
import {
  trueColorNightVision,
  PRESET_DAYTIME_PROFILES,
  DaytimePaletteProfile,
} from './nightVision';
import { getSettings, setSettings } from './engine';
import { showToast } from './TrillViews';
import {
  Sun,
  Moon,
  Sparkles,
  Camera,
  Layers,
  Sliders,
  Check,
  Eye,
} from 'lucide-react';

interface NightVisionControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSettingsChanged?: () => void;
}

export const NightVisionControls: React.FC<NightVisionControlsProps> = ({
  videoRef,
  onSettingsChanged,
}) => {
  const [settings, setLocalSettings] = useState(getSettings());
  const [activeProfile, setActiveProfile] = useState<string>(settings.daylightProfile || 'sunny_outdoor');
  const [calibrating, setCalibrating] = useState(false);
  const [customProfile, setCustomProfile] = useState<DaytimePaletteProfile | null>(null);

  const handleModeChange = (mode: 'off' | 'trueColor' | 'irMono') => {
    const updated = setSettings({ nightVisionMode: mode });
    setLocalSettings(updated);
    if (onSettingsChanged) onSettingsChanged();
    showToast(
      mode === 'trueColor'
        ? 'Day-Referenced TrueColor Night-to-Day ACTIVE'
        : mode === 'irMono'
        ? 'High-Contrast IR Monochrome ACTIVE'
        : 'Night Vision OFF: Normal camera colors',
      'info'
    );
  };

  const handleProfileChange = (pId: string) => {
    setActiveProfile(pId);
    const updated = setSettings({ daylightProfile: pId });
    setLocalSettings(updated);
    if (onSettingsChanged) onSettingsChanged();
    showToast(`Daytime reference set to: ${pId}`, 'info');
  };

  const handleCalibrateDaytime = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      showToast('Camera feed not ready to calibrate', 'error');
      return;
    }
    setCalibrating(true);
    try {
      const captured = trueColorNightVision.captureDaytimeReference(video);
      setCustomProfile(captured);
      const updated = setSettings({ daylightProfile: 'custom_daytime', nightVisionMode: 'trueColor' });
      setLocalSettings(updated);
      setActiveProfile('custom_daytime');
      if (onSettingsChanged) onSettingsChanged();
      showToast(
        'Daytime color profile calibrated! Night vision will now reference your exact room colors.',
        'success'
      );
    } catch {
      showToast('Failed to calibrate daytime palette', 'error');
    } finally {
      setCalibrating(false);
    }
  };

  const currentMode = settings.nightVisionMode;

  return (
    <div className="p-4 rounded-2xl bg-[#090e1a] border border-slate-800 text-slate-200 space-y-3.5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Moon className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              Day-Referenced TrueColor IR Night Vision
              {currentMode === 'trueColor' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  DAYLIGHT SYNTHESIS ACTIVE
                </span>
              )}
            </h3>
            <p className="text-[11px] text-slate-400">
              Converts greyscale infrared (IR) night footage into true daylight colors referencing daytime scene calibrations.
            </p>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="inline-flex p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => handleModeChange('off')}
            className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
              currentMode === 'off' ? 'bg-slate-800 text-slate-100 shadow-xs' : 'text-slate-400'
            }`}
          >
            Normal
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('trueColor')}
            className={`px-3 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
              currentMode === 'trueColor'
                ? 'bg-gradient-to-r from-sky-400 to-indigo-500 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>TrueColor (Night-to-Day)</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('irMono')}
            className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
              currentMode === 'irMono' ? 'bg-slate-800 text-slate-100 shadow-xs' : 'text-slate-400'
            }`}
          >
            IR Mono
          </button>
        </div>
      </div>

      {currentMode === 'trueColor' && (
        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Profile options */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-semibold mr-1">Daytime Reference:</span>
            {Object.values(PRESET_DAYTIME_PROFILES).map((prof) => (
              <button
                key={prof.id}
                type="button"
                onClick={() => handleProfileChange(prof.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  activeProfile === prof.id
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {prof.name.split(' ')[0]}
              </button>
            ))}
            {customProfile && (
              <button
                type="button"
                onClick={() => handleProfileChange('custom_daytime')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  activeProfile === 'custom_daytime'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}
              >
                Live Calibrated
              </button>
            )}
          </div>

          {/* Calibrate Daytime Button */}
          <button
            type="button"
            onClick={handleCalibrateDaytime}
            disabled={calibrating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200 transition-colors cursor-pointer"
            title="Samples current camera daytime lighting to create exact true color reference"
          >
            <Camera className="w-3.5 h-3.5 text-sky-400" />
            <span>{calibrating ? 'Sampling…' : 'Capture Daylight Reference'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
