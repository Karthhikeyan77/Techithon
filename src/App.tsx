import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { ArrowRight, Gavel, Monitor, ShieldCheck, Smartphone, Trophy } from 'lucide-react';
import {
  auth,
  googleAuthProvider,
  syncHostProfileToFirestore,
  testFirestoreConnection,
} from './lib/firebase.ts';
import { AudienceDisplay } from './components/AudienceDisplay.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { HostDashboard } from './components/HostDashboard.tsx';
import { TeamMobileView } from './components/TeamMobileView.tsx';

type ViewMode = 'landing' | 'team' | 'host' | 'audience';

function resolveInitialRoute(): { view: ViewMode; code: string } {
  const path = window.location.pathname.toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const code = (params.get('code') || '').toUpperCase();
  if (path.startsWith('/team')) return { view: 'team', code };
  if (path.startsWith('/audience')) return { view: 'audience', code };
  if (path.startsWith('/host')) return { view: 'host', code };
  return { view: 'landing', code };
}

export default function App() {
  const initial = resolveInitialRoute();
  const [view, setView] = useState<ViewMode>(initial.view);
  const [roomCodeParam, setRoomCodeParam] = useState<string>(initial.code);

  const [hostUser, setHostUser] = useState<User | null>(null);
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const [quickTeamCode, setQuickTeamCode] = useState(initial.code || 'TECH26');
  const [quickAudienceCode, setQuickAudienceCode] = useState(initial.code || 'TECH26');

  useEffect(() => {
    void testFirestoreConnection();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setHostUser(user);
      if (user) {
        try {
          const token = await user.getIdToken();
          setHostToken(token);
          if (user.email) {
            void syncHostProfileToFirestore(user.uid, user.email, user.displayName);
          }
        } catch {
          setHostToken(null);
        }
      } else {
        setHostToken(null);
      }
      setAuthReady(true);
    });

    const onPopState = () => {
      const next = resolveInitialRoute();
      setView(next.view);
      setRoomCodeParam(next.code);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Refresh Firebase ID token periodically while host session is active
  useEffect(() => {
    if (!hostUser) return;
    const id = setInterval(async () => {
      try {
        const fresh = await hostUser.getIdToken(true);
        setHostToken(fresh);
      } catch {
        // ignore transient refresh failure
      }
    }, 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [hostUser]);

  const navigate = (nextView: ViewMode, code = '') => {
    setView(nextView);
    setRoomCodeParam(code);
    const urlPath =
      nextView === 'landing'
        ? '/'
        : code
          ? `/${nextView}?code=${encodeURIComponent(code)}`
          : `/${nextView}`;
    window.history.pushState({}, '', urlPath);
  };

  const handleHostSignIn = async () => {
    setSigningIn(true);
    setAuthError('');
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const token = await cred.user.getIdToken();
      setHostUser(cred.user);
      setHostToken(token);
      if (cred.user.email) {
        void syncHostProfileToFirestore(cred.user.uid, cred.user.email, cred.user.displayName);
      }
      navigate('host');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed. Please try again.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleHostSignOut = async () => {
    await signOut(auth);
    setHostUser(null);
    setHostToken(null);
    navigate('landing');
  };

  return (
    <ErrorBoundary>
      {view === 'team' && (
        <TeamMobileView
          initialRoomCode={roomCodeParam}
          onExit={() => navigate('landing')}
        />
      )}

      {view === 'audience' && (
        <AudienceDisplay
          initialRoomCode={roomCodeParam}
          onExit={() => navigate('landing')}
        />
      )}

      {view === 'host' && (
        <>
          {!authReady ? (
            <div className="min-h-screen bg-[#08111F] flex items-center justify-center text-[#9BB0CA] text-sm">
              Verifying host session...
            </div>
          ) : hostUser && hostToken ? (
            <HostDashboard
              idToken={hostToken}
              hostEmail={hostUser.email || ''}
              hostName={hostUser.displayName || ''}
              onSignOut={handleHostSignOut}
              onOpenAudience={(code) => navigate('audience', code)}
              onExitPortal={() => navigate('landing')}
            />
          ) : (
            <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex items-center justify-center p-6">
              <div className="max-w-md w-full bg-[#111E31] border border-white/10 rounded-3xl p-8 space-y-6 shadow-2xl">
                <div className="space-y-2">
                  <p className="text-xs font-bold tracking-widest text-[#51D6E8] uppercase">
                    TECHITHON · Host Control Center
                  </p>
                  <h1 className="text-2xl font-bold text-[#EEF5FF]">Host Sign-In</h1>
                  <p className="text-sm text-[#9BB0CA] leading-relaxed">
                    Sign in with Google to create custom auction rooms, manage your question bank, and control live scoring.
                  </p>
                </div>

                {authError && (
                  <div className="p-3 rounded-xl bg-[#FF6B78]/15 border border-[#FF6B78]/40 text-sm text-[#FF6B78]">
                    {authError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={signingIn}
                  onClick={handleHostSignIn}
                  className="w-full py-3.5 px-5 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {signingIn ? 'Signing in...' : 'Sign in with Google'}
                </button>

                <button
                  type="button"
                  onClick={() => navigate('landing')}
                  className="w-full py-2.5 text-sm text-[#9BB0CA] hover:text-[#EEF5FF]"
                >
                  Return to Portal
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'landing' && (
        <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex flex-col">
          {/* Clean 3-Zone Top Bar */}
          <header className="border-b border-white/10 px-6 lg:px-10 py-4">
            <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
              <span className="font-display text-lg font-extrabold tracking-tight text-[#EEF5FF] whitespace-nowrap shrink-0">
                TECH AUCTION
              </span>

              <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#9BB0CA]">
                <button
                  type="button"
                  onClick={() => navigate('team', 'TECH26')}
                  className="hover:text-[#EEF5FF] transition-colors whitespace-nowrap shrink-0"
                >
                  Team Join
                </button>
                <button
                  type="button"
                  onClick={() => navigate('audience', 'TECH26')}
                  className="hover:text-[#EEF5FF] transition-colors whitespace-nowrap shrink-0"
                >
                  Projector View
                </button>
                <button
                  type="button"
                  onClick={() => navigate('host')}
                  className="hover:text-[#EEF5FF] transition-colors whitespace-nowrap shrink-0"
                >
                  Host Dashboard
                </button>
              </nav>

              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('host')}
                  className="px-4 py-2 rounded-xl bg-[#51D6E8] text-[#08111F] text-xs font-bold hover:opacity-90 whitespace-nowrap shrink-0"
                >
                  {hostUser ? 'Open Dashboard' : 'Host Sign In'}
                </button>
              </div>
            </div>
          </header>

          {/* Hero Section */}
          <main className="flex-1 max-w-6xl w-full mx-auto px-6 lg:px-10 py-10 lg:py-14 space-y-12">
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 space-y-5">
                <p className="text-xs font-bold tracking-widest text-[#51D6E8] uppercase">
                  TECHITHON – THE ULTIMATE TECH CHALLENGE
                </p>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[#EEF5FF] leading-[1.08] tracking-tight">
                  THINK. BID. CONQUER.
                </h1>
                <p className="text-base sm:text-lg text-[#9BB0CA] max-w-2xl leading-relaxed">
                  A live team-based technology auction platform built for college technical events.
                  Teams bid on hardware and tech concepts from their phones, win technical challenges,
                  and climb the real-time leaderboard.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => navigate('team', 'TECH26')}
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-sm hover:opacity-90"
                  >
                    <Smartphone className="w-4 h-4" />
                    Join Demo Room (TECH26)
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('host')}
                    className="inline-flex items-center gap-2 px-5 py-3.5 rounded-xl bg-[#111E31] border border-white/15 text-[#EEF5FF] font-semibold text-sm hover:border-[#51D6E8]"
                  >
                    <Gavel className="w-4 h-4 text-[#51D6E8]" />
                    Host Control Center
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded-2xl overflow-hidden border border-white/10 bg-[#111E31]">
                  <img
                    src="/src/assets/images/tech_raspberry_pi_1795603755543.jpg"
                    alt="Raspberry Pi auction item preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-48 object-cover"
                  />
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#111E31]">
                  <img
                    src="/src/assets/images/tech_arduino_uno_1795603756456.jpg"
                    alt="Arduino Uno auction item preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-32 object-cover"
                  />
                </div>
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-[#111E31]">
                  <img
                    src="/src/assets/images/tech_gpu_graphics_1795603756319.jpg"
                    alt="GPU hardware auction item preview"
                    referrerPolicy="no-referrer"
                    className="w-full h-32 object-cover"
                  />
                </div>
              </div>
            </section>

            {/* Three Role Portals */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Portal 1: Team Mobile */}
              <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 flex flex-col justify-between gap-5">
                <div className="space-y-2">
                  <Smartphone className="w-7 h-7 text-[#B9F36B]" />
                  <h2 className="text-xl font-bold text-[#EEF5FF]">Team Mobile Bidding</h2>
                  <p className="text-sm text-[#9BB0CA] leading-relaxed">
                    Join from any smartphone using your room code and team name to bid live and view your question.
                  </p>
                </div>
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={quickTeamCode}
                    onChange={(e) => setQuickTeamCode(e.target.value.toUpperCase())}
                    placeholder="Room Code (e.g. TECH26)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num font-bold text-[#51D6E8] focus:outline-none focus:border-[#51D6E8]"
                  />
                  <button
                    type="button"
                    onClick={() => navigate('team', quickTeamCode)}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-sm hover:opacity-90"
                  >
                    Enter as Team
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Portal 2: Host Dashboard */}
              <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 flex flex-col justify-between gap-5">
                <div className="space-y-2">
                  <ShieldCheck className="w-7 h-7 text-[#51D6E8]" />
                  <h2 className="text-xl font-bold text-[#EEF5FF]">Host Control Center</h2>
                  <p className="text-sm text-[#9BB0CA] leading-relaxed">
                    Create custom auction rooms, configure coin & timer rules, manage items, and judge answers live.
                  </p>
                </div>
                <div className="space-y-2.5">
                  <div className="px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-xs text-[#9BB0CA]">
                    {hostUser ? `Signed in as ${hostUser.email}` : 'Protected via Google Sign-In'}
                  </div>
                  <button
                    type="button"
                    onClick={() => (hostUser ? navigate('host') : void handleHostSignIn())}
                    disabled={signingIn}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {hostUser ? 'Open Host Dashboard' : signingIn ? 'Signing in...' : 'Sign In & Manage Event'}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Portal 3: Audience Display */}
              <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 flex flex-col justify-between gap-5">
                <div className="space-y-2">
                  <Monitor className="w-7 h-7 text-[#FFC857]" />
                  <h2 className="text-xl font-bold text-[#EEF5FF]">Audience / Projector</h2>
                  <p className="text-sm text-[#9BB0CA] leading-relaxed">
                    Full-screen live stage display showing objects, highest bids, countdowns, and real-time rankings.
                  </p>
                </div>
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={quickAudienceCode}
                    onChange={(e) => setQuickAudienceCode(e.target.value.toUpperCase())}
                    placeholder="Room Code (e.g. TECH26)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num font-bold text-[#FFC857] focus:outline-none focus:border-[#FFC857]"
                  />
                  <button
                    type="button"
                    onClick={() => navigate('audience', quickAudienceCode)}
                    className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-[#172740] border border-white/15 text-[#EEF5FF] font-bold text-sm hover:border-[#FFC857]"
                  >
                    Launch Stage Display
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>

            {/* Clear 3-Step Event Flow */}
            <section className="border-t border-white/10 pt-8 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
              <div className="space-y-1.5">
                <div className="text-xs font-mono-num text-[#51D6E8]">01. Configure & Launch</div>
                <h3 className="font-bold text-[#EEF5FF]">Custom Rooms in Minutes</h3>
                <p className="text-[#9BB0CA]">
                  Set starting coins, timers, bid increments, and custom tech items with private host answer keys.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-mono-num text-[#51D6E8]">02. Synchronized Bidding</div>
                <h3 className="font-bold text-[#EEF5FF]">Atomic Concurrency Engine</h3>
                <p className="text-[#9BB0CA]">
                  Server-authoritative timers and transactional bid locking ensure fair competition across 60+ phones.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-mono-num text-[#51D6E8]">03. Answer & Score</div>
                <h3 className="font-bold text-[#EEF5FF] flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-[#B9F36B]" />
                  Instant Rankings & CSV Export
                </h3>
                <p className="text-[#9BB0CA]">
                  Reveal questions to winners, score answers in one click, and export complete event standings.
                </p>
              </div>
            </section>
          </main>
        </div>
      )}
    </ErrorBoundary>
  );
}
