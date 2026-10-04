import React, { useEffect, useRef, useState } from 'react';
import type { WorkflowNode } from '@/types';
import { type Route, routeLabel, routesFor, timeoutError } from '@/lib/apl/routes';

interface ConnectMenuProps {
  source: WorkflowNode;
  target: WorkflowNode;
  /** Screen position of the drop, relative to the canvas wrapper. */
  x: number;
  y: number;
  onChoose: (route: Route) => void;
  onCancel: () => void;
}

const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * What a new connection means. Dropping a connection from a task opens this
 * menu with only the routes that step supports; a timeout asks for its
 * duration and an error route may name the error code it catches.
 */
export const ConnectMenu: React.FC<ConnectMenuProps> = ({ source, target, x, y, onChoose, onCancel }) => {
  const [pending, setPending] = useState<'timeout' | 'error' | null>(null);
  const [after, setAfter] = useState('PT1H');
  const [code, setCode] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onCancel();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onCancel]);

  const timeoutProblem = pending === 'timeout' ? timeoutError(after) : null;
  const codeProblem = pending === 'error' && code.trim() && !ERROR_CODE.test(code.trim())
    ? 'Letters, digits and . _ : - only' : null;

  const choose = (route: Route) => {
    if (route.kind === 'timeout') { setPending('timeout'); return; }
    if (route.kind === 'error') { setPending('error'); return; }
    onChoose(route);
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Connect ${source.title} to ${target.title}`}
      className="absolute z-50 w-56 rounded-xl border border-[#3A322E] bg-[#25201D] p-2 shadow-warm-lg"
      style={{ left: x, top: y }}
    >
      <p className="px-1 pb-1.5 text-[10px] text-[#A89F91]">
        {source.title} → {target.title}
      </p>
      {pending === null && routesFor(source).map((route) => (
        <button
          key={route.kind === 'outcome' ? `outcome:${route.name}` : route.kind}
          role="menuitem"
          onClick={() => choose(route)}
          className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-[#EAE3D9] hover:bg-[#3A322E]"
        >
          {routeLabel(route)}
        </button>
      ))}
      {pending === 'timeout' && (
        <form
          className="space-y-1.5 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!timeoutProblem) onChoose({ kind: 'timeout', after: after.trim().toUpperCase() });
          }}
        >
          <label className="block text-[10px] text-[#A89F91]" htmlFor="connect-timeout">Time out after (ISO-8601)</label>
          <input
            id="connect-timeout"
            autoFocus
            value={after}
            onChange={(event) => setAfter(event.target.value)}
            className="w-full rounded-lg border border-[#3A322E] bg-[#1A1614] px-2 py-1 font-mono text-xs text-[#EAE3D9] outline-none"
          />
          {timeoutProblem && <p className="text-[10px] text-[#E76F51]">{timeoutProblem}</p>}
          <button type="submit" disabled={!!timeoutProblem}
            className="w-full rounded-lg bg-[#F4A261] py-1 text-xs font-semibold text-[#1A1614] disabled:opacity-40">
            Add timeout
          </button>
        </form>
      )}
      {pending === 'error' && (
        <form
          className="space-y-1.5 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!codeProblem) onChoose({ kind: 'error', ...(code.trim() ? { code: code.trim() } : {}) });
          }}
        >
          <label className="block text-[10px] text-[#A89F91]" htmlFor="connect-error-code">
            Error code (empty catches every error and the last failed attempt)
          </label>
          <input
            id="connect-error-code"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="e.g. CUSTOMER_UNKNOWN"
            className="w-full rounded-lg border border-[#3A322E] bg-[#1A1614] px-2 py-1 font-mono text-xs text-[#EAE3D9] outline-none"
          />
          {codeProblem && <p className="text-[10px] text-[#E76F51]">{codeProblem}</p>}
          <button type="submit" disabled={!!codeProblem}
            className="w-full rounded-lg bg-[#E76F51] py-1 text-xs font-semibold text-[#1A1614] disabled:opacity-40">
            Add error route
          </button>
        </form>
      )}
    </div>
  );
};
