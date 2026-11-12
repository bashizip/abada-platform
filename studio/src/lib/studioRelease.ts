/** The Studio's release and its links into the documentation (M5 S13). */
import { config } from '@/config/runtime';

export const STUDIO_VERSION: string = typeof __STUDIO_VERSION__ === 'string' ? __STUDIO_VERSION__ : '0.0.0';

/** `1.2` from `1.2.0`; null for anything that is not a version. */
export function minorOf(version: string | null | undefined): string | null {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version ?? '');
  return match ? `${match[1]}.${match[2]}` : null;
}

/** A documentation page: `docsLink('user/operations')`. */
export function docsLink(path = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${config.docsUrl}/${clean}/` : `${config.docsUrl}/`;
}

/** The release notes page of a minor release, e.g. `.../release-notes/1-2/`. */
export function releaseNotesLink(version: string = STUDIO_VERSION): string {
  const minor = minorOf(version);
  return minor ? docsLink(`release-notes/${minor.replace('.', '-')}`) : docsLink('release-notes');
}

/** What the What's new card says for a minor release; a release without highlights shows no card. */
export const RELEASE_HIGHLIGHTS: Record<string, string[]> = {
  '1.2': [
    'See the path an instance took, and watch a run at a human pace',
    'Fix a failed step on the node, with Retry right there',
    'Forms with sections, steps and file upload',
    'Agents that read scanned documents and PDFs',
    'An administration audit trail of every change',
  ],
};

export const WHATS_NEW_KEY = 'abada.studio.whatsNewSeen';

/**
 * Whether to show the What's new card: the release has highlights and this browser
 * has not dismissed the card for this minor release (or any later one).
 */
export function shouldShowWhatsNew(seen: string | null, version: string = STUDIO_VERSION): boolean {
  const current = minorOf(version);
  if (!current || !RELEASE_HIGHLIGHTS[current]) return false;
  const last = minorOf(seen ? `${seen}.0` : null);
  if (!last) return true;
  const [lastMajor, lastMinor] = last.split('.').map(Number);
  const [major, minor] = current.split('.').map(Number);
  return lastMajor < major || (lastMajor === major && lastMinor < minor);
}

export function readSeen(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_KEY);
  } catch {
    return null;
  }
}

export function writeSeen(version: string = STUDIO_VERSION): void {
  try {
    const minor = minorOf(version);
    if (minor) window.localStorage.setItem(WHATS_NEW_KEY, minor);
  } catch {
    // Storage unavailable: the card shows again next time, which is harmless.
  }
}
