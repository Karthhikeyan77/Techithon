import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ArrowLeft,
  CheckCircle2,
  Coins,
  Gavel,
  LogOut,
  ShieldAlert,
  Sparkles,
  Trophy,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import type { RoomSnapshotPublic } from '../types/auction.ts';
import { apiJoinTeam, apiPlaceBid, apiPublicJoinInfo, apiTeamMe } from '../lib/api.ts';
import { CountdownClock } from './CountdownClock.tsx';
import { LeaderboardPanel } from './LeaderboardPanel.tsx';
import { TechImage } from './TechImage.tsx';

interface TeamMobileViewProps {
  initialRoomCode?: string;
  onExit: () => void;
}

export function TeamMobileView({ initialRoomCode = '', onExit }: TeamMobileViewProps) {
  // Session held in React memory (never localStorage/sessionStorage for security)
  const [teamToken, setTeamToken] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshotPublic | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  // Join form state
  const [roomCode, setRoomCode] = useState(initialRoomCode.toUpperCase());
  const [teamName, setTeamName] = useState('');
  const [pin, setPin] = useState('');
  const [roomPreview, setRoomPreview] = useState<{
    name: string;
    hasPin: boolean;
    isDemo: boolean;
  } | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joinSuccessBanner, setJoinSuccessBanner] = useState(false);

  // Live UI state
  const [activeTab, setActiveTab] = useState<'bid' | 'leaderboard'>('bid');
  const [bidAmount, setBidAmount] = useState<string>('');
  const [bidding, setBidding] = useState(false);
  const [bidFeedback, setBidFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  // Lookup room info when code looks ready
  useEffect(() => {
    const clean = roomCode.trim().toUpperCase();
    if (clean.length < 4 || teamToken) {
      setRoomPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const info = await apiPublicJoinInfo(clean);
        if (!cancelled) {
          setRoomPreview({ name: info.name, hasPin: info.hasPin, isDemo: info.isDemo });
        }
      } catch {
        if (!cancelled) setRoomPreview(null);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [roomCode, teamToken]);

  const applySnapshot = useCallback((snap: RoomSnapshotPublic) => {
    setSnapshot(snap);
    setServerOffsetMs(snap.serverNow - Date.now());
  }, []);

  // Attach Socket.IO when authenticated as team
  useEffect(() => {
    if (!teamToken) return;
    const socket = io({
      auth: { role: 'team', token: teamToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('room:sync');
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('room:state', (snap: RoomSnapshotPublic) => {
      applySnapshot(snap);
    });

    socket.on('connect_error', async () => {
      setConnected(false);
      // Fallback HTTP recovery if socket handshake stumbles
      try {
        const recovered = await apiTeamMe(teamToken);
        applySnapshot(recovered.snapshot);
      } catch {
        // Ignore transient offline errors
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [teamToken, applySnapshot]);

  const myTeam = useMemo(() => {
    if (!snapshot || !teamId) return null;
    return snapshot.teams.find((t) => t.id === teamId) || null;
  }, [snapshot, teamId]);

  const minRequiredBid = useMemo(() => {
    if (!snapshot || !snapshot.currentItem) return 0;
    const { room, liveState, currentItem } = snapshot;
    if (liveState.highestBidderTeamId === null) {
      return Math.max(room.minBid, currentItem.startingBid);
    }
    return liveState.currentHighestBid + room.minBidIncrement;
  }, [snapshot]);

  // Keep default bid input synced to minimum valid bid when item or highest bid changes
  useEffect(() => {
    if (minRequiredBid > 0) {
      setBidAmount((prev) => {
        const n = Number(prev);
        if (!prev || isNaN(n) || n < minRequiredBid) {
          return String(minRequiredBid);
        }
        return prev;
      });
    }
  }, [minRequiredBid, snapshot?.liveState.currentItemId]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !teamName.trim()) {
      setJoinError('Enter both Room Code and Team Name.');
      return;
    }
    setJoining(true);
    setJoinError('');
    try {
      const res = await apiJoinTeam({
        roomCode: roomCode.trim().toUpperCase(),
        teamName: teamName.trim(),
        pin: pin.trim(),
      });
      setTeamToken(res.token);
      setTeamId(res.team.id);
      applySnapshot(res.snapshot);
      setJoinSuccessBanner(true);
      setTimeout(() => setJoinSuccessBanner(false), 4000);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Unable to join room');
    } finally {
      setJoining(false);
    }
  };

  const handlePlaceBid = async (customAmount?: number) => {
    if (!snapshot || !snapshot.currentItem || !teamToken || !myTeam) return;
    const amountNum = customAmount ?? Number(bidAmount);
    if (!Number.isInteger(amountNum) || amountNum <= 0) {
      setBidFeedback({ type: 'err', text: 'Enter a valid whole number bid.' });
      return;
    }

    setBidding(true);
    setBidFeedback(null);
    const idempotencyKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const payload = {
      itemId: snapshot.currentItem.id,
      amount: amountNum,
      idempotencyKey,
    };

    try {
      if (socketRef.current && socketRef.current.connected) {
        await new Promise<void>((resolve, reject) => {
          socketRef.current!.emit(
            'bid:place',
            payload,
            (ack: { ok: boolean; error?: string }) => {
              if (ack?.ok) resolve();
              else reject(new Error(ack?.error || 'Bid rejected'));
            }
          );
        });
      } else {
        const res = await apiPlaceBid(teamToken, snapshot.room.id, payload);
        applySnapshot(res.snapshot);
      }
      setBidFeedback({ type: 'ok', text: `Bid of ${amountNum} coins placed!` });
      setTimeout(() => setBidFeedback(null), 2500);
    } catch (err) {
      setBidFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Bid failed',
      });
    } finally {
      setBidding(false);
    }
  };

  // --- JOIN SCREEN ---
  if (!teamToken || !snapshot) {
    return (
      <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex flex-col justify-between p-4 sm:p-6">
        <div className="max-w-md w-full mx-auto pt-4">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-2 text-sm text-[#9BB0CA] hover:text-[#EEF5FF] min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Portal
          </button>
        </div>

        <div className="max-w-md w-full mx-auto bg-[#111E31] border border-white/10 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl my-6">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold tracking-wider text-[#51D6E8] uppercase">
              TECHITHON · Team Mobile Entry
            </p>
            <h1 className="text-2xl font-bold text-[#EEF5FF]">Join Live Tech Auction</h1>
            <p className="text-sm text-[#9BB0CA]">
              Enter the room code shown on the projector and choose your team name.
            </p>
          </div>

          {joinError && (
            <div className="p-3.5 rounded-xl bg-[#FF6B78]/15 border border-[#FF6B78]/40 text-sm text-[#FF6B78]">
              {joinError}
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Room Code</label>
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                placeholder="e.g., TECH26"
                maxLength={16}
                className="w-full px-4 py-3.5 rounded-xl bg-[#08111F] border border-white/10 text-[#51D6E8] font-mono-num font-bold text-lg tracking-wider focus:outline-none focus:border-[#51D6E8]"
              />
              {roomPreview && (
                <p className="text-xs text-[#B9F36B] mt-1.5">
                  Found: {roomPreview.name}
                  {roomPreview.isDemo ? ' (Sample Demo Room)' : ''}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">Team Name</label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g., Cyber Falcons"
                maxLength={40}
                className="w-full px-4 py-3.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] text-base focus:outline-none focus:border-[#51D6E8]"
              />
            </div>

            {(!roomPreview || roomPreview.hasPin) && (
              <div>
                <label className="block text-xs font-medium text-[#9BB0CA] mb-1.5">
                  Room Access PIN {roomPreview?.hasPin ? '(Required)' : '(If required by host)'}
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Optional PIN"
                  className="w-full px-4 py-3.5 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num text-base focus:outline-none focus:border-[#51D6E8]"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={joining}
              className="w-full min-h-[52px] rounded-2xl bg-[#B9F36B] text-[#08111F] font-bold text-base hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              {joining ? 'Joining Room...' : 'Join Auction Room'}
            </button>
          </form>

          <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
            <span className="text-xs text-[#9BB0CA]">Testing on your phone?</span>
            <button
              type="button"
              onClick={() => setRoomCode('TECH26')}
              className="text-xs font-semibold text-[#51D6E8] hover:underline min-h-[36px] px-2"
            >
              Fill Demo Code (TECH26)
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-[#9BB0CA] pb-4">
          TECH AUCTION · THINK. BID. CONQUER.
        </p>
      </div>
    );
  }

  // --- PARTICIPANT LIVE INTERFACE ---
  const { room, liveState, currentItem, teams } = snapshot;
  const isLeading = Boolean(myTeam && liveState.highestBidderTeamId === myTeam.id);
  const isBiddingOpen = liveState.phase === 'BIDDING_OPEN';
  const isQuestionPhase =
    liveState.phase === 'QUESTION_ACTIVE' ||
    liveState.phase === 'QUESTION_PAUSED' ||
    liveState.phase === 'QUESTION_TIMEOUT';
  const isWinner = Boolean(myTeam && liveState.highestBidderTeamId === myTeam.id);
  const canAffordMin = Boolean(myTeam && myTeam.coins >= minRequiredBid);

  return (
    <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] pb-24">
      {/* Compact Sticky Top Bar (<=15% mobile height) */}
      <header className="sticky top-0 z-30 bg-[#08111F]/95 backdrop-blur-md border-b border-white/10 px-4 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-[#51D6E8] font-medium truncate">{room.name}</div>
            <div className="text-base font-bold text-[#EEF5FF] truncate">{myTeam?.name || teamName}</div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 text-xs">
              {connected ? (
                <Wifi className="w-4 h-4 text-[#B9F36B]" aria-label="Live connected" />
              ) : (
                <WifiOff className="w-4 h-4 text-[#FFC857]" aria-label="Reconnecting" />
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setTeamToken(null);
                setTeamId(null);
                setSnapshot(null);
              }}
              className="p-2 rounded-xl border border-white/10 text-[#9BB0CA] hover:text-[#EEF5FF] min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Leave room"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-4 space-y-4">
        {joinSuccessBanner && (
          <div className="p-3.5 rounded-2xl bg-[#B9F36B]/15 border border-[#B9F36B]/40 text-sm text-[#B9F36B] flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>Welcome! Joined with {room.startingCoins} starting coins.</span>
          </div>
        )}

        {/* Team Balance & Points Strip */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#111E31] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-[#9BB0CA]">Coin Balance</p>
              <p className="text-2xl sm:text-3xl font-bold font-mono-num text-[#51D6E8]">
                {myTeam?.coins ?? 0}
              </p>
            </div>
            <Coins className="w-7 h-7 text-[#51D6E8] opacity-80" />
          </div>

          <div className="bg-[#111E31] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-[#9BB0CA]">Total Points</p>
              <p className="text-2xl sm:text-3xl font-bold font-mono-num text-[#B9F36B]">
                {myTeam?.points ?? 0}
              </p>
            </div>
            <Trophy className="w-7 h-7 text-[#B9F36B] opacity-80" />
          </div>
        </div>

        {activeTab === 'bid' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Object & Status Card */}
            <div className="lg:col-span-7 space-y-4">
              {liveState.phase === 'EVENT_ENDED' ? (
                <div className="bg-[#111E31] border border-[#B9F36B]/30 rounded-2xl p-6 text-center space-y-3">
                  <Trophy className="w-10 h-10 text-[#B9F36B] mx-auto" />
                  <h2 className="text-xl font-bold text-[#EEF5FF]">Auction Event Completed</h2>
                  <p className="text-sm text-[#9BB0CA]">
                    Check the Leaderboard tab to see final rankings and standings.
                  </p>
                </div>
              ) : !currentItem ? (
                <div className="bg-[#111E31] border border-white/10 rounded-2xl p-8 text-center space-y-2">
                  <Sparkles className="w-8 h-8 text-[#51D6E8] mx-auto" />
                  <h2 className="text-lg font-semibold text-[#EEF5FF]">Waiting for Host</h2>
                  <p className="text-sm text-[#9BB0CA]">
                    The host will present the next technology object shortly.
                  </p>
                </div>
              ) : (
                <div className="bg-[#111E31] border border-white/10 rounded-2xl overflow-hidden">
                  <TechImage
                    imageUrl={currentItem.imageUrl}
                    emoji={currentItem.emoji}
                    name={currentItem.name}
                    category={currentItem.category}
                    className="w-full aspect-[16/10]"
                  />

                  <div className="p-5 space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-[#9BB0CA]">
                        <span>{currentItem.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{currentItem.difficulty}</span>
                        <span aria-hidden="true">·</span>
                        <span>Start {currentItem.startingBid} coins</span>
                      </div>
                      <h2 className="text-2xl font-bold text-[#EEF5FF]">{currentItem.name}</h2>
                      <p className="text-sm text-[#9BB0CA] leading-relaxed">
                        {currentItem.description}
                      </p>
                    </div>

                    {/* Highest Bid & Leading Team */}
                    <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-[#08111F] border border-white/10">
                      <div>
                        <p className="text-xs text-[#9BB0CA]">Current Highest Bid</p>
                        <p className="text-2xl font-bold font-mono-num text-[#FFC857] mt-0.5">
                          {liveState.currentHighestBid > 0 ? `${liveState.currentHighestBid} coins` : 'No bids yet'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#9BB0CA]">Leading Team</p>
                        <p className={`text-base font-bold mt-1 truncate ${isLeading ? 'text-[#B9F36B]' : 'text-[#EEF5FF]'}`}>
                          {liveState.highestBidderTeamName
                            ? isLeading
                              ? `${liveState.highestBidderTeamName} (YOU)`
                              : liveState.highestBidderTeamName
                            : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Active Timers */}
                    {(liveState.phase === 'BIDDING_OPEN' || liveState.phase === 'BIDDING_PAUSED') && (
                      <CountdownClock
                        deadlineAt={liveState.auctionDeadlineAt}
                        remainingMsWhenPaused={liveState.auctionRemainingMs}
                        totalDurationSec={room.auctionDurationSec}
                        serverOffsetMs={serverOffsetMs}
                        isPaused={liveState.phase === 'BIDDING_PAUSED'}
                        label="Bidding Time Left"
                      />
                    )}

                    {isQuestionPhase && (
                      <CountdownClock
                        deadlineAt={liveState.answerDeadlineAt}
                        remainingMsWhenPaused={liveState.answerRemainingMs}
                        totalDurationSec={currentItem.timeLimitOverrideSec ?? room.answerDurationSec}
                        serverOffsetMs={serverOffsetMs}
                        isPaused={liveState.phase === 'QUESTION_PAUSED'}
                        label="Answer Time Left"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bidding & Question Interaction Panel */}
            <div className="lg:col-span-5 space-y-4">
              {/* Winning Question Card */}
              {isQuestionPhase && currentItem?.question && (
                <div
                  className={`rounded-2xl border p-5 space-y-3 ${
                    isWinner
                      ? 'bg-[#172740] border-[#B9F36B]/50'
                      : 'bg-[#111E31] border-white/10'
                  }`}
                >
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#B9F36B]">
                    {isWinner
                      ? 'You Won This Item · Answer Now'
                      : `Winner: ${liveState.highestBidderTeamName} · Technical Question`}
                  </div>
                  <p className="text-base sm:text-lg font-semibold text-[#EEF5FF] leading-snug">
                    {currentItem.question}
                  </p>
                  <p className="text-xs text-[#9BB0CA]">
                    {liveState.phase === 'QUESTION_TIMEOUT'
                      ? 'Answer timer ended. Waiting for host confirmation.'
                      : isWinner
                        ? 'Give your answer verbally to the host before the timer expires.'
                        : 'Listen as the winning team answers this challenge.'}
                  </p>
                </div>
              )}

              {/* Scored Final Result Banner */}
              {liveState.phase === 'SCORED' && liveState.lastResult && (
                <div
                  className={`rounded-2xl border p-5 space-y-2 ${
                    liveState.lastResult.answerResult === 'CORRECT'
                      ? 'bg-[#B9F36B]/12 border-[#B9F36B]/40'
                      : 'bg-[#FF6B78]/12 border-[#FF6B78]/40'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-base">
                    {liveState.lastResult.answerResult === 'CORRECT' ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 text-[#B9F36B]" />
                        <span className="text-[#B9F36B]">
                          {liveState.lastResult.winningTeamName} Answered Correctly! (+{liveState.lastResult.pointsAwarded} pts)
                        </span>
                      </>
                    ) : liveState.lastResult.answerResult === 'NO_BIDS' ? (
                      <span className="text-[#9BB0CA]">No bids placed for this item.</span>
                    ) : (
                      <>
                        <XCircle className="w-5 h-5 text-[#FF6B78]" />
                        <span className="text-[#FF6B78]">
                          {liveState.lastResult.winningTeamName} — Incorrect (-{liveState.lastResult.coinsDeducted} coins)
                        </span>
                      </>
                    )}
                  </div>
                  {liveState.lastResult.correctAnswer && (
                    <p className="text-sm text-[#EEF5FF]">
                      <strong>Answer:</strong> {liveState.lastResult.correctAnswer}
                    </p>
                  )}
                  {liveState.lastResult.explanation && (
                    <p className="text-xs text-[#9BB0CA]">{liveState.lastResult.explanation}</p>
                  )}
                </div>
              )}

              {/* Bid Controls Card */}
              <div className="bg-[#111E31] border border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[#EEF5FF] flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-[#51D6E8]" />
                    Place Your Bid
                  </h3>
                  {isBiddingOpen && currentItem && (
                    <span className="text-xs font-mono-num text-[#9BB0CA]">
                      Min: {minRequiredBid} coins
                    </span>
                  )}
                </div>

                {bidFeedback && (
                  <div
                    className={`p-3 rounded-xl text-sm font-medium ${
                      bidFeedback.type === 'ok'
                        ? 'bg-[#B9F36B]/15 border border-[#B9F36B]/40 text-[#B9F36B]'
                        : 'bg-[#FF6B78]/15 border border-[#FF6B78]/40 text-[#FF6B78]'
                    }`}
                  >
                    {bidFeedback.text}
                  </div>
                )}

                {!isBiddingOpen ? (
                  <div className="p-4 rounded-xl bg-[#08111F] border border-white/10 text-sm text-[#9BB0CA] text-center">
                    {liveState.phase === 'ITEM_PREVIEW'
                      ? 'Previewing item. Bidding will open when the host starts the timer.'
                      : liveState.phase === 'BIDDING_PAUSED'
                        ? 'Bidding is temporarily paused by the host.'
                        : liveState.phase === 'BIDDING_CLOSED'
                          ? liveState.highestBidderTeamId
                            ? `Bidding closed! Winner: ${liveState.highestBidderTeamName}`
                            : 'Bidding closed with no bids.'
                          : 'Bidding is not open right now.'}
                  </div>
                ) : isLeading ? (
                  <div className="p-4 rounded-xl bg-[#B9F36B]/15 border border-[#B9F36B]/40 text-center space-y-1">
                    <p className="text-sm font-bold text-[#B9F36B]">You Hold the Highest Bid!</p>
                    <p className="text-xs text-[#EEF5FF]">
                      Wait to see if another team outbids you before the timer ends.
                    </p>
                  </div>
                ) : !canAffordMin ? (
                  <div className="p-4 rounded-xl bg-[#FF6B78]/15 border border-[#FF6B78]/40 flex items-center gap-2 text-sm text-[#FF6B78]">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <span>
                      Insufficient coins ({myTeam?.coins ?? 0}). Minimum valid bid is {minRequiredBid} coins.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Quick Increment Buttons */}
                    <div className="grid grid-cols-3 gap-2">
                      {[0, room.minBidIncrement, room.minBidIncrement * 2].map((extra, idx) => {
                        const amt = minRequiredBid + extra;
                        const disabled = !myTeam || amt > myTeam.coins || bidding;
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              setBidAmount(String(amt));
                              void handlePlaceBid(amt);
                            }}
                            className="min-h-[44px] rounded-xl bg-[#172740] border border-white/10 text-sm font-mono-num font-bold text-[#51D6E8] hover:border-[#51D6E8] disabled:opacity-40 active:scale-[0.98]"
                          >
                            {idx === 0 ? `Min (${amt})` : `${amt}`}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={minRequiredBid}
                        max={myTeam?.coins ?? 100}
                        value={bidAmount}
                        onChange={(e) => setBidAmount(e.target.value)}
                        className="w-32 px-3.5 py-3 rounded-xl bg-[#08111F] border border-white/10 text-[#EEF5FF] font-mono-num font-bold text-lg focus:outline-none focus:border-[#51D6E8]"
                      />
                      <button
                        type="button"
                        disabled={bidding}
                        onClick={() => void handlePlaceBid()}
                        className="flex-1 min-h-[52px] rounded-xl bg-[#B9F36B] text-[#08111F] font-bold text-base hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {bidding ? 'Submitting...' : 'PLACE BID'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <LeaderboardPanel teams={teams} highlightTeamId={myTeam?.id} compact showPodium={false} />
        )}
      </main>

      {/* Bottom Mobile Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#08111F]/95 backdrop-blur-md border-t border-white/10">
        <div className="max-w-md mx-auto grid grid-cols-2 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('bid')}
            className={`flex flex-col items-center justify-center gap-1 text-xs font-medium ${
              activeTab === 'bid' ? 'text-[#51D6E8]' : 'text-[#9BB0CA]'
            }`}
          >
            <Gavel className="w-5 h-5" />
            <span>Live Auction</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('leaderboard')}
            className={`flex flex-col items-center justify-center gap-1 text-xs font-medium ${
              activeTab === 'leaderboard' ? 'text-[#51D6E8]' : 'text-[#9BB0CA]'
            }`}
          >
            <Trophy className="w-5 h-5" />
            <span>Leaderboard ({teams.length})</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
