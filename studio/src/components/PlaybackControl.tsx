import React from 'react';
import { FastForward } from 'lucide-react';
import { PACE_LABELS, PLAYBACK_PACES, type PlaybackPace } from '@/lib/run/playbackPace';

const PACE_HINTS: Record<PlaybackPace, string> = {
  calm: 'One step every 0.7 s',
  brisk: 'One step every 0.25 s',
  instant: 'Every step as it happens',
};

/**
 * The playback pace (calm / brisk / instant) and, while the canvas replays
 * steps the instance already took, how far behind it is with a way to jump
 * to now (M5 S3). The engine never waits for the playback.
 */
export const PlaybackControl: React.FC<{
  pace: PlaybackPace;
  onPaceChange: (pace: PlaybackPace) => void;
  /** Steps behind the real state; 0 or undefined hides the badge. */
  lag?: number;
  onJumpToNow?: () => void;
  className?: string;
}> = ({ pace, onPaceChange, lag = 0, onJumpToNow, className = '' }) => (
  <div className={`flex items-center gap-2 ${className}`}>
    {lag > 0 && (
      <span
        role="status"
        className="flex items-center gap-1.5 rounded-full border border-saffron/50 bg-charcoal px-2 py-0.5 text-[10px] font-semibold text-saffron"
      >
        replaying — {lag} step{lag > 1 ? 's' : ''} behind
        {onJumpToNow && (
          <button
            type="button"
            onClick={onJumpToNow}
            className="flex items-center gap-0.5 rounded-full px-1 text-linen underline-offset-2 hover:underline"
          >
            <FastForward className="h-3 w-3" /> Jump to now
          </button>
        )}
      </span>
    )}
    <div role="radiogroup" aria-label="Playback pace" className="flex rounded-lg border border-hairline bg-charcoal p-0.5">
      {PLAYBACK_PACES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={pace === option}
          title={PACE_HINTS[option]}
          onClick={() => onPaceChange(option)}
          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
            pace === option ? 'bg-mocha text-linen' : 'text-sand hover:text-linen'
          }`}
        >
          {PACE_LABELS[option]}
        </button>
      ))}
    </div>
  </div>
);
