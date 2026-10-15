import React, { useState } from 'react';
import { Download, Pause, Play, RefreshCw, Sparkles } from 'lucide-react';

type HairStyle = 'waves' | 'short' | 'long' | 'curly' | 'bun' | 'buzz' | 'locs' | 'none';
type FacePreset = {
  id: string;
  name: string;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eye: string;
  accent: string;
  clothing: string;
  faceShape: 'oval' | 'round' | 'angular';
  glasses?: boolean;
  freckles?: boolean;
  earrings?: boolean;
};

const FACE_PRESETS: FacePreset[] = [
  { id: 'nova', name: 'Nova', skin: '#f2c8a7', hair: '#29243a', hairStyle: 'waves', eye: '#425a72', accent: '#a78bfa', clothing: '#4f46e5', faceShape: 'oval', freckles: true },
  { id: 'milo', name: 'Milo', skin: '#dfaa81', hair: '#30231d', hairStyle: 'short', eye: '#4f694c', accent: '#34d399', clothing: '#0f766e', faceShape: 'angular' },
  { id: 'zuri', name: 'Zuri', skin: '#8f5947', hair: '#211c25', hairStyle: 'locs', eye: '#342b43', accent: '#fb7185', clothing: '#9d174d', faceShape: 'oval', earrings: true },
  { id: 'arlo', name: 'Arlo', skin: '#f0d1ad', hair: '#c88645', hairStyle: 'curly', eye: '#53683f', accent: '#fbbf24', clothing: '#b45309', faceShape: 'round', freckles: true },
  { id: 'sage', name: 'Sage', skin: '#c48966', hair: '#3c2925', hairStyle: 'bun', eye: '#416b72', accent: '#38bdf8', clothing: '#0369a1', faceShape: 'round', glasses: true },
  { id: 'koa', name: 'Koa', skin: '#edc29a', hair: '#332b27', hairStyle: 'buzz', eye: '#554536', accent: '#fb923c', clothing: '#c2410c', faceShape: 'angular' },
  { id: 'mira', name: 'Mira', skin: '#f5d3c1', hair: '#713b57', hairStyle: 'long', eye: '#52658c', accent: '#e879f9', clothing: '#86198f', faceShape: 'oval', glasses: true },
  { id: 'theo', name: 'Theo', skin: '#b97b5e', hair: '#201e29', hairStyle: 'none', eye: '#5c7058', accent: '#2dd4bf', clothing: '#0f766e', faceShape: 'round', earrings: true },
];

const EMOTIONS = [
  { id: 'calm', label: 'Calm', symbol: '◌', note: 'Soft, neutral expression' },
  { id: 'joy', label: 'Joy', symbol: '☺', note: 'Warm open smile' },
  { id: 'laugh', label: 'Laugh', symbol: '✳', note: 'Big, bright laugh' },
  { id: 'surprise', label: 'Surprise', symbol: '!', note: 'Wide eyes, round mouth' },
  { id: 'curious', label: 'Curious', symbol: '?', note: 'One brow raised' },
  { id: 'focus', label: 'Focus', symbol: '◎', note: 'Steady, intent gaze' },
  { id: 'sad', label: 'Sad', symbol: '⌢', note: 'Gentle downturned mouth' },
  { id: 'sleepy', label: 'Sleepy', symbol: 'z', note: 'Relaxed, heavy eyelids' },
  { id: 'confident', label: 'Confident', symbol: '↗', note: 'Subtle, assured smirk' },
  { id: 'frustrated', label: 'Frustrated', symbol: '⌁', note: 'Tense brows, firm mouth' },
] as const;
type EmotionId = (typeof EMOTIONS)[number]['id'];

const ANIMATIONS = [
  { id: 'still', label: 'Still pose', icon: '◉', note: 'Hold the expression' },
  { id: 'breathing', label: 'Breathing', icon: '≈', note: 'Slow, gentle inhale / exhale' },
  { id: 'chewing', label: 'Chewing gum', icon: '◍', note: 'Bouncy jaw with a gum bubble' },
  { id: 'blink', label: 'Blink loop', icon: '⌒', note: 'Natural, relaxed blinks' },
  { id: 'talking', label: 'Talking', icon: '•••', note: 'Light speech-mouth motion' },
  { id: 'nodding', label: 'Nodding', icon: '↕', note: 'Small, friendly head nod' },
  { id: 'floating', label: 'Soft float', icon: '✦', note: 'Slow, dreamy bob' },
] as const;
type AnimationId = (typeof ANIMATIONS)[number]['id'];

const BROW_PATHS: Record<EmotionId, [string, string]> = {
  calm: ['M82 115 Q96 109 108 114', 'M132 114 Q144 109 158 115'],
  joy: ['M82 113 Q96 105 108 112', 'M132 112 Q144 105 158 113'],
  laugh: ['M82 112 Q96 101 108 111', 'M132 111 Q144 101 158 112'],
  surprise: ['M82 104 Q96 95 108 103', 'M132 103 Q144 95 158 104'],
  curious: ['M82 104 Q96 94 108 102', 'M132 116 Q144 121 158 116'],
  focus: ['M82 116 Q96 121 108 116', 'M132 116 Q144 121 158 116'],
  sad: ['M82 115 Q96 122 108 117', 'M132 117 Q144 122 158 115'],
  sleepy: ['M82 118 Q96 120 108 118', 'M132 118 Q144 120 158 118'],
  confident: ['M82 113 Q96 108 108 113', 'M132 115 Q144 111 158 109'],
  frustrated: ['M82 119 Q96 106 108 108', 'M132 108 Q144 106 158 119'],
};

const HAIR_FRONT: Partial<Record<HairStyle, string>> = {
  waves: 'M48 145 C43 99 58 62 93 52 C127 36 169 56 185 81 C196 100 193 122 190 139 C175 112 162 101 147 91 C129 111 104 119 76 112 C68 125 60 136 48 145Z',
  short: 'M51 142 C42 100 58 64 91 53 C122 39 161 51 180 76 C193 94 194 119 188 139 C174 116 159 105 143 92 C120 111 89 114 69 108 C64 121 58 133 51 142Z',
  long: 'M48 145 C39 95 59 57 95 48 C128 38 165 53 184 80 C194 97 193 121 189 142 C173 111 162 100 144 88 C123 108 94 116 70 108 C64 125 56 137 48 145Z',
  bun: 'M49 145 C42 99 59 62 92 52 C126 39 164 54 183 80 C195 99 192 122 189 140 C172 115 160 103 143 91 C124 107 96 115 72 109 C65 125 57 138 49 145Z',
  buzz: 'M52 138 C45 101 60 70 91 57 C121 44 157 54 177 78 C188 92 191 111 188 131 C170 109 150 99 130 96 C104 107 80 109 61 103Z',
  locs: 'M47 143 C39 95 60 58 94 49 C127 38 165 55 184 81 C195 99 192 122 189 141 C173 111 161 99 143 88 C121 109 94 116 70 108 C64 125 56 138 47 143Z',
};

function getHairBack(style: HairStyle): string | null {
  if (style === 'long') return 'M55 121 C34 133 38 188 43 247 L71 247 L77 162Z M185 119 C207 140 202 197 197 247 L169 247 L163 158Z';
  if (style === 'locs') return 'M54 116 C34 144 42 197 50 247 L72 247 L78 143Z M184 114 C206 145 199 203 191 247 L168 247 L162 143Z';
  return null;
}

function Mouth({ emotion, intensity }: { emotion: EmotionId; intensity: number }) {
  const curve = Math.round((intensity / 100) * 12);
  if (emotion === 'surprise') {
    return <ellipse cx="120" cy="190" rx={8 + intensity * 0.08} ry={12 + intensity * 0.12} fill="#542c35" stroke="#542c35" strokeWidth="2" />;
  }
  if (emotion === 'laugh') {
    return <path d={`M97 183 Q120 ${202 + curve} 143 183 Q140 ${218 + curve} 120 ${216 + curve} Q100 ${214 + curve} 97 183Z`} fill="#682f3b" stroke="#682f3b" strokeWidth="2" strokeLinejoin="round" />;
  }
  if (emotion === 'joy') {
    return <path d={`M99 184 Q120 ${196 + curve} 141 184`} fill="none" stroke="#682f3b" strokeWidth={3 + intensity * 0.018} strokeLinecap="round" />;
  }
  if (emotion === 'sad') {
    return <path d={`M100 ${198 - curve / 3} Q120 ${181 - curve / 2} 140 ${198 - curve / 3}`} fill="none" stroke="#682f3b" strokeWidth="3.5" strokeLinecap="round" />;
  }
  if (emotion === 'sleepy') {
    return <path d="M105 191 Q120 193 135 191" fill="none" stroke="#682f3b" strokeWidth="3" strokeLinecap="round" />;
  }
  if (emotion === 'confident') {
    return <path d={`M101 190 Q119 ${194 - curve / 2} 131 188 Q137 185 141 181`} fill="none" stroke="#682f3b" strokeWidth="3.5" strokeLinecap="round" />;
  }
  if (emotion === 'frustrated' || emotion === 'focus') {
    return <path d="M103 191 Q120 188 137 191" fill="none" stroke="#682f3b" strokeWidth="3.5" strokeLinecap="round" />;
  }
  if (emotion === 'curious') {
    return <path d={`M102 191 Q117 ${194 + curve / 4} 139 187`} fill="none" stroke="#682f3b" strokeWidth="3.5" strokeLinecap="round" />;
  }
  return <path d="M103 190 Q120 193 137 190" fill="none" stroke="#682f3b" strokeWidth="3" strokeLinecap="round" />;
}

function StudioPortrait({
  avatar,
  emotion,
  intensity,
  motion,
  playing,
  speed,
}: {
  avatar: FacePreset;
  emotion: EmotionId;
  intensity: number;
  motion: AnimationId;
  playing: boolean;
  speed: number;
}) {
  const brows = BROW_PATHS[emotion];
  const eyeRy = emotion === 'surprise' ? 9 : emotion === 'sleepy' ? 3 : 6;
  const eyeRx = emotion === 'surprise' ? 6 : 5;
  const style = { '--studio-speed': `${speed}s` } as React.CSSProperties;
  const motionClass = playing && motion !== 'still' ? `studio-motion-${motion}` : '';

  return (
    <div className={`studio-portrait ${motionClass}`} style={style} aria-label={`${avatar.name} with a ${emotion} expression`} aria-live="polite" aria-atomic="true">
      <svg viewBox="0 0 240 286" className="studio-portrait-svg" role="img" aria-label={`${avatar.name}, stylized ${emotion} face`}>
        <defs>
          <linearGradient id="studio-face-shade" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={avatar.skin} />
            <stop offset="1" stopColor={avatar.skin} stopOpacity="0.84" />
          </linearGradient>
          <linearGradient id="studio-shirt-shade" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={avatar.accent} />
            <stop offset="1" stopColor={avatar.clothing} />
          </linearGradient>
        </defs>

        <path d="M35 286 C42 239 69 223 120 223 C171 223 198 239 205 286Z" fill="url(#studio-shirt-shade)" />
        <path d="M96 210 Q120 224 144 210 L151 250 Q120 268 89 250Z" fill={avatar.skin} />
        {getHairBack(avatar.hairStyle) && <path d={getHairBack(avatar.hairStyle)!} fill={avatar.hair} />}
        {avatar.hairStyle === 'bun' && <circle cx="121" cy="50" r="24" fill={avatar.hair} />}
        {avatar.hairStyle === 'curly' && (
          <g fill={avatar.hair}>
            <circle cx="66" cy="86" r="18" /><circle cx="88" cy="62" r="18" /><circle cx="113" cy="53" r="20" />
            <circle cx="141" cy="55" r="19" /><circle cx="166" cy="69" r="19" /><circle cx="184" cy="95" r="17" />
            <circle cx="53" cy="111" r="15" /><circle cx="188" cy="119" r="14" />
          </g>
        )}
        <ellipse cx="48" cy="150" rx="11" ry="19" fill={avatar.skin} />
        <ellipse cx="192" cy="150" rx="11" ry="19" fill={avatar.skin} />
        <ellipse
          cx="120"
          cy="145"
          rx={avatar.faceShape === 'round' ? 71 : avatar.faceShape === 'angular' ? 65 : 68}
          ry="89"
          fill="url(#studio-face-shade)"
        />
        {HAIR_FRONT[avatar.hairStyle] && <path d={HAIR_FRONT[avatar.hairStyle]} fill={avatar.hair} />}
        {avatar.hairStyle === 'locs' && (
          <g fill="none" stroke={avatar.hair} strokeWidth="7" strokeLinecap="round">
            <path d="M58 104 Q49 151 56 193" /><path d="M73 95 Q67 145 73 202" />
            <path d="M181 102 Q191 148 184 198" /><path d="M166 93 Q174 146 167 202" />
          </g>
        )}
        {avatar.hairStyle === 'bun' && <circle cx="121" cy="47" r="23" fill={avatar.hair} />}

        <path d={brows[0]} fill="none" stroke={avatar.hair} strokeWidth="4" strokeLinecap="round" />
        <path d={brows[1]} fill="none" stroke={avatar.hair} strokeWidth="4" strokeLinecap="round" />
        <g className="studio-eye-pair">
          <ellipse cx="96" cy="135" rx={eyeRx} ry={eyeRy} fill="#fffdf8" />
          <ellipse cx="144" cy="135" rx={eyeRx} ry={eyeRy} fill="#fffdf8" />
          {emotion !== 'sleepy' && (
            <>
              <circle cx="97" cy="136" r="3.5" fill={avatar.eye} />
              <circle cx="143" cy="136" r="3.5" fill={avatar.eye} />
              <circle cx="98" cy="135" r="1.1" fill="#fff" />
              <circle cx="144" cy="135" r="1.1" fill="#fff" />
            </>
          )}
          {emotion === 'sleepy' && (
            <g fill="none" stroke={avatar.hair} strokeWidth="3" strokeLinecap="round">
              <path d="M86 136 Q97 131 107 136" /><path d="M133 136 Q144 131 154 136" />
            </g>
          )}
        </g>
        <path d="M119 144 Q113 165 121 168" fill="none" stroke={avatar.skin} strokeOpacity="0.32" strokeWidth="3" strokeLinecap="round" />
        {(emotion === 'joy' || emotion === 'laugh' || emotion === 'confident') && (
          <g fill="#e98a82" opacity={0.12 + intensity / 380}>
            <ellipse cx="78" cy="171" rx="13" ry="7" /><ellipse cx="162" cy="171" rx="13" ry="7" />
          </g>
        )}
        {avatar.freckles && (
          <g fill="#9d604d" opacity="0.55">
            <circle cx="80" cy="169" r="1.5" /><circle cx="87" cy="174" r="1.2" /><circle cx="94" cy="170" r="1.4" />
            <circle cx="146" cy="170" r="1.4" /><circle cx="153" cy="174" r="1.2" /><circle cx="160" cy="169" r="1.5" />
          </g>
        )}
        {avatar.glasses && (
          <g fill="none" stroke="#334155" strokeWidth="3.5">
            <rect x="75" y="122" width="37" height="28" rx="9" />
            <rect x="128" y="122" width="37" height="28" rx="9" />
            <path d="M112 133 Q120 128 128 133 M75 132 L66 129 M165 132 L174 129" strokeLinecap="round" />
          </g>
        )}
        {avatar.earrings && (
          <g fill="none" stroke={avatar.accent} strokeWidth="3">
            <circle cx="47" cy="173" r="5" /><circle cx="193" cy="173" r="5" />
          </g>
        )}
        <g className="studio-jaw">
          <g className="studio-mouth">
            <Mouth emotion={emotion} intensity={intensity} />
          </g>
        </g>
        {playing && motion === 'chewing' && (
          <circle className="studio-gum-bubble" cx="151" cy="182" r="9" fill="#ffc9e2" stroke="#fff3fb" strokeWidth="2" />
        )}
        <path d="M81 261 Q120 280 159 261" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" />
      </svg>
      <span className="studio-portrait-tag">{avatar.name.toUpperCase()} · {emotion.toUpperCase()}</span>
    </div>
  );
}

export const FaceStudioView: React.FC = () => {
  const [avatarId, setAvatarId] = useState(FACE_PRESETS[0].id);
  const [emotion, setEmotion] = useState<EmotionId>('calm');
  const [motion, setMotion] = useState<AnimationId>('breathing');
  const [intensity, setIntensity] = useState(68);
  const [speed, setSpeed] = useState(3.2);
  const [playing, setPlaying] = useState(true);
  const avatar = FACE_PRESETS.find((face) => face.id === avatarId) || FACE_PRESETS[0];
  const emotionInfo = EMOTIONS.find((item) => item.id === emotion)!;
  const motionInfo = ANIMATIONS.find((item) => item.id === motion)!;

  const randomize = () => {
    const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
    setAvatarId(pick(FACE_PRESETS).id);
    setEmotion(pick(EMOTIONS).id);
    setMotion(pick(ANIMATIONS.filter((item) => item.id !== 'still')).id);
    setPlaying(true);
  };

  const exportPreset = () => {
    const data = {
      format: 'trill-face-studio-preset',
      version: 1,
      name: `${avatar.name} · ${emotionInfo.label} · ${motionInfo.label}`,
      avatar: {
        id: avatar.id,
        name: avatar.name,
        hairStyle: avatar.hairStyle,
        faceShape: avatar.faceShape,
        palette: {
          skin: avatar.skin,
          hair: avatar.hair,
          eyes: avatar.eye,
          accent: avatar.accent,
          clothing: avatar.clothing,
        },
        details: {
          glasses: Boolean(avatar.glasses),
          freckles: Boolean(avatar.freckles),
          earrings: Boolean(avatar.earrings),
        },
      },
      emotion: { id: emotion, label: emotionInfo.label, intensity },
      animation: { id: motion, label: motionInfo.label, durationSeconds: speed },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${avatar.id}-${emotion}-${motion}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="face-studio space-y-5" aria-labelledby="face-studio-title">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-600 dark:text-fuchsia-400">
            <Sparkles className="h-4 w-4" /> Creative modules · 01
          </div>
          <h1 id="face-studio-title" className="text-2xl font-bold tracking-tight sm:text-3xl">Face Studio</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Compose expressive stylized avatars, then preview a looping facial animation.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={randomize} className="studio-action-button">
            <RefreshCw className="h-4 w-4" /> Shuffle
          </button>
          <button type="button" onClick={exportPreset} className="studio-action-button studio-action-primary">
            <Download className="h-4 w-4" /> Export preset
          </button>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="studio-panel overflow-hidden" aria-label="Avatar preview">
          <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3 sm:px-5">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Animated preview</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Stylized character · no camera feed</p>
            </div>
            <span className="studio-status-pill">
              <span className={`studio-status-dot ${playing && motion !== 'still' ? 'is-active' : ''}`} />
              {playing && motion !== 'still' ? 'LOOP ACTIVE' : 'POSE HELD'}
            </span>
          </div>

          <div className="studio-stage">
            <div className="studio-stage-grid" aria-hidden="true" />
            <div className="studio-orbit studio-orbit-one" aria-hidden="true" />
            <div className="studio-orbit studio-orbit-two" aria-hidden="true" />
            <StudioPortrait
              avatar={avatar}
              emotion={emotion}
              intensity={intensity}
              motion={motion}
              playing={playing}
              speed={speed}
            />
            <div className="studio-stage-readout studio-readout-left">
              <span>SUBJECT</span><b>{avatar.name.toUpperCase()}</b>
            </div>
            <div className="studio-stage-readout studio-readout-right">
              <span>EXPRESSION</span><b>{emotionInfo.label.toUpperCase()}</b>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-white/5 p-3 sm:p-4">
            <div className="studio-stat"><span>PRESET</span><b>{FACE_PRESETS.findIndex((face) => face.id === avatar.id) + 1} / {FACE_PRESETS.length}</b></div>
            <div className="studio-stat"><span>EMOTION</span><b>{emotionInfo.label}</b></div>
            <div className="studio-stat"><span>MOTION</span><b>{motionInfo.label}</b></div>
          </div>
        </section>

        <div className="space-y-5">
          <section className="studio-panel p-4 sm:p-5" aria-labelledby="emotion-heading">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="studio-eyebrow">01 · Expression mixer</p>
                <h2 id="emotion-heading" className="mt-1 text-base font-semibold">Choose an emotion</h2>
              </div>
              <span className="studio-count">{EMOTIONS.length} states</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-5">
              {EMOTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setEmotion(item.id)}
                  aria-pressed={emotion === item.id}
                  title={item.note}
                  className={`studio-emotion-card ${emotion === item.id ? 'is-selected' : ''}`}
                >
                  <span aria-hidden="true" className="studio-emotion-symbol">{item.symbol}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <label htmlFor="studio-intensity" className="text-xs font-medium text-slate-600 dark:text-slate-400">Expression intensity</label>
              <span className="font-mono text-xs text-fuchsia-600 dark:text-fuchsia-300">{intensity}%</span>
            </div>
            <input
              id="studio-intensity"
              type="range"
              min="0"
              max="100"
              value={intensity}
              onChange={(event) => setIntensity(Number(event.target.value))}
              className="studio-range mt-2"
            />
          </section>

          <section className="studio-panel p-4 sm:p-5" aria-labelledby="motion-heading">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="studio-eyebrow">02 · Motion engine</p>
                <h2 id="motion-heading" className="mt-1 text-base font-semibold">Pick an animation loop</h2>
              </div>
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
                disabled={motion === 'still'}
                aria-label={motion === 'still' ? 'Still pose selected' : playing ? 'Pause animation' : 'Play animation'}
                className={`studio-play-button ${motion === 'still' ? 'is-disabled' : ''}`}
              >
                {motion === 'still' ? null : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                <span>{motion === 'still' ? 'Still' : playing ? 'Pause' : 'Play'}</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ANIMATIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMotion(item.id)}
                  aria-pressed={motion === item.id}
                  className={`studio-motion-card ${motion === item.id ? 'is-selected' : ''}`}
                >
                  <span className="studio-motion-icon" aria-hidden="true">{item.icon}</span>
                  <span className="min-w-0 text-left">
                    <b>{item.label}</b>
                    <small>{item.note}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <label htmlFor="studio-speed" className="text-xs font-medium text-slate-600 dark:text-slate-400">Loop duration</label>
              <span className="font-mono text-xs text-sky-600 dark:text-sky-300">{speed.toFixed(1)}s</span>
            </div>
            <input
              id="studio-speed"
              type="range"
              min="1"
              max="6"
              step="0.2"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="studio-range mt-2 studio-range-blue"
            />
          </section>
        </div>
      </div>

      <section className="studio-panel p-4 sm:p-5" aria-labelledby="preset-heading">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="studio-eyebrow">03 · Character library</p>
            <h2 id="preset-heading" className="mt-1 text-base font-semibold">Preset faces</h2>
          </div>
          <p className="text-xs text-slate-500">Eight original, stylized starting points</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {FACE_PRESETS.map((face, index) => (
            <button
              key={face.id}
              type="button"
              onClick={() => setAvatarId(face.id)}
              aria-pressed={avatarId === face.id}
              className={`studio-avatar-card ${avatarId === face.id ? 'is-selected' : ''}`}
            >
              <span className="studio-avatar-swatch" style={{ '--avatar-skin': face.skin, '--avatar-hair': face.hair } as React.CSSProperties}>
                <span className="studio-avatar-mini-hair" />
                <span className="studio-avatar-mini-eyes" />
                <span className="studio-avatar-mini-shirt" style={{ background: face.accent }} />
              </span>
              <span className="min-w-0 text-left">
                <b>{face.name}</b>
                <small>FACE {String(index + 1).padStart(2, '0')}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-2 rounded-2xl border border-sky-400/10 bg-sky-400/[0.04] px-4 py-3 text-xs text-slate-600 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span><b className="text-sky-700 dark:text-sky-300">Studio sandbox:</b> these are illustrative vector avatars, not enrolled people or camera footage.</span>
        <span className="font-mono text-[10px] tracking-wide text-slate-500">{FACE_PRESETS.length} FACES · {EMOTIONS.length} EXPRESSIONS · {ANIMATIONS.length} MOTIONS</span>
      </footer>
    </section>
  );
};
