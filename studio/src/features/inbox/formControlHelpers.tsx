import React from 'react';
import type { FormDensity } from './formSchema';

/** Control height by density: 32 px, 28 px in a long form. */
export const controlHeight = (density: FormDensity) => (density === 'compact' ? 'h-7' : 'h-8');

/** ISO instant → the `datetime-local` value in the viewer's time zone. */
export function toLocalInput(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  const local = new Date(time.getTime() - time.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** `datetime-local` value → ISO instant in UTC, which the engine accepts. */
export function fromLocalInput(local: string): string | undefined {
  if (!local) return undefined;
  const time = new Date(local);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}

/** Bold, italics, links and bullet lists; everything else is plain text. Never HTML. */
export function renderMarkdown(source: string): React.ReactNode {
  const inline = (line: string, key: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = pattern.exec(line)) !== null) {
      if (match.index > last) parts.push(line.slice(last, match.index));
      if (match[1]) parts.push(<strong key={`${key}-${index}`} className="font-semibold text-linen">{match[1]}</strong>);
      else if (match[2]) parts.push(<em key={`${key}-${index}`}>{match[2]}</em>);
      else parts.push(<a key={`${key}-${index}`} href={match[4]} target="_blank" rel="noreferrer noopener" className="text-mineral-teal underline">{match[3]}</a>);
      last = pattern.lastIndex;
      index++;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
  };
  const blocks = source.split(/\n{2,}/);
  return blocks.map((block, b) => {
    const lines = block.split('\n');
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return (
        <ul key={b} className="list-disc pl-4 space-y-0.5">
          {lines.map((line, l) => <li key={l}>{inline(line.replace(/^\s*[-*]\s+/, ''), `${b}-${l}`)}</li>)}
        </ul>
      );
    }
    return <p key={b}>{lines.flatMap((line, l) => (l ? [<br key={`br-${l}`} />, ...inline(line, `${b}-${l}`)] : inline(line, `${b}-${l}`)))}</p>;
  });
}

