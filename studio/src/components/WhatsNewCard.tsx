import React, { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import { enterExit, useMotionVariants } from '@/lib/motion';
import {
  RELEASE_HIGHLIGHTS, STUDIO_VERSION, minorOf, readSeen, releaseNotesLink, shouldShowWhatsNew, writeSeen,
} from '@/lib/studioRelease';

/**
 * Shown once per browser after the Studio moves to a new minor release (M5 S13): what
 * the release lets you do, and a link to its notes. Dismissing it stores the release.
 */
export const WhatsNewCard: React.FC<{ version?: string }> = ({ version = STUDIO_VERSION }) => {
  const [open, setOpen] = useState(() => shouldShowWhatsNew(readSeen(), version));
  const variants = useMotionVariants(enterExit);
  const minor = minorOf(version);
  const highlights = minor ? RELEASE_HIGHLIGHTS[minor] ?? [] : [];
  const dismiss = () => {
    writeSeen(version);
    setOpen(false);
  };
  return (
    <AnimatePresence>
      {open && (
        <m.aside variants={variants} initial="initial" animate="enter" exit="exit"
          role="dialog" aria-label={`What's new in Abada Studio ${minor}`}
          className="fixed bottom-4 left-4 z-40 w-80 rounded-2xl border border-hairline bg-mocha p-4 shadow-warm-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-linen">
              <Sparkles className="h-4 w-4 text-saffron" aria-hidden="true" />
              What's new in {minor}
            </p>
            <button type="button" aria-label="Dismiss what's new" onClick={dismiss}
              className="rounded-md p-0.5 text-sand hover:text-linen">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-linen-muted">
            {highlights.map((line) => (
              <li key={line} className="flex gap-2"><span className="text-saffron" aria-hidden="true">·</span>{line}</li>
            ))}
          </ul>
          <a href={releaseNotesLink(version)} target="_blank" rel="noreferrer" onClick={() => writeSeen(version)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amethyst hover:text-amethyst-bright">
            Read the release notes <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </m.aside>
      )}
    </AnimatePresence>
  );
};
