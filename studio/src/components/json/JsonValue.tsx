import React, { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { downloadFile, formatBytes } from '@/api/files';
import { useFileAccess } from './fileAccess';
import { markMasks, MASK_MARK, REDACTION_MASK, type FileReference, type JsonNode } from './jsonModel';
import { matchRanges } from './jsonSearch';
import { LONG_STRING } from './jsonRows';
import { VALUE_TONE } from './jsonLayout';

/** What stands in for a value the engine masked. The value itself never reaches the Studio. */
export const RedactedBadge: React.FC = () => (
  <span title="Masked by the project's evidence policy"
    className="inline-flex items-center rounded-full border border-dashed border-hairline-strong px-1.5 align-middle font-sans text-[10px] font-semibold uppercase leading-4 tracking-wider text-sand">
    redacted
  </span>
);

/**
 * A file reference (M5 S9). Inside a project's view it downloads the file
 * through the engine (permissions and audit apply); elsewhere it only shows it.
 */
export const FileChip: React.FC<{ file: FileReference; query?: string; current?: boolean }> = ({ file, query, current }) => {
  const access = useFileAccess();
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const body = (
    <>
      <FileText className="h-3 w-3 text-sand" aria-hidden="true" />
      <Highlighted text={file.name} query={query} current={current} />
      <span className="text-sand">· {formatBytes(file.size)}</span>
      {access && <Download className={`h-3 w-3 ${state === 'failed' ? 'text-desert-rose' : 'text-sand'}`} aria-hidden="true" />}
    </>
  );
  const className = 'inline-flex items-center gap-1 rounded-control border border-hairline bg-mocha-deep px-1.5 align-middle font-sans text-[11px] leading-[17px] text-linen-muted';
  if (!access) return <span title={`${file.contentType} · ${formatBytes(file.size)}`} className={className}>{body}</span>;
  const download = (event: React.MouseEvent) => {
    event.stopPropagation();
    setState('loading');
    downloadFile(access.projectId, file.fileId, file.name).then(() => setState('idle'), () => setState('failed'));
  };
  return (
    <button type="button" onClick={download} disabled={state === 'loading'}
      title={state === 'failed' ? 'The file could not be downloaded' : `Download ${file.name} · ${file.contentType}`}
      className={`${className} hover:border-mineral-teal hover:text-linen disabled:opacity-60`}>
      {body}
    </button>
  );
};

/** Text with the search matches marked. */
export const Highlighted: React.FC<{ text: string; query?: string; current?: boolean }> = ({ text, query, current }) => {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end]) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start}
        className={current ? 'rounded-sm bg-saffron text-charcoal' : 'rounded-sm bg-saffron/30 text-linen ring-1 ring-saffron/50'}>
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
};

/** Text that may hold inline masks (as `MASK_MARK` or as the raw mask): each mask becomes a badge. */
export const MaskedText: React.FC<{ text: string; query?: string; current?: boolean }> = ({ text, query, current }) => {
  const marked = text.includes(REDACTION_MASK) ? markMasks(text) : text;
  if (!marked.includes(MASK_MARK)) return <Highlighted text={marked} query={query} current={current} />;
  return (
    <>
      {marked.split(MASK_MARK).map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 && <RedactedBadge />}
          {part && <Highlighted text={part} query={query} current={current} />}
        </React.Fragment>
      ))}
    </>
  );
};

const previewOf = (node: JsonNode): string => {
  const children = node.children ?? [];
  if (node.kind === 'array') return children.length ? `${children[0].kind === 'object' ? 'objects' : children[0].kind}` : '';
  return children.slice(0, 4).map((child) => String(child.key)).join(', ') + (children.length > 4 ? ', …' : '');
};

/** One value in the tree, coloured by type. */
export const JsonValue: React.FC<{
  node: JsonNode;
  open: boolean;
  stringOpen: boolean;
  query?: string;
  current?: boolean;
  onToggleString: () => void;
}> = ({ node, open, stringOpen, query, current, onToggleString }) => {
  switch (node.kind) {
    case 'string': {
      const text = markMasks(node.value as string);
      if (text.length <= LONG_STRING) return <span className={`min-w-0 truncate ${VALUE_TONE.string}`}>"<MaskedText text={text} query={query} current={current} />"</span>;
      // The text truncates; the button never does.
      return (
        <>
          <span className={`min-w-0 truncate ${VALUE_TONE.string}`}>
            "{stringOpen ? '' : <MaskedText text={text.slice(0, LONG_STRING)} query={query} current={current} />}…{stringOpen ? '' : '"'}
          </span>
          <button type="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); onToggleString(); }}
            className="ml-1.5 shrink-0 font-sans text-[11px] text-mineral-teal-bright hover:underline">
            {stringOpen ? 'show less' : `show more · ${(node.value as string).length.toLocaleString()} chars`}
          </button>
        </>
      );
    }
    case 'number': return <span className={VALUE_TONE.number}><Highlighted text={String(node.value)} query={query} current={current} /></span>;
    case 'boolean': return <span className={VALUE_TONE.boolean}><Highlighted text={String(node.value)} query={query} current={current} /></span>;
    case 'null': return <span className={VALUE_TONE.null}>null</span>;
    case 'redacted': return <RedactedBadge />;
    case 'file': return <FileChip file={node.value as FileReference} query={query} current={current} />;
    default: {
      const count = node.children?.length ?? 0;
      return (
        <>
          <span className="shrink-0 text-sand">{node.kind === 'array' ? `[${count}]` : `{${count}}`}</span>
          {!open && count > 0 && <span className="ml-1.5 min-w-0 truncate text-sand/80">{previewOf(node)}</span>}
        </>
      );
    }
  }
};
