import { useEffect, useState } from 'react';
import { Clock, Pause } from 'lucide-react';

interface CountdownClockProps {
  deadlineAt: number | null;
  remainingMsWhenPaused: number | null;
  totalDurationSec: number;
  serverOffsetMs: number;
  isPaused: boolean;
  label: string;
  size?: 'sm' | 'md' | 'lg';
}

export function CountdownClock({
  deadlineAt,
  remainingMsWhenPaused,
  totalDurationSec,
  serverOffsetMs,
  isPaused,
  label,
  size = 'md',
}: CountdownClockProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (isPaused || !deadlineAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 100);
    return () => clearInterval(id);
  }, [isPaused, deadlineAt]);

  const rawRemainingMs = isPaused
    ? Math.max(0, remainingMsWhenPaused ?? 0)
    : deadlineAt
      ? Math.max(0, deadlineAt - (nowMs + serverOffsetMs))
      : 0;

  const secondsLeft = Math.ceil(rawRemainingMs / 1000);
  const progressPct = Math.min(100, Math.max(0, (rawRemainingMs / Math.max(1000, totalDurationSec * 1000)) * 100));

  const isCritical = secondsLeft <= 5 && rawRemainingMs > 0;
  const isWarning = secondsLeft <= 10 && secondsLeft > 5;

  const colorText = isPaused
    ? 'text-[#FFC857]'
    : isCritical
      ? 'text-[#FF6B78]'
      : isWarning
        ? 'text-[#FFC857]'
        : 'text-[#51D6E8]';

  const barBg = isPaused
    ? 'bg-[#FFC857]'
    : isCritical
      ? 'bg-[#FF6B78]'
      : isWarning
        ? 'bg-[#FFC857]'
        : 'bg-[#51D6E8]';

  const numClass =
    size === 'lg'
      ? 'text-5xl md:text-6xl font-bold'
      : size === 'sm'
        ? 'text-xl font-bold'
        : 'text-3xl font-bold';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#9BB0CA]">
          {isPaused ? <Pause className="w-3.5 h-3.5 text-[#FFC857]" /> : <Clock className="w-3.5 h-3.5 text-[#51D6E8]" />}
          {label}
          {isPaused && ' (Paused)'}
        </span>
        <span className={`font-mono-num tabular-nums ${numClass} ${colorText}`}>
          {rawRemainingMs > 0 && rawRemainingMs < 5000 && !isPaused
            ? `${(rawRemainingMs / 1000).toFixed(1)}s`
            : `${secondsLeft}s`}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[#08111F] overflow-hidden border border-white/5">
        <div
          className={`h-full transition-all duration-150 ${barBg}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
