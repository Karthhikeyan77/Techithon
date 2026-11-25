import React, { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowLeft, Award, CheckCircle2, Gavel, Trophy, Users, XCircle } from 'lucide-react';
import type { RoomSnapshotPublic } from '../types/auction.ts';
import { apiPublicRoomByCode } from '../lib/api.ts';
import { CountdownClock } from './CountdownClock.tsx';
import { LeaderboardPanel } from './LeaderboardPanel.tsx';
import { TechImage } from './TechImage.tsx';

interface AudienceDisplayProps {
  initialRoomCode?: string;
  onExit: () => void;
}

export function AudienceDisplay({ initialRoomCode = '', onExit }: AudienceDisplayProps) {
  const [codeInput, setCodeInput] = useState(initialRoomCode.toUpperCase() || 'TECH26');
  const [activeCode, setActiveCode] = useState(initialRoomCode.toUpperCase());
  const [snapshot, setSnapshot] = useState<RoomSnapshotPublic | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const applySnapshot = useCallback((snap: RoomSnapshotPublic) => {
    setSnapshot(snap);
    setServerOffsetMs(snap.serverNow - Date.now());
  }, []);

  useEffect(() => {
    if (!activeCode) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    apiPublicRoomByCode(activeCode)
      .then((snap) => {
        if (!cancelled) {
          applySnapshot(snap);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Room not found');
          setLoading(false);
        }
      });

    const socket = io({
      auth: { role: 'audience', roomCode: activeCode },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on('room:state', (snap: RoomSnapshotPublic) => {
      if (!cancelled) applySnapshot(snap);
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [activeCode, applySnapshot]);

  const handleOpenCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codeInput.trim()) return;
    setActiveCode(codeInput.trim().toUpperCase());
  };

  if (!activeCode || error || (!snapshot && loading)) {
    return (
      <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#111E31] border border-white/10 rounded-3xl p-8 space-y-6 shadow-2xl">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-2 text-sm text-[#9BB0CA] hover:text-[#EEF5FF]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Portal
          </button>

          <div>
            <p className="text-xs font-semibold tracking-wider text-[#51D6E8] uppercase">
              TECHITHON – THE ULTIMATE TECH CHALLENGE
            </p>
            <h1 className="text-2xl font-bold text-[#EEF5FF] mt-1">Audience Projector Mode</h1>
            <p className="text-sm text-[#9BB0CA] mt-1">
              Enter the room code to project live bidding, countdowns, and rankings on the main screen.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-[#FF6B78]/15 border border-[#FF6B78]/40 text-sm text-[#FF6B78]">
              {error}
            </div>
          )}

          <form onSubmit={handleOpenCode} className="space-y-4">
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Room Code (e.g. TECH26)"
              className="w-full px-4 py-3.5 rounded-xl bg-[#08111F] border border-white/10 text-[#51D6E8] font-mono-num font-bold text-xl tracking-widest focus:outline-none focus:border-[#51D6E8]"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-[#51D6E8] text-[#08111F] font-bold text-base hover:opacity-90"
            >
              {loading ? 'Connecting Display...' : 'Launch Projector Display'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  const { room, liveState, currentItem, teams, itemIndex, itemsCount } = snapshot;

  return (
    <div className="min-h-screen bg-[#08111F] text-[#EEF5FF] flex flex-col">
      {/* Projector Top Banner */}
      <header className="border-b border-white/10 bg-[#111E31]/80 px-6 lg:px-10 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onExit}
            className="p-2 rounded-xl border border-white/10 text-[#9BB0CA] hover:text-[#EEF5FF]"
            title="Exit Projector Display"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="text-xs font-bold tracking-widest text-[#51D6E8] uppercase">
              {room.eventName}
            </div>
            <h1 className="text-2xl lg:text-3xl font-extrabold text-[#EEF5FF] tracking-tight">
              TECH AUCTION · {room.name}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-[#9BB0CA]">Join Code</div>
            <div className="text-2xl font-bold font-mono-num text-[#51D6E8] tracking-wider">
              {room.code}
            </div>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div className="flex items-center gap-2.5">
            <Users className="w-6 h-6 text-[#B9F36B]" />
            <div>
              <div className="text-xs text-[#9BB0CA]">Teams</div>
              <div className="text-2xl font-bold font-mono-num text-[#EEF5FF]">{teams.length}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Projector Stage */}
      <main className="flex-1 p-6 lg:p-10 grid grid-cols-1 xl:grid-cols-12 gap-8 max-w-[1600px] w-full mx-auto">
        {/* Left/Center Showcase */}
        <section className="xl:col-span-7 flex flex-col gap-6">
          {liveState.phase === 'EVENT_ENDED' ? (
            <div className="flex-1 bg-[#111E31] border border-[#B9F36B]/30 rounded-3xl p-8 flex flex-col justify-center space-y-6">
              <div className="text-center space-y-2">
                <Trophy className="w-14 h-14 text-[#B9F36B] mx-auto" />
                <h2 className="text-4xl font-extrabold text-[#EEF5FF]">Final Event Standings</h2>
                <p className="text-base text-[#9BB0CA]">THINK. BID. CONQUER.</p>
              </div>
              <LeaderboardPanel teams={teams} showPodium />
            </div>
          ) : !currentItem ? (
            <div className="flex-1 bg-[#111E31] border border-white/10 rounded-3xl p-12 flex flex-col items-center justify-center text-center space-y-3">
              <Gavel className="w-14 h-14 text-[#51D6E8]" />
              <h2 className="text-3xl font-bold text-[#EEF5FF]">Stand By for the Next Lot</h2>
              <p className="text-lg text-[#9BB0CA]">Teams can join now using code {room.code}</p>
            </div>
          ) : (
            <div className="bg-[#111E31] border border-white/10 rounded-3xl overflow-hidden flex flex-col">
              <div className="grid grid-cols-1 md:grid-cols-2">
                <TechImage
                  imageUrl={currentItem.imageUrl}
                  emoji={currentItem.emoji}
                  name={currentItem.name}
                  category={currentItem.category}
                  className="w-full h-64 md:h-full min-h-[280px]"
                />
                <div className="p-6 lg:p-8 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-[#51D6E8]">
                      Item {itemIndex} of {itemsCount} · {currentItem.category} · {currentItem.difficulty}
                    </div>
                    <h2 className="text-3xl lg:text-4xl font-extrabold text-[#EEF5FF] leading-tight">
                      {currentItem.name}
                    </h2>
                    <p className="text-base text-[#9BB0CA] leading-relaxed">
                      {currentItem.description}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-white/10">
                    {(liveState.phase === 'BIDDING_OPEN' || liveState.phase === 'BIDDING_PAUSED') && (
                      <CountdownClock
                        deadlineAt={liveState.auctionDeadlineAt}
                        remainingMsWhenPaused={liveState.auctionRemainingMs}
                        totalDurationSec={room.auctionDurationSec}
                        serverOffsetMs={serverOffsetMs}
                        isPaused={liveState.phase === 'BIDDING_PAUSED'}
                        label="Auction Countdown"
                        size="lg"
                      />
                    )}
                    {(liveState.phase === 'QUESTION_ACTIVE' ||
                      liveState.phase === 'QUESTION_PAUSED' ||
                      liveState.phase === 'QUESTION_TIMEOUT') && (
                      <CountdownClock
                        deadlineAt={liveState.answerDeadlineAt}
                        remainingMsWhenPaused={liveState.answerRemainingMs}
                        totalDurationSec={currentItem.timeLimitOverrideSec ?? room.answerDurationSec}
                        serverOffsetMs={serverOffsetMs}
                        isPaused={liveState.phase === 'QUESTION_PAUSED'}
                        label="Answer Countdown"
                        size="lg"
                      />
                    )}
                    {liveState.phase === 'ITEM_PREVIEW' && (
                      <div className="text-lg font-semibold text-[#51D6E8]">
                        Starting Bid: {Math.max(room.minBid, currentItem.startingBid)} coins · Ready to Start
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Highest Bid & Leading Team Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-2 border-t border-white/10 bg-[#172740]/60">
                <div className="p-6 border-b sm:border-b-0 sm:border-r border-white/10">
                  <div className="text-sm text-[#9BB0CA]">Current Highest Bid</div>
                  <div className="text-4xl lg:text-5xl font-extrabold font-mono-num text-[#FFC857] mt-1">
                    {liveState.currentHighestBid > 0 ? `${liveState.currentHighestBid} coins` : '—'}
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-sm text-[#9BB0CA]">
                    {liveState.phase === 'BIDDING_OPEN' ? 'Leading Team' : 'Winning Team'}
                  </div>
                  <div className="text-3xl lg:text-4xl font-extrabold text-[#B9F36B] mt-1 truncate">
                    {liveState.highestBidderTeamName || 'Awaiting Bids'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Question Reveal / Result Stage Card */}
          {(liveState.phase === 'BIDDING_CLOSED' ||
            liveState.phase === 'QUESTION_ACTIVE' ||
            liveState.phase === 'QUESTION_PAUSED' ||
            liveState.phase === 'QUESTION_TIMEOUT') &&
            liveState.highestBidderTeamName && (
              <div className="bg-[#172740] border border-[#51D6E8]/40 rounded-3xl p-6 lg:p-8 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#51D6E8]">
                  <Award className="w-5 h-5" />
                  Winning Team: {liveState.highestBidderTeamName}
                </div>
                {currentItem?.question ? (
                  <p className="text-2xl lg:text-3xl font-bold text-[#EEF5FF] leading-snug">
                    {currentItem.question}
                  </p>
                ) : (
                  <p className="text-lg text-[#9BB0CA]">
                    Host is preparing to reveal the technical challenge...
                  </p>
                )}
              </div>
            )}

          {liveState.phase === 'SCORED' && liveState.lastResult && (
            <div
              className={`rounded-3xl border p-6 lg:p-8 space-y-3 ${
                liveState.lastResult.answerResult === 'CORRECT'
                  ? 'bg-[#B9F36B]/15 border-[#B9F36B]/50'
                  : 'bg-[#FF6B78]/15 border-[#FF6B78]/50'
              }`}
            >
              <div className="flex items-center gap-3 text-2xl lg:text-3xl font-extrabold">
                {liveState.lastResult.answerResult === 'CORRECT' ? (
                  <>
                    <CheckCircle2 className="w-8 h-8 text-[#B9F36B]" />
                    <span className="text-[#B9F36B]">
                      {liveState.lastResult.winningTeamName} · CORRECT! (+{liveState.lastResult.pointsAwarded} PTS)
                    </span>
                  </>
                ) : liveState.lastResult.answerResult === 'NO_BIDS' ? (
                  <span className="text-[#9BB0CA]">Round Closed · No Bids Placed</span>
                ) : (
                  <>
                    <XCircle className="w-8 h-8 text-[#FF6B78]" />
                    <span className="text-[#FF6B78]">
                      {liveState.lastResult.winningTeamName} · INCORRECT (-{liveState.lastResult.coinsDeducted} COINS)
                    </span>
                  </>
                )}
              </div>
              {liveState.lastResult.correctAnswer && (
                <p className="text-lg text-[#EEF5FF]">
                  <strong>Correct Answer:</strong> {liveState.lastResult.correctAnswer}
                </p>
              )}
              {liveState.lastResult.explanation && (
                <p className="text-sm text-[#9BB0CA]">{liveState.lastResult.explanation}</p>
              )}
            </div>
          )}
        </section>

        {/* Right Stage: Live Leaderboard */}
        <aside className="xl:col-span-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#EEF5FF] flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#B9F36B]" />
              Live Leaderboard
            </h2>
            <span className="text-xs text-[#9BB0CA]">Points · Remaining Coins</span>
          </div>
          <LeaderboardPanel teams={teams} compact showPodium={false} />
        </aside>
      </main>
    </div>
  );
}
