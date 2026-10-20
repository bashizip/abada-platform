import { useCallback, useMemo, useReducer, useRef } from 'react';
import { AuthoringAPI, EngineUnreachableError } from '@/api/authoring';
import { aplToWorkflow, parseAPLYaml, stringifyAPLYaml, workflowToAPL } from '@/lib/apl/parser';
import type { WorkflowFile } from '@/types';
import {
  authoringReducer, currentDraft, hasDraft, initialSession, nextRequest, pendingTurn,
  type AuthoringSessionState,
} from './authoringSession';

let sequence = 0;

/**
 * Waits before asking again when the engine did not answer (it may be starting). Nothing was
 * generated, so a repeat cannot double a draft; a model call that did start is never repeated.
 */
export const UNREACHABLE_RETRY_DELAYS_MS = [2000, 4000, 8000];

const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true });
});
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++sequence}`;

/** The draft keeps the identity of what it will replace (or of the new draft it will become). */
function adopt(parsed: WorkflowFile, state: AuthoringSessionState): WorkflowFile {
  const { origin } = state;
  return {
    ...parsed,
    id: origin.id,
    documentId: origin.documentId,
    revision: origin.revision,
    version: origin.version,
    updatedAt: origin.updatedAt,
    folderId: origin.folderId ?? parsed.folderId,
  };
}

function readableError(error: unknown): string {
  if (error instanceof EngineUnreachableError) {
    return 'The engine could not be reached; it may be starting or restarting. Try again in a moment.';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\b403\b/.test(message) || /OWNER or MAINTAINER/i.test(message)) {
    return 'Drafting with AI needs the Owner or Maintainer role in this project.';
  }
  // The client prefixes the HTTP status; the engine's sentence is what the user needs.
  const sentence = message.replace(/^\d{3}\s+/, '').trim();
  if (!sentence) return 'The authoring service did not answer.';
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * An AI draft session (M5 S12). Each prompt is one call to the authoring service: CREATE while
 * the draft is empty, then REFINE (patch mode) from the draft as the user sees it, including their
 * own edits. The call runs in the authoring service, outside any workflow transaction; cancelling
 * only stops waiting for the answer.
 */
export function useAuthoringSession(projectId: string | undefined, origin: WorkflowFile, target: 'replace' | 'new') {
  const [state, dispatch] = useReducer(authoringReducer, undefined, () => initialSession(origin, target));
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef<{ id: string; controller: AbortController } | null>(null);

  const submit = useCallback(async (text: string) => {
    const prompt = text.trim();
    const snapshot = stateRef.current;
    if (!prompt || inFlight.current || pendingTurn(snapshot) || !projectId) return;
    const request = nextRequest(snapshot);
    const base = currentDraft(snapshot);
    const id = nextId('turn');
    const controller = new AbortController();
    inFlight.current = { id, controller };
    dispatch({ type: 'start', id, text: prompt, request, at: Date.now() });
    try {
      const baseSource = request === 'REFINE' ? stringifyAPLYaml(workflowToAPL(base)) : undefined;
      let candidate;
      for (let attempt = 0; ; attempt++) {
        try {
          candidate = await AuthoringAPI.generate(projectId, prompt, request === 'REFINE' ? 'refine' : 'new',
            baseSource, controller.signal);
          break;
        } catch (error) {
          if (!(error instanceof EngineUnreachableError) || attempt >= UNREACHABLE_RETRY_DELAYS_MS.length
            || controller.signal.aborted) throw error;
          dispatch({ type: 'notice', id, notice: 'The engine is not answering yet (it may be starting). Asking again…' });
          await pause(UNREACHABLE_RETRY_DELAYS_MS[attempt], controller.signal);
          if (controller.signal.aborted) return;
        }
      }
      if (controller.signal.aborted) return;
      const draft = adopt(aplToWorkflow(parseAPLYaml(candidate.aplSource)), stateRef.current);
      dispatch({
        type: 'resolve', id, draft, summary: candidate.summary, operations: candidate.patch?.length,
        attempts: candidate.attempts, model: candidate.model, warnings: candidate.warnings ?? [],
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({ type: 'fail', id, error: readableError(error) });
    } finally {
      if (inFlight.current?.id === id) inFlight.current = null;
    }
  }, [projectId]);

  const cancel = useCallback(() => {
    const flight = inFlight.current;
    if (!flight) return;
    flight.controller.abort();
    inFlight.current = null;
    dispatch({ type: 'cancel', id: flight.id });
  }, []);

  const retry = useCallback((turnId: string) => {
    const turn = stateRef.current.turns.find((t) => t.id === turnId);
    if (!turn || turn.status !== 'failed') return;
    dispatch({ type: 'remove', id: turnId });
    // The reducer has already run when the next submit reads the state ref on the next render.
    stateRef.current = authoringReducer(stateRef.current, { type: 'remove', id: turnId });
    void submit(turn.text);
  }, [submit]);

  const dismiss = useCallback((turnId: string) => dispatch({ type: 'remove', id: turnId }), []);
  const undoTo = useCallback((turnId: string) => dispatch({ type: 'undoTo', id: turnId }), []);
  const restore = useCallback(() => dispatch({ type: 'restore' }), []);

  /** The user's own change to the draft; the next refinement starts from it. */
  const edit = useCallback((updater: (draft: WorkflowFile) => WorkflowFile, description: string, nodeId?: string) => {
    const snapshot = stateRef.current;
    if (pendingTurn(snapshot)) return;
    const draft = updater(currentDraft(snapshot));
    dispatch({ type: 'edit', id: nextId('edit'), nodeId, text: description, draft, at: Date.now() });
  }, []);

  const draft = useMemo(() => currentDraft(state), [state]);
  return {
    state,
    draft,
    pending: pendingTurn(state),
    canApply: hasDraft(state) && !pendingTurn(state),
    submit,
    cancel,
    retry,
    dismiss,
    undoTo,
    restore,
    edit,
  };
}
