/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import {
  api,
  getGallery,
  flushPending,
  setSettings,
  setApiBearerToken,
  notifyGalleryChanged,
} from './trill/engine';
import {
  LiveRecognitionView,
  AnalyzePhotoView,
  PeopleView,
  RecognitionLogView,
  TrillSettingsView,
  ToastContainer,
  showToast,
} from './trill/TrillViews';
import {
  TrillAnalyticsDashboard,
  TrillOnboardingModal,
} from './trill/TrillDashboard';
import { FaceStudioView } from './trill/FaceStudio';
import {
  Camera,
  Image as ImageIcon,
  Users,
  ListOrdered,
  Settings,
  LayoutDashboard,
  Sparkles,
  Sun,
  Moon,
  LogIn,
  LogOut,
  Download,
  Wifi,
  WifiOff,
} from 'lucide-react';

type TrillTab = 'live' | 'upload' | 'people' | 'log' | 'dashboard' | 'studio' | 'settings';

const NAV_ITEMS: { id: TrillTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'live', label: 'Live', icon: Camera },
  { id: 'upload', label: 'Analyze', icon: ImageIcon },
  { id: 'people', label: 'People', icon: Users },
  { id: 'log', label: 'Log', icon: ListOrdered },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'studio', label: 'Studio', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TrillTab>('live');
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('trill.theme');
    return saved ? saved === 'dark' : true;
  });

  // Connectivity & Server status
  const [netState, setNetState] = useState<'online' | 'offline' | 'connecting'>('connecting');
  const [netLabel, setNetLabel] = useState('Connecting…');
  const [peerCount, setPeerCount] = useState(1);

  // Firebase Auth & Onboarding
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  // PWA Install Prompt
  const [installable, setInstallable] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsIdentityRef = useRef<{ token: string; displayName: string } | null>(null);

  // Sync theme with document root
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      localStorage.setItem('trill.theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('trill.theme', 'light');
    }
  }, [isDark]);

  // Register Service Worker & BeforeInstallPrompt
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            w?.addEventListener('statechange', () => {
              if (w.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('App updated. Reload for the latest version.', 'info');
              }
            });
          });
        })
        .catch(() => {
          // SW registration optional in dev iframe
        });
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      window.deferredInstallPrompt = e;
      setInstallable(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  // Hash Router sync (#/live, #/upload, #/people, #/log, #/dashboard, #/settings)
  useEffect(() => {
    const syncHash = () => {
      const raw = window.location.hash.replace(/^#\/?/, '').split('/')[0] as TrillTab;
      if (NAV_ITEMS.some((n) => n.id === raw)) {
        setActiveTab(raw);
      }
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const navigateTab = (tab: TrillTab) => {
    setActiveTab(tab);
    window.location.hash = `#/${tab}`;
  };

  // Connectivity check + Offline Gallery Warmup + Event Queue Flush
  useEffect(() => {
    const checkConnectivity = async () => {
      if (!navigator.onLine) {
        setNetState('offline');
        setNetLabel('Offline · cached gallery');
        setPeerCount(0);
        if (wsRef.current) {
          const ws = wsRef.current;
          wsRef.current = null;
          ws.close();
        }
        return;
      }
      try {
        const hl = await api.health();
        setNetState('online');
        setNetLabel('Online');
        const identity = wsIdentityRef.current;
        if (identity && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
          connectWebSocket(identity.token, identity.displayName);
        }
        if (hl.authRequired) {
          setActiveTab('settings');
          showToast('This server requires an API key. Enter it in Settings.', 'info');
        }
        const sent = await flushPending();
        if (sent) {
          showToast(`Synced ${sent} offline event${sent === 1 ? '' : 's'}`, 'success');
        }
      } catch {
        setNetState('offline');
        setNetLabel('Offline · cached gallery');
      }
    };

    checkConnectivity();
    getGallery().catch(() => {});

    window.addEventListener('online', checkConnectivity);
    window.addEventListener('offline', checkConnectivity);
    return () => {
      window.removeEventListener('online', checkConnectivity);
      window.removeEventListener('offline', checkConnectivity);
    };
  }, []);

  // Firebase Auth & JWT WebSocket Live Sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const token = await user.getIdToken();
          setApiBearerToken(token);

          // Check if user has a profile in Firestore; if not, offer quick onboarding
          const userRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            setShowOnboarding(true);
          }

          // Connect WebSocket with JWT
          connectWebSocket(token, user.displayName || user.email || 'Operator');
        } catch {
          // continue in local mode if Firestore/token fails
        }
      } else {
        setApiBearerToken(null);
        connectWebSocket('anonymous', 'Trill Device');
      }
    });
    return () => unsub();
  }, []);

  const connectWebSocket = (token: string, displayName: string) => {
    wsIdentityRef.current = { token, displayName };
    if (!navigator.onLine) return;
    if (wsRef.current) {
      const previous = wsRef.current;
      wsRef.current = null;
      previous.close();
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, displayName }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'auth_ack' || msg.type === 'presence_update') {
          if (Array.isArray(msg.peers)) {
            setPeerCount(Math.max(1, msg.peers.length));
          }
        } else if (msg.type === 'gallery_changed') {
          notifyGalleryChanged();
        }
      } catch {
        // ignore
      }
    };
  };

  const handleSignIn = async () => {
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Signed in successfully', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Sign-in cancelled', 'error');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    showToast('Signed out', 'info');
  };

  const handleCompleteOnboarding = async (opts: {
    detector: 'tiny' | 'ssd';
    threshold: number;
    theme: 'dark' | 'light';
  }) => {
    setSettings({ detector: opts.detector, threshold: opts.threshold });
    setIsDark(opts.theme === 'dark');
    setShowOnboarding(false);
    if (currentUser) {
      try {
        const nowIso = new Date().toISOString();
        await setDoc(doc(db, 'users', currentUser.uid), {
          uid: currentUser.uid,
          displayName: (currentUser.displayName || 'Trill User').slice(0, 80),
          organization: 'Trill Face Rec',
          jobTitle: 'Operator',
          role: 'admin',
          theme: opts.theme,
          onboardingCompleted: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } catch {
        // non-blocking
      }
    }
    showToast('Preferences saved', 'success');
  };

  const handleInstallClick = async () => {
    const deferred = window.deferredInstallPrompt;
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    window.deferredInstallPrompt = null;
    setInstallable(false);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 dark:bg-[#0a0f1c] text-slate-900 dark:text-[#e6edf8] font-sans selection:bg-sky-400 selection:text-slate-950">
      {/* Skip to Main Content Link for Keyboard Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-sky-400 focus:text-slate-950 focus:font-bold"
      >
        Skip to content
      </a>

      {/* Desktop Left Sidebar */}
      <aside className="hidden md:flex md:w-64 lg:w-68 shrink-0 flex-col justify-between bg-white dark:bg-[#101828] border-r border-slate-200 dark:border-[#24314d] p-4 select-none">
        <div className="space-y-6">
          {/* Brand Logo */}
          <div className="flex items-center gap-3 px-2 pt-1">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400 shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                <path
                  d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2"
                   fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="9" cy="10" r="1.2" fill="currentColor" />
                <circle cx="15" cy="10" r="1.2" fill="currentColor" />
                <path
                  d="M9 15c1.5 1.3 4.5 1.3 6 0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <span className="text-base tracking-tight text-slate-900 dark:text-slate-100">
                Trill <b className="font-bold text-sky-500 dark:text-sky-400">Face Rec</b>
              </span>
              <span className="block text-[11px] text-slate-400 dark:text-[#8b98b5]">
                On-Device Biometric PWA
              </span>
            </div>
          </div>

          {/* Primary Navigation */}
          <nav className="space-y-1" aria-label="Main">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTab(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-sky-500/15 text-sky-500 dark:text-sky-400 border border-sky-500/30'
                      : 'text-slate-600 dark:text-[#8b98b5] hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#141e33]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Connectivity, Theme, Install & Auth */}
        <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-[#24314d]">
          {installable && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-bold transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Install App
            </button>
          )}

          {/* Connectivity & Sync Status Pill */}
          <div className="flex items-center justify-between px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-[#141e33] border border-slate-200 dark:border-[#24314d]">
            <div className="flex items-center gap-2 min-w-0">
              {netState === 'online' ? (
                <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
              <span className="text-xs font-medium truncate text-slate-700 dark:text-slate-200">
                {netLabel}
              </span>
            </div>
            <span
              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#1b2742] text-slate-600 dark:text-[#8b98b5]"
              title="Connected devices in real-time sync"
            >
              {peerCount} dev
            </span>
          </div>

          {/* Account & Theme Row */}
          <div className="flex items-center justify-between gap-2">
            {currentUser ? (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-full bg-indigo-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {(currentUser.displayName || currentUser.email || 'U')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">
                    {currentUser.displayName || currentUser.email}
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-400"
                  >
                    <LogOut className="w-3 h-3" /> Sign out
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={handleSignIn}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#141e33] hover:bg-slate-200 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <LogIn className="w-3.5 h-3.5 text-sky-400" />
                {authBusy ? 'Signing in…' : 'Sign in'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsDark(!isDark)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-xl bg-slate-100 dark:bg-[#141e33] hover:bg-slate-200 dark:hover:bg-[#1b2742] border border-slate-200 dark:border-[#24314d] text-slate-700 dark:text-slate-200"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white dark:bg-[#101828] border-b border-slate-200 dark:border-[#24314d]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-400">
            <Camera className="w-4 h-4" />
          </div>
          <span className="text-sm tracking-tight">
            Trill <b className="font-bold text-sky-400">Face Rec</b>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
              netState === 'online'
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            {netLabel}
          </span>
          <button
            type="button"
            onClick={() => setIsDark(!isDark)}
            aria-label="Toggle theme"
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#141e33]"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
          {currentUser ? (
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#141e33] text-slate-400"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              aria-label="Sign in"
              className="p-1.5 rounded-lg bg-slate-100 dark:bg-[#141e33] text-sky-400"
            >
              <LogIn className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main
        id="main-content"
        className="flex-1 min-w-0 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 pb-24 md:pb-8"
      >
        {activeTab === 'live' && <LiveRecognitionView />}
        {activeTab === 'upload' && <AnalyzePhotoView />}
        {activeTab === 'people' && <PeopleView />}
        {activeTab === 'log' && <RecognitionLogView />}
        {activeTab === 'dashboard' && (
          <TrillAnalyticsDashboard onNavigate={(t) => navigateTab(t)} />
        )}
        {activeTab === 'studio' && <FaceStudioView />}
        {activeTab === 'settings' && <TrillSettingsView />}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-7 bg-white/95 dark:bg-[#101828]/95 backdrop-blur-md border-t border-slate-200 dark:border-[#24314d] px-1 py-1.5"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateTab(item.id)}
              className={`flex flex-col items-center justify-center py-1 rounded-lg text-[11px] font-semibold ${
                active ? 'text-sky-400' : 'text-slate-500 dark:text-[#8b98b5]'
              }`}
            >
              <Icon className="w-4 h-4 mb-0.5" />
              <span className="truncate max-w-full px-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <TrillOnboardingModal
        open={showOnboarding}
        displayName={currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Operator'}
        onComplete={handleCompleteOnboarding}
        onSkip={() => setShowOnboarding(false)}
      />

      <ToastContainer />
    </div>
  );
}
