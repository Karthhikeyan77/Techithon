import { Award, Coins, Trophy } from 'lucide-react';
import type { LeaderboardEntry } from '../types/auction.ts';

interface LeaderboardPanelProps {
  teams: LeaderboardEntry[];
  highlightTeamId?: string;
  compact?: boolean;
  showPodium?: boolean;
}

export function LeaderboardPanel({
  teams,
  highlightTeamId,
  compact = false,
  showPodium = true,
}: LeaderboardPanelProps) {
  if (teams.length === 0) {
    return (
      <div className="bg-[#111E31] border border-white/10 rounded-2xl p-8 text-center space-y-2">
        <Trophy className="w-8 h-8 text-[#9BB0CA] mx-auto opacity-60" />
        <p className="text-sm font-medium text-[#EEF5FF]">No teams joined yet</p>
        <p className="text-xs text-[#9BB0CA]">Share the room code so participating teams can join from their phones.</p>
      </div>
    );
  }

  const topThree = teams.slice(0, 3);

  return (
    <div className="space-y-5">
      {showPodium && !compact && topThree.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {topThree.map((t, idx) => {
            const accent =
              idx === 0
                ? 'border-[#B9F36B]/40 bg-gradient-to-b from-[#172740] to-[#111E31]'
                : idx === 1
                  ? 'border-[#51D6E8]/35 bg-[#111E31]'
                  : 'border-[#FFC857]/30 bg-[#111E31]';
            const rankColor =
              idx === 0 ? 'text-[#B9F36B]' : idx === 1 ? 'text-[#51D6E8]' : 'text-[#FFC857]';

            return (
              <div
                key={t.id}
                className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 ${accent}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${rankColor}`}>
                      Rank #{t.rank} {t.isTied ? '· Tie' : ''}
                    </p>
                    <h4 className="text-lg font-bold text-[#EEF5FF] mt-1 truncate">{t.name}</h4>
                  </div>
                  <Award className={`w-6 h-6 shrink-0 ${rankColor}`} />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                  <div>
                    <p className="text-xs text-[#9BB0CA]">Points</p>
                    <p className="text-2xl font-bold font-mono-num text-[#B9F36B]">{t.points}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[#9BB0CA]">Coins Left</p>
                    <p className="text-2xl font-bold font-mono-num text-[#51D6E8]">{t.coins}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="bg-[#111E31] border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-xs font-medium text-[#9BB0CA] bg-[#172740]/50">
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4 text-right">Points</th>
                <th className="py-3 px-4 text-right">Coins</th>
                {!compact && (
                  <>
                    <th className="py-3 px-4 text-right">Won</th>
                    <th className="py-3 px-4 text-right">Correct</th>
                    <th className="py-3 px-4 text-right">Incorrect</th>
                    <th className="py-3 px-4 text-right">Bids</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {teams.map((team) => {
                const isSelf = highlightTeamId && team.id === highlightTeamId;
                return (
                  <tr
                    key={team.id}
                    className={`transition-colors ${
                      isSelf ? 'bg-[#51D6E8]/12' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="py-3 px-4 font-mono-num font-semibold text-[#EEF5FF] whitespace-nowrap">
                      #{team.rank}
                      {team.isTied && (
                        <span className="ml-1.5 text-xs font-normal text-[#FFC857]">Tie</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium text-[#EEF5FF]">
                      <span className="truncate block max-w-[180px] sm:max-w-xs">
                        {team.name}
                        {isSelf && <span className="ml-2 text-xs text-[#51D6E8]">(You)</span>}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold text-[#B9F36B]">
                      {team.points}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-[#51D6E8]">
                      <span className="inline-flex items-center gap-1 justify-end">
                        <Coins className="w-3.5 h-3.5 opacity-80" />
                        {team.coins}
                      </span>
                    </td>
                    {!compact && (
                      <>
                        <td className="py-3 px-4 text-right font-mono-num text-[#EEF5FF]">{team.itemsWon}</td>
                        <td className="py-3 px-4 text-right font-mono-num text-[#B9F36B]">{team.correctAnswers}</td>
                        <td className="py-3 px-4 text-right font-mono-num text-[#FF6B78]">{team.incorrectAnswers}</td>
                        <td className="py-3 px-4 text-right font-mono-num text-[#9BB0CA]">{team.totalBids}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
