import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Code2, RotateCcw } from 'lucide-react';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import { WorkflowFile } from '@/types';

interface AplEditorProps {
  workflow: WorkflowFile;
  onApply: (workflow: WorkflowFile) => void;
}

const validateSource = (source: string): WorkflowFile => {
  const document = parseAPLYaml(source);
  if (!document || document.version !== 'abada.io/v1') {
    throw new Error('version must be abada.io/v1');
  }
  if (!document.metadata?.name?.trim()) throw new Error('metadata.name is required');
  if (!document.metadata?.key?.match(/^[a-z][a-z0-9_-]{0,127}$/)) {
    throw new Error('metadata.key must match [a-z][a-z0-9_-]{0,127}');
  }
  if (!document.flow || !Array.isArray(document.flow.nodes)) throw new Error('flow.nodes must be an array');
  const rawNodes = document.flow.nodes as Array<{ id?: string; type?: string; next?: string }>;
  for (const node of rawNodes) {
    if (!node?.id?.match(/^[a-zA-Z][a-zA-Z0-9_-]*$/)) throw new Error('every node requires a valid unique id');
    if (!node.type) throw new Error(`node ${node.id} requires a type`);
  }
  const ids = new Set(rawNodes.map((node) => node.id));
  if (ids.size !== rawNodes.length) throw new Error('flow.nodes contains duplicate ids');
  if (document.flow.nodes.length && !ids.has(document.flow.entry)) {
    throw new Error('flow.entry must reference an existing node');
  }
  for (const node of rawNodes) {
    if (node.next && !ids.has(node.next)) throw new Error(`node ${node.id} references unknown next node ${node.next}`);
  }
  return aplToWorkflow(document);
};

const valueToken = (value: string) => {
  if (/^\s*#/.test(value)) return 'text-[#737D69]';
  if (/\b(true|false|null)\b/.test(value)) return 'text-[#E76F51]';
  if (/[-+]?\d+(\.\d+)?/.test(value)) return 'text-[#2A9D8F]';
  return 'text-[#EAE3D9]';
};

const HighlightedYaml: React.FC<{ source: string; scrollTop: number; scrollLeft: number }> = ({
  source, scrollTop, scrollLeft,
}) => (
  <pre
    aria-hidden="true"
    className="absolute inset-0 m-0 overflow-hidden whitespace-pre font-mono text-[13px] leading-6 pointer-events-none"
    style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}
  >
    {source.split('\n').map((line, index) => {
      const comment = line.match(/^(\s*)(#.*)$/);
      const keyed = line.match(/^(\s*)([- ]*)([\w.-]+)(\s*:)(.*)$/);
      return (
        <React.Fragment key={`${index}-${line.length}`}>
          {comment ? <><span>{comment[1]}</span><span className="text-[#737D69]">{comment[2]}</span></>
            : keyed ? <>
              <span>{keyed[1]}{keyed[2]}</span>
              <span className="text-[#F4A261]">{keyed[3]}</span>
              <span className="text-[#A89F91]">{keyed[4]}</span>
              <span className={valueToken(keyed[5])}>{keyed[5]}</span>
            </> : <span className={valueToken(line)}>{line}</span>}
          {'\n'}
        </React.Fragment>
      );
    })}
  </pre>
);

export const AplEditor: React.FC<AplEditorProps> = ({ workflow, onApply }) => {
  const canonicalSource = useMemo(() => stringifyAPLYaml(workflowToAPL(workflow)), [workflow]);
  const [source, setSource] = useState(canonicalSource);
  const [error, setError] = useState<string | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dirty = source !== canonicalSource;

  const apply = () => {
    try {
      const parsed = validateSource(source);
      onApply({
        ...parsed,
        id: workflow.id,
        documentId: workflow.documentId,
        revision: workflow.revision,
        version: workflow.version,
        updatedAt: workflow.updatedAt,
        description: workflow.description,
      });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="flex-1 min-w-0 h-full bg-[#1A1614] flex flex-col" aria-label="APL YAML editor">
      <div className="h-12 border-b border-[#3A322E] px-4 flex items-center justify-between bg-[#211C19]">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-[#F4A261]" />
          <span className="text-xs font-semibold">{workflow.name}</span>
          <span className="text-[10px] font-mono text-[#2A9D8F] bg-[#2A9D8F]/10 border border-[#2A9D8F]/30 px-1.5 py-0.5 rounded">abada.io/v1</span>
          {dirty && <span className="text-[10px] text-[#F4A261]">Modified</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setSource(canonicalSource); setError(null); }}
            className="px-2.5 py-1.5 rounded-lg border border-[#3A322E] text-[11px] text-[#A89F91] hover:text-[#EAE3D9] flex items-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button onClick={apply}
            className="px-3 py-1.5 rounded-lg bg-[#F4A261] text-[#1A1614] text-[11px] font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Apply to diagram
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 m-4 rounded-xl border border-[#3A322E] bg-[#151210] overflow-hidden shadow-inner">
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#1C1816] border-r border-[#3A322E] text-right pr-3 pt-4 font-mono text-[11px] leading-6 text-[#655D55] select-none overflow-hidden">
          <div style={{ transform: `translateY(${-scroll.top}px)` }}>
            {source.split('\n').map((_, index) => <div key={index}>{index + 1}</div>)}
          </div>
        </div>
        <div className="absolute left-16 right-4 top-4 bottom-4 overflow-hidden">
          <HighlightedYaml source={source} scrollTop={scroll.top} scrollLeft={scroll.left} />
          <textarea
            ref={editorRef}
            value={source}
            onChange={(event) => { setSource(event.target.value); setError(null); }}
            onScroll={(event) => setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault(); apply();
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                const target = event.currentTarget;
                const start = target.selectionStart;
                const next = `${source.slice(0, start)}  ${source.slice(target.selectionEnd)}`;
                setSource(next);
                requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; });
              }
            }}
            spellCheck={false}
            aria-label="APL YAML source"
            className="absolute inset-0 w-full h-full resize-none overflow-auto whitespace-pre bg-transparent font-mono text-[13px] leading-6 outline-none text-transparent caret-[#F4A261] selection:bg-[#9D4EDD]/40"
            style={{ WebkitTextFillColor: 'transparent' }}
          />
        </div>
      </div>

      <div className="h-10 px-4 border-t border-[#3A322E] flex items-center text-[11px]">
        {error ? <span className="text-[#E76F51] flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</span>
          : <span className="text-[#737D69]">Paste or edit canonical APL YAML. Press Ctrl/⌘+S to validate and apply.</span>}
      </div>
    </section>
  );
};
