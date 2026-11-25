import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ArrowDown,
  ArrowUp,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Coins,
  Copy,
  Download,
  Edit3,
  Eye,
  Gavel,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Pause,
  Play,
  Plus,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  Shuffle,
  SlidersHorizontal,
  Square,
  Trash2,
  Trophy,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react';
import type {
  HostAuctionItem,
  LeaderboardEntry,
  QuestionBankItem,
  RoomConfig,
  RoomSnapshotHost,
} from '../types/auction.ts';
import {
  apiHostCreateBankItem,
  apiHostDeleteBankItem,
  apiHostDeleteRoom,
  apiHostDuplicateBankItem,
  apiHostGetRoom,
  apiHostImportBankCsv,
  apiHostListQuestionBank,
  apiHostListRooms,
  apiHostResetDemo,
  apiHostUpdateBankItem,
  apiHostUpdateRoom,
  exportQuestionBankCsv,
  hostFetch,
  parseCsvToItems,
  playAuctionCue,
} from '../lib/api.ts';
import { syncArchiveToFirestore, syncQuestionBankItemToFirestore, syncRoomToFirestore } from '../lib/firestoreSync.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { CountdownClock } from './CountdownClock.tsx';
import { CreateRoomWizard } from './CreateRoomWizard.tsx';
import { ItemFormModal, type ItemDraft } from './ItemFormModal.tsx';
import { LeaderboardPanel } from './LeaderboardPanel.tsx';
import { TechImage } from './TechImage.tsx';

type NavKey =
  | 'dashboard'
  | 'create-room'
  | 'my-rooms'
  | 'live-auction'
  | 'teams'
  | 'question-bank'
  | 'leaderboard'
  | 'history'
  | 'settings';

const NAV_ITEMS: Array<{ key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'create-room', label: 'Create Room', icon: PlusCircle },
  { key: 'my-rooms', label: 'My Rooms', icon: SlidersHorizontal },
  { key: 'live-auction', label: 'Live Auction', icon: Gavel },
  { key: 'teams', label: 'Teams', icon: Users },
  { key: 'question-bank', label: 'Question & Item Bank', icon: BookOpen },
  { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { key: 'history', label: 'Auction History', icon: History },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

interface HostDashboardProps {
  idToken: string;
  hostEmail: string;
  hostName: string;
  onSignOut: () => void;
  onOpenAudience: (roomCode: string) => void;
  onExitPortal: () => void;
}

export function HostDashboard({
  idToken,
  hostEmail,
  hostName,
  onSignOut,
  onOpenAudience,
  onExitPortal,
}: HostDashboardProps) {
  const [activeNav, setActiveNav] = useState<NavKey>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [rooms, setRooms] = useState<Array<RoomConfig & { itemsCount: number; teamsCount: number }>>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<RoomSnapshotHost | null>(null);
  const [questionBank, setQuestionBank] = useState<QuestionBankItem[]>([]);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Modals
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'danger' | 'warning';
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [editingBankItem, setEditingBankItem] = useState<QuestionBankItem | null>(null);
  const [previewItem, setPreviewItem] = useState<{
    name: string;
    category: string;
    difficulty: string;
    description: string;
    imageUrl: string;
    emoji: string;
    startingBid: number;
    question: string;
    correctAnswer: string;
    explanation: string;
  } | null>(null);

  const [addRoomItemModalOpen, setAddRoomItemModalOpen] = useState(false);
  const [selectedTeamDetail, setSelectedTeamDetail] = useState<LeaderboardEntry | null>(null);
  const [coinDeltaInput, setCoinDeltaInput] = useState<Record<string, number>>({});
  const [editingRoomModal, setEditingRoomModal] = useState<RoomConfig | null>(null);

  // Filters in Question Bank & Teams
  const [bankSearch, setBankSearch] = useState('');
  const [bankCategory, setBankCategory] = useState('ALL');
  const [bankDifficulty, setBankDifficulty] = useState('ALL');
  const [teamSearch, setTeamSearch] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const prevBidCountRef = useRef(0);

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((curr) => (curr?.text === text ? null : curr));
    }, 3500);
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const [roomsRes, bankRes] = await Promise.all([
        apiHostListRooms(idToken),
        apiHostListQuestionBank(idToken),
      ]);
      setRooms(roomsRes.rooms);
      setQuestionBank(bankRes.items);
      setSelectedRoomId((prev) => {
        if (prev && roomsRes.rooms.some((r) => r.id === prev)) return prev;
        return roomsRes.rooms[0]?.id || '';
      });
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [idToken, showToast]);

  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  const applySnapshot = useCallback(
    (snap: RoomSnapshotHost) => {
      setSnapshot(snap);
      setServerOffsetMs(snap.serverNow - Date.now());
      if (soundEnabled && snap.recentBids.length > prevBidCountRef.current && snap.liveState.phase === 'BIDDING_OPEN') {
        playAuctionCue('bid');
      }
      prevBidCountRef.current = snap.recentBids.length;
    },
    [soundEnabled]
  );

  // Load selected room snapshot + Socket.IO connection
  useEffect(() => {
    if (!selectedRoomId) return;
    let cancelled = false;

    apiHostGetRoom(idToken, selectedRoomId)
      .then((snap) => {
        if (!cancelled) applySnapshot(snap);
      })
      .catch((err) => {
        if (!cancelled) showToast('err', err instanceof Error ? err.message : 'Failed to load room');
      });

    const socket = io({
      auth: { role: 'host', token: idToken, roomId: selectedRoomId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('room:sync');
    });

    socket.on('room:state', (snap: RoomSnapshotHost) => {
      if (!cancelled) applySnapshot(snap);
    });

    return () => {
      cancelled = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [idToken, selectedRoomId, applySnapshot, showToast]);

  const runLiveAction = async (path: string, body?: unknown, successMsg?: string) => {
    if (!selectedRoomId) return;
    setActionBusy(true);
    try {
      const snap = await hostFetch<RoomSnapshotHost>(idToken, `/api/rooms/${selectedRoomId}${path}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      applySnapshot(snap);
      if (successMsg) showToast('ok', successMsg);
      if (path.includes('end-event')) {
        const top = snap.teams[0];
        void syncArchiveToFirestore({
          room: snap.room,
          winnerTeamName: top?.name,
          winnerPoints: top?.points,
          totalTeams: snap.teams.length,
          totalItems: snap.items.length,
        });
      }
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  const handleScore = async (outcome: 'CORRECT' | 'INCORRECT' | 'UNANSWERED') => {
    if (!snapshot?.currentItem) return;
    if (soundEnabled) {
      playAuctionCue(outcome === 'CORRECT' ? 'correct' : 'incorrect');
    }
    await runLiveAction(
      '/live/score',
      { itemId: snapshot.currentItem.id, outcome },
      outcome === 'CORRECT' ? 'Marked Correct · Points awarded!' : 'Marked Incorrect · Deduction applied'
    );
  };

  const handleMoveItem = async (idx: number, dir: -1 | 1) => {
    if (!snapshot) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= snapshot.items.length) return;
    const copy = [...snapshot.items];
    [copy[idx], copy[nextIdx]] = [copy[nextIdx], copy[idx]];
    setActionBusy(true);
    try {
      const snap = await hostFetch<RoomSnapshotHost>(idToken, `/api/rooms/${snapshot.room.id}/items/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedItemIds: copy.map((it) => it.id) }),
      });
      applySnapshot(snap);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Reorder failed');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = parseCsvToItems(String(reader.result));
        if (parsed.length === 0) {
          showToast('err', 'No valid rows found in CSV.');
          return;
        }
        const res = await apiHostImportBankCsv(idToken, parsed);
        res.items.forEach((it) => void syncQuestionBankItemToFirestore(it));
        await refreshLists();
        showToast('ok', `Imported ${res.importedCount} items into Question Bank.`);
      } catch (err) {
        showToast('err', err instanceof Error ? err.message : 'CSV import failed');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDownloadCsv = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportRoomResults = async () => {
    if (!snapshot) return;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(snapshot.room.id)}/export-csv`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const text = await res.text();
      handleDownloadCsv(`tech-auction-${snapshot.room.code.toLowerCase()}-results.csv`, text);
      showToast('ok', 'Results CSV downloaded.');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Failed to export CSV');
    }
  };

  // Filtered Question Bank
  const bankCategories = useMemo(
    () => ['ALL', ...Array.from(new Set(questionBank.map((i) => i.category)))],
    [questionBank]
  );

  const filteredBank = useMemo(() => {
    const q = bankSearch.trim().toLowerCase();
    return questionBank.filter((it) => {
      if (bankCategory !== 'ALL' && it.category !== bankCategory) return false;
      if (bankDifficulty !== 'ALL' && it.difficulty !== bankDifficulty) return false;
      if (q && !it.name.toLowerCase().includes(q) && !it.question.toLowerCase().includes(q) && !it.category.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [questionBank, bankSearch, bankCategory, bankDifficulty]);

  const filteredTeams = useMemo(() => {
    if (!snapshot) return [];
    const q = teamSearch.trim().toLowerCase();
    if (!q) return snapshot.teams;
    return snapshot.teams.filter((t) => t.name.toLowerCase().includes(q));
  }, [snapshot, teamSearch]);

  const copyRoomCode = (code: string) => {
    void navigator.clipboard?.writeText(code);
    showToast('ok', `Room code ${code} copied to clipboard`);
  };

  return (
    <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex">
      {/* Sidebar Desktop + Mobile Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#111E31] border-r border-white/10 flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold tracking-widest text-[#51D6E8] uppercase">TECHITHON</div>
              <div className="text-lg font-extrabold text-[#EEF5FF]">TECH AUCTION</div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-[#9BB0CA] hover:text-[#EEF5FF]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setActiveNav(item.key);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#172740] text-[#51D6E8] border border-[#51D6E8]/30'
                      : 'text-[#9BB0CA] hover:text-[#EEF5FF] hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="text-xs">
            <p className="font-semibold text-[#EEF5FF] truncate">{hostName || 'Event Host'}</p>
            <p className="text-[#9BB0CA] truncate">{hostEmail}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onExitPortal}
              className="flex-1 px-3 py-2 rounded-xl border border-white/10 text-xs font-medium text-[#9BB0CA] hover:text-[#EEF5FF]"
            >
              Portal
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs font-medium text-[#FF6B78] hover:bg-[#FF6B78]/10"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-[#08111F]/90 backdrop-blur-md border-b border-white/10 px-4 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-white/10 text-[#EEF5FF]"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs text-[#9BB0CA] hidden sm:inline">Active Room:</span>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#111E31] border border-white/10 text-sm font-medium text-[#EEF5FF] max-w-[240px] sm:max-w-xs truncate focus:outline-none focus:border-[#51D6E8]"
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code}){r.isDemo ? ' · Demo' : ''}
                  </option>
                ))}
              </select>
              {snapshot && (
                <button
                  type="button"
                  onClick={() => copyRoomCode(snapshot.room.code)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#172740] border border-white/10 text-xs font-mono-num font-bold text-[#51D6E8] hover:border-[#51D6E8]/50 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {snapshot.room.code}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {snapshot && (
              <button
                type="button"
                onClick={() => onOpenAudience(snapshot.room.code)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#172740] border border-[#51D6E8]/30 text-xs font-semibold text-[#51D6E8] hover:bg-[#51D6E8]/10 whitespace-nowrap"
              >
                <Monitor className="w-4 h-4" />
                <span className="hidden sm:inline">Projector View</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveNav('create-room')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#B9F36B] text-[#08111F] text-xs font-bold hover:opacity-90 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              New Room
            </button>
          </div>
        </header>

        {/* Toast Banner */}
        {toast && (
          <div className="px-4 lg:px-8 pt-4">
            <div
              className={`p-3.5 rounded-xl border text-sm font-medium ${
                toast.type === 'ok'
                  ? 'bg-[#B9F36B]/15 border-[#B9F36B]/40 text-[#B9F36B]'
                  : 'bg-[#FF6B78]/15 border-[#FF6B78]/40 text-[#FF6B78]'
              }`}
            >
              {toast.text}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-[#111E31] border border-white/10 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* 1. DASHBOARD */}
              {activeNav === 'dashboard' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h1 className="text-2xl font-bold text-[#EEF5FF]">Host Command Dashboard</h1>
                      <p className="text-sm text-[#9BB0CA]">
                        TECHITHON – THE ULTIMATE TECH CHALLENGE · Manage rooms, live bidding, and team scoring.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-5">
                      <p className="text-xs text-[#9BB0CA]">My Rooms</p>
                      <p className="text-3xl font-bold font-mono-num text-[#EEF5FF] mt-1">{rooms.length}</p>
                    </div>
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-5">
                      <p className="text-xs text-[#9BB0CA]">Joined Teams (Active Room)</p>
                      <p className="text-3xl font-bold font-mono-num text-[#51D6E8] mt-1">
                        {snapshot?.teams.length ?? 0}
                      </p>
                    </div>
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-5">
                      <p className="text-xs text-[#9BB0CA]">Room Items Queued</p>
                      <p className="text-3xl font-bold font-mono-num text-[#B9F36B] mt-1">
                        {snapshot?.itemsCount ?? 0}
                      </p>
                    </div>
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-5">
                      <p className="text-xs text-[#9BB0CA]">Question Bank</p>
                      <p className="text-3xl font-bold font-mono-num text-[#FFC857] mt-1">
                        {questionBank.length}
                      </p>
                    </div>
                  </div>

                  {snapshot && (
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                      <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-[#51D6E8] uppercase tracking-wider">
                          {snapshot.room.isDemo ? 'Sample Demo Room (Isolated)' : 'Selected Room'} · {snapshot.room.status}
                        </div>
                        <h2 className="text-xl font-bold text-[#EEF5FF]">{snapshot.room.name}</h2>
                        <p className="text-sm text-[#9BB0CA]">
                          Room Code: <strong className="font-mono-num text-[#EEF5FF]">{snapshot.room.code}</strong> ·{' '}
                          {snapshot.room.startingCoins} starting coins · {snapshot.room.auctionDurationSec}s auction ·{' '}
                          +{snapshot.room.correctPoints} pts / -{snapshot.room.incorrectDeduction} coins
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => setActiveNav('live-auction')}
                          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-sm hover:opacity-90"
                        >
                          <Gavel className="w-4 h-4" />
                          Open Live Auction
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenAudience(snapshot.room.code)}
                          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#172740] border border-white/15 text-sm font-semibold text-[#EEF5FF] hover:border-[#51D6E8]"
                        >
                          <Monitor className="w-4 h-4 text-[#51D6E8]" />
                          Audience Display
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setActiveNav('create-room')}
                      className="text-left p-6 rounded-2xl bg-[#111E31] border border-white/10 hover:border-[#51D6E8]/50 transition-colors space-y-2"
                    >
                      <PlusCircle className="w-7 h-7 text-[#51D6E8]" />
                      <h3 className="text-lg font-bold text-[#EEF5FF]">Create Custom Auction Room</h3>
                      <p className="text-sm text-[#9BB0CA]">
                        Configure coins, timers, scoring penalties, and add custom technology objects in 6 easy steps.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveNav('question-bank')}
                      className="text-left p-6 rounded-2xl bg-[#111E31] border border-white/10 hover:border-[#B9F36B]/50 transition-colors space-y-2"
                    >
                      <BookOpen className="w-7 h-7 text-[#B9F36B]" />
                      <h3 className="text-lg font-bold text-[#EEF5FF]">Manage Question & Item Bank</h3>
                      <p className="text-sm text-[#9BB0CA]">
                        Build reusable objects, import or export via CSV, and deploy items into any room.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {/* 2. CREATE ROOM */}
              {activeNav === 'create-room' && (
                <CreateRoomWizard
                  idToken={idToken}
                  questionBank={questionBank}
                  onCreated={(newSnap) => {
                    void refreshLists();
                    setSelectedRoomId(newSnap.room.id);
                    applySnapshot(newSnap);
                    setActiveNav('live-auction');
                    showToast('ok', `Room "${newSnap.room.name}" (${newSnap.room.code}) created!`);
                  }}
                />
              )}

              {/* 3. MY ROOMS */}
              {activeNav === 'my-rooms' && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-[#EEF5FF]">My Auction Rooms</h2>
                      <p className="text-sm text-[#9BB0CA]">
                        Manage custom rooms and the isolated Sample Demo Room.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveNav('create-room')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Create Room
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {rooms.map((r) => (
                      <div
                        key={r.id}
                        className={`rounded-2xl border p-5 space-y-4 ${
                          r.id === selectedRoomId
                            ? 'bg-[#172740]/70 border-[#51D6E8]/50'
                            : 'bg-[#111E31] border-white/10'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-[#9BB0CA]">
                              {r.isDemo ? 'Sample Demo Data' : 'Custom Room'} · {r.status} · Code{' '}
                              <span className="font-mono-num font-bold text-[#51D6E8]">{r.code}</span>
                            </div>
                            <h3 className="text-lg font-bold text-[#EEF5FF] mt-1 truncate">{r.name}</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyRoomCode(r.code)}
                            className="p-2 rounded-lg bg-[#08111F] border border-white/10 text-[#51D6E8]"
                            title="Copy room code"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-xs bg-[#08111F] p-3 rounded-xl border border-white/5">
                          <div>
                            <span className="text-[#9BB0CA] block">Teams</span>
                            <span className="font-mono-num font-bold text-[#EEF5FF]">
                              {r.teamsCount}/{r.maxTeams}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#9BB0CA] block">Items</span>
                            <span className="font-mono-num font-bold text-[#EEF5FF]">{r.itemsCount}</span>
                          </div>
                          <div>
                            <span className="text-[#9BB0CA] block">Coins</span>
                            <span className="font-mono-num font-bold text-[#51D6E8]">{r.startingCoins}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRoomId(r.id);
                              setActiveNav('live-auction');
                            }}
                            className="flex-1 px-3 py-2 rounded-xl bg-[#51D6E8] text-[#08111F] text-xs font-bold hover:opacity-90"
                          >
                            Control Room
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingRoomModal(r)}
                            className="px-3 py-2 rounded-xl bg-[#08111F] border border-white/10 text-xs font-medium text-[#EEF5FF] hover:border-[#51D6E8]"
                          >
                            <Edit3 className="w-3.5 h-3.5 inline mr-1" />
                            Edit Settings
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenAudience(r.code)}
                            className="px-3 py-2 rounded-xl bg-[#08111F] border border-white/10 text-xs font-medium text-[#EEF5FF] hover:border-[#51D6E8]"
                          >
                            Projector
                          </button>
                          {!r.isDemo && (
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmState({
                                  open: true,
                                  title: `Delete "${r.name}"?`,
                                  description: 'This permanently deletes the room, teams, bids, and auction history.',
                                  confirmLabel: 'Delete Room',
                                  variant: 'danger',
                                  onConfirm: async () => {
                                    await apiHostDeleteRoom(idToken, r.id);
                                    setConfirmState(null);
                                    await refreshLists();
                                    showToast('ok', 'Room deleted.');
                                  },
                                })
                              }
                              className="p-2 rounded-xl border border-white/10 text-[#9BB0CA] hover:text-[#FF6B78]"
                              aria-label="Delete room"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. LIVE AUCTION */}
              {activeNav === 'live-auction' && snapshot && (
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                  {/* Left: Item Queue */}
                  <div className="xl:col-span-4 space-y-4">
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-bold text-[#EEF5FF]">
                          Auction Queue ({snapshot.items.length})
                        </h3>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => void runLiveAction('/items/randomize', undefined, 'Pending items randomized')}
                            className="p-2 rounded-lg bg-[#08111F] border border-white/10 text-[#9BB0CA] hover:text-[#51D6E8]"
                            title="Randomize pending order"
                          >
                            <Shuffle className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddRoomItemModalOpen(true)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#51D6E8] text-[#08111F] text-xs font-bold"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Item
                          </button>
                        </div>
                      </div>

                      {snapshot.items.length === 0 ? (
                        <div className="p-6 text-center text-sm text-[#9BB0CA] bg-[#08111F] rounded-xl border border-dashed border-white/10">
                          No items in this room yet. Click <strong>Add Item</strong> above.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                          {snapshot.items.map((item: HostAuctionItem, idx) => {
                            const isCurrent = snapshot.liveState.currentItemId === item.id;
                            const isScored = item.status === 'SCORED';
                            return (
                              <div
                                key={item.id}
                                className={`p-3 rounded-xl border transition-colors ${
                                  isCurrent
                                    ? 'bg-[#172740] border-[#51D6E8]'
                                    : isScored
                                      ? 'bg-[#08111F]/60 border-white/5 opacity-65'
                                      : 'bg-[#08111F] border-white/10'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    disabled={isScored || actionBusy}
                                    onClick={() => void runLiveAction('/live/select-item', { itemId: item.id })}
                                    className="flex-1 text-left min-w-0"
                                  >
                                    <div className="text-xs text-[#9BB0CA]">
                                      #{idx + 1} · {item.status} · {item.startingBid} coins
                                    </div>
                                    <div className="text-sm font-semibold text-[#EEF5FF] truncate">
                                      {item.emoji} {item.name}
                                    </div>
                                  </button>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => void handleMoveItem(idx, -1)}
                                      disabled={idx === 0 || actionBusy}
                                      className="p-1 text-[#9BB0CA] hover:text-[#EEF5FF] disabled:opacity-30"
                                      title="Move up"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleMoveItem(idx, 1)}
                                      disabled={idx === snapshot.items.length - 1 || actionBusy}
                                      className="p-1 text-[#9BB0CA] hover:text-[#EEF5FF] disabled:opacity-30"
                                      title="Move down"
                                    >
                                      <ArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                    {!isScored && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          setActionBusy(true);
                                          try {
                                            const snap = await hostFetch<RoomSnapshotHost>(
                                              idToken,
                                              `/api/rooms/${snapshot.room.id}/items/${item.id}`,
                                              { method: 'DELETE' }
                                            );
                                            applySnapshot(snap);
                                          } catch (err) {
                                            showToast('err', err instanceof Error ? err.message : 'Remove failed');
                                          } finally {
                                            setActionBusy(false);
                                          }
                                        }}
                                        className="p-1 text-[#9BB0CA] hover:text-[#FF6B78]"
                                        title="Remove from room"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Live Control Stage */}
                  <div className="xl:col-span-8 space-y-5">
                    {snapshot.liveState.phase === 'EVENT_ENDED' ? (
                      <div className="bg-[#111E31] border border-[#B9F36B]/30 rounded-2xl p-8 text-center space-y-4">
                        <Trophy className="w-12 h-12 text-[#B9F36B] mx-auto" />
                        <h2 className="text-2xl font-bold text-[#EEF5FF]">Event Completed!</h2>
                        <p className="text-sm text-[#9BB0CA]">
                          All final rankings and auction logs are ready in Auction History.
                        </p>
                        <div className="flex justify-center gap-3">
                          <button
                            type="button"
                            onClick={() => setActiveNav('history')}
                            className="px-5 py-2.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
                          >
                            View Final Results
                          </button>
                          <button
                            type="button"
                            onClick={handleExportRoomResults}
                            className="px-5 py-2.5 rounded-xl bg-[#172740] border border-white/10 text-sm font-semibold text-[#EEF5FF]"
                          >
                            Export CSV
                          </button>
                        </div>
                      </div>
                    ) : !snapshot.currentItem ? (
                      <div className="bg-[#111E31] border border-white/10 rounded-2xl p-10 text-center space-y-3">
                        <Gavel className="w-10 h-10 text-[#51D6E8] mx-auto" />
                        <h3 className="text-xl font-bold text-[#EEF5FF]">Select an Item to Begin</h3>
                        <p className="text-sm text-[#9BB0CA]">
                          Pick an item from the queue on the left or add a new item to start the auction.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Current Item + Live Timers + Highest Bid */}
                        <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 space-y-5">
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                            <TechImage
                              imageUrl={snapshot.currentItem.imageUrl}
                              emoji={snapshot.currentItem.emoji}
                              name={snapshot.currentItem.name}
                              category={snapshot.currentItem.category}
                              className="md:col-span-5 w-full aspect-[4/3] rounded-xl border border-white/10"
                            />
                            <div className="md:col-span-7 flex flex-col justify-between gap-4">
                              <div className="space-y-1.5">
                                <div className="text-xs font-medium text-[#51D6E8]">
                                  Phase: {snapshot.liveState.phase.replace(/_/g, ' ')} · Item {snapshot.itemIndex} of{' '}
                                  {snapshot.itemsCount}
                                </div>
                                <h2 className="text-2xl font-bold text-[#EEF5FF]">{snapshot.currentItem.name}</h2>
                                <p className="text-sm text-[#9BB0CA]">{snapshot.currentItem.description}</p>
                              </div>

                              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#08111F] border border-white/10">
                                <div>
                                  <p className="text-xs text-[#9BB0CA]">Highest Bid</p>
                                  <p className="text-2xl font-bold font-mono-num text-[#FFC857]">
                                    {snapshot.liveState.currentHighestBid > 0
                                      ? `${snapshot.liveState.currentHighestBid} coins`
                                      : `Start: ${Math.max(snapshot.room.minBid, snapshot.currentItem.startingBid)}`}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs text-[#9BB0CA]">Leading Team</p>
                                  <p className="text-lg font-bold text-[#B9F36B] truncate">
                                    {snapshot.liveState.highestBidderTeamName || '—'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {(snapshot.liveState.phase === 'BIDDING_OPEN' ||
                            snapshot.liveState.phase === 'BIDDING_PAUSED') && (
                            <CountdownClock
                              deadlineAt={snapshot.liveState.auctionDeadlineAt}
                              remainingMsWhenPaused={snapshot.liveState.auctionRemainingMs}
                              totalDurationSec={snapshot.room.auctionDurationSec}
                              serverOffsetMs={serverOffsetMs}
                              isPaused={snapshot.liveState.phase === 'BIDDING_PAUSED'}
                              label="Auction Timer"
                            />
                          )}

                          {(snapshot.liveState.phase === 'QUESTION_ACTIVE' ||
                            snapshot.liveState.phase === 'QUESTION_PAUSED' ||
                            snapshot.liveState.phase === 'QUESTION_TIMEOUT') && (
                            <CountdownClock
                              deadlineAt={snapshot.liveState.answerDeadlineAt}
                              remainingMsWhenPaused={snapshot.liveState.answerRemainingMs}
                              totalDurationSec={
                                snapshot.currentItem.timeLimitOverrideSec ?? snapshot.room.answerDurationSec
                              }
                              serverOffsetMs={serverOffsetMs}
                              isPaused={snapshot.liveState.phase === 'QUESTION_PAUSED'}
                              label="Answer Timer"
                            />
                          )}

                          {/* Host Primary Controls */}
                          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/10">
                            {snapshot.liveState.phase === 'ITEM_PREVIEW' && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void runLiveAction('/live/start-bidding', undefined, 'Bidding started!')}
                                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-sm hover:opacity-90"
                              >
                                <Play className="w-4 h-4" />
                                START BIDDING
                              </button>
                            )}

                            {(snapshot.liveState.phase === 'BIDDING_OPEN' ||
                              snapshot.liveState.phase === 'QUESTION_ACTIVE') && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void runLiveAction('/live/pause')}
                                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#FFC857] text-[#08111F] font-bold text-sm"
                              >
                                <Pause className="w-4 h-4" />
                                Pause Timer
                              </button>
                            )}

                            {(snapshot.liveState.phase === 'BIDDING_PAUSED' ||
                              snapshot.liveState.phase === 'QUESTION_PAUSED') && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void runLiveAction('/live/resume')}
                                className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
                              >
                                <Play className="w-4 h-4" />
                                Resume Timer
                              </button>
                            )}

                            {(snapshot.liveState.phase === 'BIDDING_OPEN' ||
                              snapshot.liveState.phase === 'BIDDING_PAUSED') && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void runLiveAction('/live/close-bidding', undefined, 'Bidding closed')}
                                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#172740] border border-white/15 text-[#EEF5FF] font-semibold text-sm hover:border-[#FF6B78]"
                              >
                                <Square className="w-4 h-4 text-[#FF6B78]" />
                                Close Bidding Now
                              </button>
                            )}

                            {snapshot.liveState.phase === 'BIDDING_CLOSED' &&
                              snapshot.liveState.highestBidderTeamId && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    void runLiveAction('/live/reveal-question', undefined, 'Question revealed!')
                                  }
                                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
                                >
                                  <Eye className="w-4 h-4" />
                                  REVEAL QUESTION & START ANSWER TIMER
                                </button>
                              )}

                            {snapshot.liveState.phase === 'BIDDING_CLOSED' &&
                              !snapshot.liveState.highestBidderTeamId && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void runLiveAction('/live/skip-no-bids', undefined, 'Recorded no bids')}
                                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#172740] border border-white/15 text-sm font-semibold text-[#EEF5FF]"
                                >
                                  Record No Bids & Continue
                                </button>
                              )}

                            {(snapshot.liveState.phase === 'QUESTION_ACTIVE' ||
                              snapshot.liveState.phase === 'QUESTION_PAUSED' ||
                              snapshot.liveState.phase === 'QUESTION_TIMEOUT') && (
                              <>
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleScore('CORRECT')}
                                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#B9F36B] text-[#08111F] font-extrabold text-sm hover:opacity-90 disabled:opacity-50"
                                >
                                  <CheckCircle2 className="w-5 h-5" />
                                  MARK CORRECT (+{snapshot.room.correctPoints} PTS)
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleScore('INCORRECT')}
                                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#FF6B78] text-[#08111F] font-extrabold text-sm hover:opacity-90 disabled:opacity-50"
                                >
                                  <XCircle className="w-5 h-5" />
                                  MARK INCORRECT (-{snapshot.room.incorrectDeduction} COINS)
                                </button>
                              </>
                            )}

                            {snapshot.liveState.phase === 'SCORED' && (
                              <button
                                type="button"
                                disabled={actionBusy}
                                onClick={() => void runLiveAction('/live/next-item')}
                                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
                              >
                                NEXT AUCTION ITEM
                              </button>
                            )}

                            {snapshot.liveState.phase !== 'ITEM_PREVIEW' &&
                              snapshot.liveState.phase !== 'SCORED' && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    setConfirmState({
                                      open: true,
                                      title: 'Restart This Item?',
                                      description: 'Clears current bids for this item and resets it to Preview.',
                                      confirmLabel: 'Restart Item',
                                      variant: 'warning',
                                      onConfirm: async () => {
                                        setConfirmState(null);
                                        await runLiveAction('/live/restart', undefined, 'Item restarted');
                                      },
                                    })
                                  }
                                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-white/10 text-xs font-medium text-[#9BB0CA] hover:text-[#EEF5FF]"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  Restart / Cancel
                                </button>
                              )}

                            <button
                              type="button"
                              disabled={actionBusy}
                              onClick={() =>
                                setConfirmState({
                                  open: true,
                                  title: 'End Entire Auction Event?',
                                  description: 'Finalizes the room and displays final winners on all screens.',
                                  confirmLabel: 'End Event',
                                  variant: 'danger',
                                  onConfirm: async () => {
                                    setConfirmState(null);
                                    await runLiveAction('/live/end-event', undefined, 'Event ended!');
                                  },
                                })
                              }
                              className="ml-auto px-3.5 py-2.5 rounded-xl border border-[#FF6B78]/30 text-xs font-medium text-[#FF6B78] hover:bg-[#FF6B78]/10"
                            >
                              End Event
                            </button>
                          </div>
                        </div>

                        {/* Private Host Question & Answer Key Card */}
                        <div className="bg-[#111E31] border border-[#51D6E8]/25 rounded-2xl p-5 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-[#51D6E8]">
                              Host Private Question & Answer Key
                            </span>
                            <span className="text-xs text-[#9BB0CA]">Hidden from teams & projector until scored</span>
                          </div>
                          <p className="text-base font-semibold text-[#EEF5FF]">
                            Q: {snapshot.currentItem.question}
                          </p>
                          <div className="p-3.5 rounded-xl bg-[#08111F] border border-[#B9F36B]/30 space-y-1">
                            <p className="text-sm font-bold text-[#B9F36B]">
                              Answer: {snapshot.currentItem.correctAnswer}
                            </p>
                            {snapshot.currentItem.explanation && (
                              <p className="text-xs text-[#9BB0CA]">{snapshot.currentItem.explanation}</p>
                            )}
                            {snapshot.currentItem.hostNotes && (
                              <p className="text-xs text-[#FFC857] pt-1">Note: {snapshot.currentItem.hostNotes}</p>
                            )}
                          </div>
                        </div>

                        {/* Live Bid Feed */}
                        <div className="bg-[#111E31] border border-white/10 rounded-2xl p-5 space-y-3">
                          <h3 className="text-sm font-bold text-[#EEF5FF]">Live Bid Stream (Current Item)</h3>
                          {snapshot.recentBids.length === 0 ? (
                            <p className="text-xs text-[#9BB0CA]">No bids placed yet for this item.</p>
                          ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                              {snapshot.recentBids.map((b, i) => (
                                <div
                                  key={b.id}
                                  className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/5 text-sm"
                                >
                                  <span className={i === 0 ? 'font-bold text-[#B9F36B]' : 'text-[#EEF5FF]'}>
                                    {b.teamName}
                                  </span>
                                  <span className="font-mono-num font-bold text-[#FFC857]">{b.amount} coins</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* 5. TEAMS */}
              {activeNav === 'teams' && snapshot && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-2xl font-bold text-[#EEF5FF]">
                        Registered Teams ({snapshot.teams.length})
                      </h2>
                      <p className="text-sm text-[#9BB0CA]">
                        Monitor coins, points, and manage participants in {snapshot.room.name}.
                      </p>
                    </div>
                    <input
                      type="text"
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search team name..."
                      className="px-3.5 py-2 rounded-xl bg-[#111E31] border border-white/10 text-sm text-[#EEF5FF] focus:outline-none focus:border-[#51D6E8]"
                    />
                  </div>

                  {filteredTeams.length === 0 ? (
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-8 text-center text-sm text-[#9BB0CA]">
                      No teams registered yet. Teams join using Room Code{' '}
                      <strong className="font-mono-num text-[#51D6E8]">{snapshot.room.code}</strong>.
                    </div>
                  ) : (
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 text-xs font-medium text-[#9BB0CA] bg-[#172740]/50">
                              <th className="py-3 px-4">Rank</th>
                              <th className="py-3 px-4">Team Name</th>
                              <th className="py-3 px-4 text-right">Points</th>
                              <th className="py-3 px-4 text-right">Coins</th>
                              <th className="py-3 px-4 text-right">Items Won</th>
                              <th className="py-3 px-4 text-right">Bids</th>
                              <th className="py-3 px-4 text-right">Host Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-sm">
                            {filteredTeams.map((team) => (
                              <tr key={team.id} className="hover:bg-white/[0.02]">
                                <td className="py-3 px-4 font-mono-num font-semibold">
                                  #{team.rank} {team.isTied ? '· Tie' : ''}
                                </td>
                                <td className="py-3 px-4 font-medium text-[#EEF5FF]">{team.name}</td>
                                <td className="py-3 px-4 text-right font-mono-num font-bold text-[#B9F36B]">
                                  {team.points}
                                </td>
                                <td className="py-3 px-4 text-right font-mono-num text-[#51D6E8]">
                                  {team.coins}
                                </td>
                                <td className="py-3 px-4 text-right font-mono-num">{team.itemsWon}</td>
                                <td className="py-3 px-4 text-right font-mono-num text-[#9BB0CA]">
                                  {team.totalBids}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedTeamDetail(team)}
                                      className="px-2.5 py-1.5 rounded-lg bg-[#08111F] border border-white/10 text-xs text-[#EEF5FF] hover:border-[#51D6E8]"
                                    >
                                      Details
                                    </button>
                                    {snapshot.room.allowManualCoinAdjust && (
                                      <>
                                        <input
                                          type="number"
                                          value={coinDeltaInput[team.id] ?? 10}
                                          onChange={(e) =>
                                            setCoinDeltaInput({ ...coinDeltaInput, [team.id]: Number(e.target.value) })
                                          }
                                          className="w-16 px-2 py-1 rounded-lg bg-[#08111F] border border-white/10 text-xs font-mono-num text-center"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void runLiveAction(
                                              `/teams/${team.id}/adjust-coins`,
                                              { delta: coinDeltaInput[team.id] ?? 10, reason: 'Host coin adjustment' },
                                              `Updated ${team.name}'s coins`
                                            )
                                          }
                                          className="px-2.5 py-1.5 rounded-lg bg-[#172740] text-xs font-semibold text-[#51D6E8]"
                                        >
                                          Adjust
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmState({
                                          open: true,
                                          title: `Remove "${team.name}"?`,
                                          description: 'Teams can be removed before they place bids or win items.',
                                          confirmLabel: 'Remove Team',
                                          variant: 'danger',
                                          onConfirm: async () => {
                                            setConfirmState(null);
                                            await runLiveAction(`/teams/${team.id}/remove`, undefined, 'Team removed');
                                          },
                                        })
                                      }
                                      className="p-1.5 rounded-lg text-[#9BB0CA] hover:text-[#FF6B78]"
                                      title="Remove team"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 6. QUESTION & ITEM BANK */}
              {activeNav === 'question-bank' && (
                <div className="space-y-5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-[#EEF5FF]">Question & Item Bank</h2>
                      <p className="text-sm text-[#9BB0CA]">
                        Create, edit, duplicate, import/export CSV, and deploy items into any auction room.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="cursor-pointer inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#111E31] border border-white/10 text-xs font-semibold text-[#EEF5FF] hover:border-[#51D6E8]">
                        <Upload className="w-4 h-4 text-[#51D6E8]" />
                        Import CSV
                        <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="hidden" />
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadCsv('tech-auction-question-bank.csv', exportQuestionBankCsv(questionBank))
                        }
                        className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#111E31] border border-white/10 text-xs font-semibold text-[#EEF5FF] hover:border-[#51D6E8]"
                      >
                        <Download className="w-4 h-4 text-[#51D6E8]" />
                        Export CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBankItem(null);
                          setBankModalOpen(true);
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-xs"
                      >
                        <Plus className="w-4 h-4" />
                        Create Item
                      </button>
                    </div>
                  </div>

                  {/* Filters */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      placeholder="Search name, category, or question..."
                      className="px-3.5 py-2.5 rounded-xl bg-[#111E31] border border-white/10 text-sm text-[#EEF5FF] focus:outline-none focus:border-[#51D6E8]"
                    />
                    <select
                      value={bankCategory}
                      onChange={(e) => setBankCategory(e.target.value)}
                      className="px-3.5 py-2.5 rounded-xl bg-[#111E31] border border-white/10 text-sm text-[#EEF5FF] focus:outline-none focus:border-[#51D6E8]"
                    >
                      {bankCategories.map((c) => (
                        <option key={c} value={c}>
                          {c === 'ALL' ? 'All Categories' : c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={bankDifficulty}
                      onChange={(e) => setBankDifficulty(e.target.value)}
                      className="px-3.5 py-2.5 rounded-xl bg-[#111E31] border border-white/10 text-sm text-[#EEF5FF] focus:outline-none focus:border-[#51D6E8]"
                    >
                      <option value="ALL">All Difficulties</option>
                      <option value="Easy">Easy</option>
                      <option value="Medium">Medium</option>
                      <option value="Hard">Hard</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredBank.map((item) => (
                      <div
                        key={item.id}
                        className="bg-[#111E31] border border-white/10 rounded-2xl overflow-hidden flex flex-col justify-between"
                      >
                        <div>
                          <TechImage
                            imageUrl={item.imageUrl}
                            emoji={item.emoji}
                            name={item.name}
                            category={item.category}
                            className="w-full aspect-[16/9]"
                          />
                          <div className="p-4 space-y-2">
                            <div className="text-xs text-[#9BB0CA]">
                              {item.category} · {item.difficulty} · {item.startingBid} coins
                              {item.isDemo ? ' · Sample' : ''}
                            </div>
                            <h3 className="text-base font-bold text-[#EEF5FF]">{item.name}</h3>
                            <p className="text-xs text-[#9BB0CA] line-clamp-2">{item.question}</p>
                          </div>
                        </div>

                        <div className="p-3 border-t border-white/10 bg-[#08111F]/50 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewItem(item)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#172740] text-xs font-medium text-[#EEF5FF] hover:text-[#51D6E8]"
                          >
                            Preview
                          </button>
                          {snapshot && (
                            <button
                              type="button"
                              onClick={() =>
                                void runLiveAction(
                                  '/items',
                                  {
                                    bankItemId: item.id,
                                    name: item.name,
                                    imageUrl: item.imageUrl,
                                    emoji: item.emoji,
                                    category: item.category,
                                    description: item.description,
                                    startingBid: item.startingBid,
                                    difficulty: item.difficulty,
                                    question: item.question,
                                    correctAnswer: item.correctAnswer,
                                    explanation: item.explanation,
                                    timeLimitOverrideSec: item.timeLimitOverrideSec,
                                    hostNotes: item.hostNotes,
                                  },
                                  `Added "${item.name}" to ${snapshot.room.name}`
                                )
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-[#B9F36B] text-[#08111F] text-xs font-bold"
                            >
                              + Add to Room
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await apiHostDuplicateBankItem(idToken, item.id);
                                void syncQuestionBankItemToFirestore(res.item);
                                await refreshLists();
                                showToast('ok', 'Item duplicated into your bank.');
                              } catch (err) {
                                showToast('err', err instanceof Error ? err.message : 'Duplicate failed');
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-white/10 text-xs text-[#9BB0CA] hover:text-[#EEF5FF]"
                          >
                            Duplicate
                          </button>
                          {!item.isDemo && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBankItem(item);
                                  setBankModalOpen(true);
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-white/10 text-xs text-[#9BB0CA] hover:text-[#51D6E8]"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmState({
                                    open: true,
                                    title: `Delete "${item.name}"?`,
                                    description: 'Removes this item permanently from your Question Bank.',
                                    confirmLabel: 'Delete Item',
                                    variant: 'danger',
                                    onConfirm: async () => {
                                      await apiHostDeleteBankItem(idToken, item.id);
                                      setConfirmState(null);
                                      await refreshLists();
                                      showToast('ok', 'Item deleted.');
                                    },
                                  })
                                }
                                className="p-1.5 rounded-lg text-[#9BB0CA] hover:text-[#FF6B78] ml-auto"
                                title="Delete item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 7. LEADERBOARD */}
              {activeNav === 'leaderboard' && snapshot && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-[#EEF5FF]">Live Leaderboard</h2>
                      <p className="text-sm text-[#9BB0CA]">
                        Ranked by highest points first, then highest remaining coins.
                      </p>
                    </div>
                  </div>
                  <LeaderboardPanel teams={snapshot.teams} showPodium />
                </div>
              )}

              {/* 8. AUCTION HISTORY & FINAL RESULTS */}
              {activeNav === 'history' && snapshot && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-[#EEF5FF]">Auction History & Final Results</h2>
                      <p className="text-sm text-[#9BB0CA]">
                        Complete audit trail and podium standings for {snapshot.room.name}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleExportRoomResults}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
                    >
                      <Download className="w-4 h-4" />
                      Export Final Results CSV
                    </button>
                  </div>

                  {/* Final Standings Podium */}
                  <LeaderboardPanel teams={snapshot.teams} showPodium />

                  {/* Item History Table */}
                  <div className="bg-[#111E31] border border-white/10 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                      <h3 className="text-base font-bold text-[#EEF5FF]">Completed Auctions ({snapshot.history.length})</h3>
                    </div>
                    {snapshot.history.length === 0 ? (
                      <div className="p-8 text-center text-sm text-[#9BB0CA]">
                        No completed auction rounds yet in this room.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-white/10 text-xs font-medium text-[#9BB0CA] bg-[#172740]/50">
                              <th className="py-3 px-4">Item</th>
                              <th className="py-3 px-4">Winning Team</th>
                              <th className="py-3 px-4 text-right">Bid</th>
                              <th className="py-3 px-4">Result</th>
                              <th className="py-3 px-4 text-right">Points</th>
                              <th className="py-3 px-4 text-right">Deducted</th>
                              <th className="py-3 px-4 text-right">Scored At</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-sm">
                            {snapshot.history.map((h) => (
                              <tr key={h.id} className="hover:bg-white/[0.02]">
                                <td className="py-3 px-4 font-medium text-[#EEF5FF]">
                                  <div>{h.itemName}</div>
                                  <div className="text-xs text-[#9BB0CA] truncate max-w-xs">{h.question}</div>
                                </td>
                                <td className="py-3 px-4 text-[#EEF5FF]">{h.winningTeamName || 'No Bids'}</td>
                                <td className="py-3 px-4 text-right font-mono-num text-[#FFC857]">{h.winningBid}</td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`text-xs font-semibold ${
                                      h.answerResult === 'CORRECT'
                                        ? 'text-[#B9F36B]'
                                        : h.answerResult === 'INCORRECT'
                                          ? 'text-[#FF6B78]'
                                          : 'text-[#9BB0CA]'
                                    }`}
                                  >
                                    {h.answerResult}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right font-mono-num text-[#B9F36B]">+{h.pointsAwarded}</td>
                                <td className="py-3 px-4 text-right font-mono-num text-[#FF6B78]">-{h.coinsDeducted}</td>
                                <td className="py-3 px-4 text-right text-xs text-[#9BB0CA] font-mono-num">
                                  {new Date(h.hostActionTime).toLocaleTimeString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 9. SETTINGS */}
              {activeNav === 'settings' && (
                <div className="max-w-3xl space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold text-[#EEF5FF]">Settings</h2>
                    <p className="text-sm text-[#9BB0CA]">
                      Manage host preferences, active room configuration, and Demo Room reset.
                    </p>
                  </div>

                  <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 space-y-4">
                    <h3 className="text-base font-bold text-[#EEF5FF]">Audio & Event Preferences</h3>
                    <div className="flex items-center justify-between p-4 rounded-xl bg-[#08111F] border border-white/10">
                      <div className="flex items-center gap-3">
                        {soundEnabled ? (
                          <Volume2 className="w-5 h-5 text-[#51D6E8]" />
                        ) : (
                          <VolumeX className="w-5 h-5 text-[#9BB0CA]" />
                        )}
                        <div>
                          <div className="text-sm font-medium text-[#EEF5FF]">Host Auction Sound Cues</div>
                          <div className="text-xs text-[#9BB0CA]">Plays subtle chimes on new bids and scoring.</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold ${
                          soundEnabled ? 'bg-[#51D6E8] text-[#08111F]' : 'bg-[#172740] text-[#9BB0CA]'
                        }`}
                      >
                        {soundEnabled ? 'Enabled' : 'Muted'}
                      </button>
                    </div>
                  </div>

                  {snapshot && (
                    <div className="bg-[#111E31] border border-white/10 rounded-2xl p-6 flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-base font-bold text-[#EEF5FF]">Active Room Settings ({snapshot.room.name})</h3>
                        <p className="text-xs text-[#9BB0CA]">
                          Edit timers, coin increments, and scoring rules anytime before or between rounds.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingRoomModal(snapshot.room)}
                        className="px-4 py-2.5 rounded-xl bg-[#51D6E8] text-[#08111F] text-xs font-bold whitespace-nowrap"
                      >
                        Edit Room Settings
                      </button>
                    </div>
                  )}

                  <div className="bg-[#111E31] border border-[#FFC857]/30 rounded-2xl p-6 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-[#EEF5FF]">Reset Sample Demo Room (TECH26)</h3>
                      <p className="text-xs text-[#9BB0CA]">
                        Restores the 15 sample items, 3 sample teams, and 100 starting coins without touching custom rooms.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmState({
                          open: true,
                          title: 'Reset Sample Demo Room?',
                          description: 'Resets TECH26 back to its clean initial 15-item sample state.',
                          confirmLabel: 'Reset Demo Room',
                          variant: 'warning',
                          onConfirm: async () => {
                            setConfirmState(null);
                            const snap = await apiHostResetDemo(idToken);
                            await refreshLists();
                            if (selectedRoomId === snap.room.id) applySnapshot(snap);
                            showToast('ok', 'Demo Room TECH26 reset.');
                          },
                        })
                      }
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FFC857] text-[#08111F] text-xs font-bold whitespace-nowrap"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Reset Demo Room
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Confirm Dialog */}
      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          variant={confirmState.variant}
          onConfirm={() => void confirmState.onConfirm()}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* Question Bank Create/Edit Modal */}
      <ItemFormModal
        open={bankModalOpen}
        initialItem={editingBankItem}
        title={editingBankItem ? 'Edit Question Bank Item' : 'Create Question Bank Item'}
        onSave={async (draft) => {
          if (editingBankItem) {
            const res = await apiHostUpdateBankItem(idToken, editingBankItem.id, draft);
            void syncQuestionBankItemToFirestore(res.item);
            showToast('ok', 'Item updated.');
          } else {
            const res = await apiHostCreateBankItem(idToken, draft);
            void syncQuestionBankItemToFirestore(res.item);
            showToast('ok', 'Item added to Question Bank.');
          }
          await refreshLists();
        }}
        onClose={() => {
          setBankModalOpen(false);
          setEditingBankItem(null);
        }}
      />

      {/* Add Direct Item to Active Room Modal */}
      <ItemFormModal
        open={addRoomItemModalOpen}
        defaultStartingBid={snapshot?.room.startingBidDefault ?? 10}
        title={`Add Custom Item to ${snapshot?.room.name || 'Room'}`}
        onSave={async (draft: ItemDraft) => {
          if (!snapshot) return;
          const snap = await hostFetch<RoomSnapshotHost>(idToken, `/api/rooms/${snapshot.room.id}/items`, {
            method: 'POST',
            body: JSON.stringify(draft),
          });
          applySnapshot(snap);
          showToast('ok', `Added "${draft.name}" to room queue.`);
        }}
        onClose={() => setAddRoomItemModalOpen(false)}
      />

      {/* Preview Item Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-xl bg-[#111E31] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
            <TechImage
              imageUrl={previewItem.imageUrl}
              emoji={previewItem.emoji}
              name={previewItem.name}
              category={previewItem.category}
              className="w-full aspect-[16/9]"
            />
            <div className="p-6 space-y-3">
              <div className="text-xs text-[#51D6E8]">
                {previewItem.category} · {previewItem.difficulty} · Start {previewItem.startingBid} coins
              </div>
              <h3 className="text-xl font-bold text-[#EEF5FF]">{previewItem.name}</h3>
              <p className="text-sm text-[#9BB0CA]">{previewItem.description}</p>
              <div className="p-4 rounded-xl bg-[#08111F] border border-white/10 space-y-2">
                <p className="text-sm font-semibold text-[#EEF5FF]">Q: {previewItem.question}</p>
                <p className="text-sm font-bold text-[#B9F36B]">A: {previewItem.correctAnswer}</p>
                {previewItem.explanation && <p className="text-xs text-[#9BB0CA]">{previewItem.explanation}</p>}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="px-4 py-2 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Performance Details Modal */}
      {selectedTeamDetail && snapshot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg bg-[#111E31] border border-white/10 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-5 h-5 text-[#51D6E8]" />
                <h3 className="text-lg font-bold text-[#EEF5FF]">{selectedTeamDetail.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTeamDetail(null)}
                className="p-1.5 rounded-lg text-[#9BB0CA] hover:text-[#EEF5FF]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-[#08111F] border border-white/10">
                <span className="text-xs text-[#9BB0CA]">Current Rank</span>
                <p className="text-xl font-bold font-mono-num text-[#EEF5FF]">#{selectedTeamDetail.rank}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#08111F] border border-white/10">
                <span className="text-xs text-[#9BB0CA]">Points</span>
                <p className="text-xl font-bold font-mono-num text-[#B9F36B]">{selectedTeamDetail.points}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#08111F] border border-white/10">
                <span className="text-xs text-[#9BB0CA]">Coins Left</span>
                <p className="text-xl font-bold font-mono-num text-[#51D6E8]">{selectedTeamDetail.coins}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#08111F] border border-white/10">
                <span className="text-xs text-[#9BB0CA]">Items Won</span>
                <p className="text-xl font-bold font-mono-num">{selectedTeamDetail.itemsWon}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#08111F] border border-white/10">
                <span className="text-xs text-[#9BB0CA]">Correct / Wrong</span>
                <p className="text-xl font-bold font-mono-num">
                  <span className="text-[#B9F36B]">{selectedTeamDetail.correctAnswers}</span> /{' '}
                  <span className="text-[#FF6B78]">{selectedTeamDetail.incorrectAnswers}</span>
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[#08111F] border border-white/10">
                <span className="text-xs text-[#9BB0CA]">Total Bids</span>
                <p className="text-xl font-bold font-mono-num text-[#FFC857]">{selectedTeamDetail.totalBids}</p>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#9BB0CA]">Items Won in This Room</h4>
              {snapshot.history.filter((h) => h.winningTeamId === selectedTeamDetail.id).length === 0 ? (
                <p className="text-xs text-[#9BB0CA]">No completed items won by this team yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {snapshot.history
                    .filter((h) => h.winningTeamId === selectedTeamDetail.id)
                    .map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#08111F] text-xs"
                      >
                        <span className="text-[#EEF5FF] font-medium">{h.itemName}</span>
                        <span className="font-mono-num text-[#9BB0CA]">
                          Bid {h.winningBid} · {h.answerResult}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Room Settings Editor Modal */}
      {editingRoomModal && (
        <RoomSettingsModal
          room={editingRoomModal}
          onSave={async (updates) => {
            const snap = await apiHostUpdateRoom(idToken, editingRoomModal.id, updates);
            void syncRoomToFirestore(snap.room);
            await refreshLists();
            if (selectedRoomId === snap.room.id) applySnapshot(snap);
            setEditingRoomModal(null);
            showToast('ok', 'Room settings updated.');
          }}
          onClose={() => setEditingRoomModal(null)}
        />
      )}
    </div>
  );
}

function RoomSettingsModal({
  room,
  onSave,
  onClose,
}: {
  room: RoomConfig;
  onSave: (updates: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [auctionDurationSec, setAuctionDurationSec] = useState(room.auctionDurationSec);
  const [answerDurationSec, setAnswerDurationSec] = useState(room.answerDurationSec);
  const [minBid, setMinBid] = useState(room.minBid);
  const [minBidIncrement, setMinBidIncrement] = useState(room.minBidIncrement);
  const [correctPoints, setCorrectPoints] = useState(room.correctPoints);
  const [incorrectDeduction, setIncorrectDeduction] = useState(room.incorrectDeduction);
  const [deductWinningBid, setDeductWinningBid] = useState(room.deductWinningBid);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name,
        auctionDurationSec,
        answerDurationSec,
        minBid,
        minBidIncrement,
        correctPoints,
        incorrectDeduction,
        deductWinningBid,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg bg-[#111E31] border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#EEF5FF]">Edit Room Settings ({room.code})</h3>
          <button type="button" onClick={onClose} className="p-1 text-[#9BB0CA] hover:text-[#EEF5FF]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Room Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm text-[#EEF5FF]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Auction Timer (s)</label>
              <input
                type="number"
                min={5}
                max={600}
                value={auctionDurationSec}
                onChange={(e) => setAuctionDurationSec(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num text-[#EEF5FF]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Answer Timer (s)</label>
              <input
                type="number"
                min={5}
                max={600}
                value={answerDurationSec}
                onChange={(e) => setAnswerDurationSec(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num text-[#EEF5FF]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Min Bid</label>
              <input
                type="number"
                min={1}
                value={minBid}
                onChange={(e) => setMinBid(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num text-[#EEF5FF]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Min Increment</label>
              <input
                type="number"
                min={1}
                value={minBidIncrement}
                onChange={(e) => setMinBidIncrement(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num text-[#EEF5FF]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Correct Points</label>
              <input
                type="number"
                min={1}
                value={correctPoints}
                onChange={(e) => setCorrectPoints(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num text-[#B9F36B]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1">Wrong Deduction</label>
              <input
                type="number"
                min={0}
                value={incorrectDeduction}
                onChange={(e) => setIncorrectDeduction(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl bg-[#08111F] border border-white/10 text-sm font-mono-num text-[#FF6B78]"
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-[#EEF5FF] cursor-pointer">
            <input
              type="checkbox"
              checked={deductWinningBid}
              onChange={(e) => setDeductWinningBid(e.target.checked)}
              className="accent-[#51D6E8]"
            />
            Deduct winning bid from team coins when auction closes
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-white/10 text-sm text-[#9BB0CA]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-sm"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
