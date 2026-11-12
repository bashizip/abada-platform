import type { WorkflowFile } from '@/types';

/**
 * The conversation of an AI draft (M5 S12), kept in the Studio only: the authoring service is
 * stateless and sees, on each refinement, the current draft and the new prompt, never the thread.
 */
export type TurnStatus = 'pending' | 'done' | 'failed';

export interface AuthoringTurn {
  id: string;
  /** A prompt sent to the model, or the user's own edit of the draft. */
  kind: 'prompt' | 'edit';
  text: string;
  status: TurnStatus;
  startedAt: number;
  /** CREATE for a new process, REFINE (patch mode) from the current draft. */
  request?: 'CREATE' | 'REFINE';
  /** The draft after this turn (done turns only). */
  draft?: WorkflowFile;
  summary?: string;
  /** Number of patch operations the engine applied (REFINE). */
  operations?: number;
  attempts?: number;
  model?: string;
  warnings?: string[];
  error?: string;
  /** For an edit: the node it changed, so typing in one field stays one turn. */
  nodeId?: string;
  /** While pending: why the answer is taking longer (the engine is being asked again). */
  notice?: string;
  /** Set aside by "undo to here"; restored, or dropped by the next prompt or edit. */
  setAside?: boolean;
}

export interface AuthoringSessionState {
  /** The process the draft is compared with (and refined from first, when it has steps). */
  origin: WorkflowFile;
  /** Apply replaces the open process, or opens the draft as a new one. */
  target: 'replace' | 'new';
  turns: AuthoringTurn[];
}

export type AuthoringAction =
  | { type: 'start'; id: string; text: string; request: 'CREATE' | 'REFINE'; at: number }
  | { type: 'resolve'; id: string; draft: WorkflowFile; summary?: string; operations?: number; attempts: number;
      model?: string; warnings: string[] }
  | { type: 'fail'; id: string; error: string }
  | { type: 'notice'; id: string; notice: string }
  | { type: 'cancel'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'undoTo'; id: string }
  | { type: 'restore' }
  | { type: 'edit'; id: string; nodeId?: string; text: string; draft: WorkflowFile; at: number };

export function emptyDraft(origin: WorkflowFile): WorkflowFile {
  return { ...origin, nodes: [], edges: [] };
}

export function initialSession(origin: WorkflowFile, target: 'replace' | 'new'): AuthoringSessionState {
  return { origin, target, turns: [] };
}

const live = (turn: AuthoringTurn) => !turn.setAside && turn.status === 'done' && !!turn.draft;

/** The draft as the user sees it: the last live turn, or where the session started. */
export function currentDraft(state: AuthoringSessionState): WorkflowFile {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const turn = state.turns[i];
    if (live(turn)) return turn.draft!;
  }
  return state.target === 'replace' ? state.origin : emptyDraft(state.origin);
}

export function pendingTurn(state: AuthoringSessionState): AuthoringTurn | undefined {
  return state.turns.find((turn) => turn.status === 'pending');
}

/** Something to apply: at least one live turn. */
export function hasDraft(state: AuthoringSessionState): boolean {
  return state.turns.some(live);
}

/** What the next prompt asks the authoring service for. */
export function nextRequest(state: AuthoringSessionState): 'CREATE' | 'REFINE' {
  return currentDraft(state).nodes.length > 0 ? 'REFINE' : 'CREATE';
}

/** A new prompt or edit after "undo to here" drops the turns set aside, and failed attempts. */
const settle = (turns: AuthoringTurn[]) => turns.filter((turn) => !turn.setAside && turn.status !== 'failed');

export function authoringReducer(state: AuthoringSessionState, action: AuthoringAction): AuthoringSessionState {
  switch (action.type) {
    case 'start':
      if (pendingTurn(state)) return state;
      return { ...state, turns: [...settle(state.turns), {
        id: action.id, kind: 'prompt', text: action.text, status: 'pending', startedAt: action.at, request: action.request,
      }] };
    case 'resolve':
      return { ...state, turns: state.turns.map((turn) => turn.id === action.id && turn.status === 'pending' ? {
        ...turn, status: 'done', draft: action.draft, summary: action.summary, operations: action.operations,
        attempts: action.attempts, model: action.model, warnings: action.warnings,
      } : turn) };
    case 'fail':
      return { ...state, turns: state.turns.map((turn) => turn.id === action.id && turn.status === 'pending'
        ? { ...turn, status: 'failed', error: action.error } : turn) };
    case 'notice':
      return { ...state, turns: state.turns.map((turn) => turn.id === action.id && turn.status === 'pending'
        ? { ...turn, notice: action.notice } : turn) };
    case 'cancel':
      return { ...state, turns: state.turns.filter((turn) => !(turn.id === action.id && turn.status === 'pending')) };
    case 'remove':
      return { ...state, turns: state.turns.filter((turn) => turn.id !== action.id) };
    case 'undoTo': {
      if (pendingTurn(state)) return state;
      const index = state.turns.findIndex((turn) => turn.id === action.id);
      if (index < 0) return state;
      return { ...state, turns: state.turns.map((turn, i) => (i > index && turn.status === 'done' ? { ...turn, setAside: true } : turn)) };
    }
    case 'restore':
      return { ...state, turns: state.turns.map((turn) => (turn.setAside ? { ...turn, setAside: false } : turn)) };
    case 'edit': {
      if (pendingTurn(state)) return state;
      const turns = settle(state.turns);
      const last = turns[turns.length - 1];
      // Successive changes to the same node (typing in a field) are one edit.
      if (last && last.kind === 'edit' && action.nodeId && last.nodeId === action.nodeId) {
        return { ...state, turns: [...turns.slice(0, -1), { ...last, text: action.text, draft: action.draft }] };
      }
      return { ...state, turns: [...turns, {
        id: action.id, kind: 'edit', text: action.text, status: 'done', startedAt: action.at, draft: action.draft,
        nodeId: action.nodeId,
      }] };
    }
    default:
      return state;
  }
}
