import { useState } from 'react';
import { Cpu } from 'lucide-react';

interface TechImageProps {
  imageUrl?: string;
  emoji?: string;
  name: string;
  category?: string;
  className?: string;
}

export function TechImage({ imageUrl, emoji, name, category, className = '' }: TechImageProps) {
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return (
      <div className={`relative overflow-hidden bg-[#0D192B] ${className}`}>
        <img
          src={imageUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08111F]/60 via-transparent to-transparent" />
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-[#13253E] via-[#0F1C30] to-[#08111F] flex flex-col items-center justify-center p-4 ${className}`}
    >
      {/* Subtle geometric circuit grid */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 w-full h-full opacity-20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="tech-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#51D6E8" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tech-grid)" />
      </svg>

      <div className="relative z-10 flex flex-col items-center text-center gap-2">
        <div className="w-16 h-16 rounded-2xl bg-[#172740] border border-[#51D6E8]/25 flex items-center justify-center text-3xl shadow-inner">
          {emoji ? <span role="img" aria-label={name}>{emoji}</span> : <Cpu className="w-8 h-8 text-[#51D6E8]" />}
        </div>
        {category && (
          <span className="text-xs font-medium text-[#9BB0CA] tracking-wide">{category}</span>
        )}
      </div>
    </div>
  );
}
