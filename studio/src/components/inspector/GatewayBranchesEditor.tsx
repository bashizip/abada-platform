import React from 'react';
import type { WorkflowEdge, WorkflowNode } from '@/types';
import { branchProblem, edgeCondition, isElseBranch } from '@/lib/apl/gatewayRules';

const FIELD = 'w-full bg-charcoal border border-hairline rounded-lg px-2 py-1.5 text-xs text-linen font-mono focus:outline-none focus:border-saffron';
const LABEL = 'text-[10px] text-sand block';
const ERROR = 'text-[10px] text-desert-rose';

/**
 * The rules of a condition / inclusive gateway, one per outgoing branch: its
 * CEL condition (saved as the rule's `if`) or the else mark. Order is the
 * order of the outgoing edges, which is the order the engine evaluates.
 */
export const GatewayBranchesEditor: React.FC<{
  branches: WorkflowEdge[];
  nodes: WorkflowNode[];
  inclusive: boolean;
  onConditionChange: (edgeId: string, condition: string) => void;
  onElseChange: (edgeId: string, isElse: boolean) => void;
}> = ({ branches, nodes, inclusive, onConditionChange, onElseChange }) => {
  const title = (id: string) => nodes.find((node) => node.id === id)?.title || id;

  if (branches.length < 2) {
    return (
      <p className="text-[10px] text-sand leading-relaxed">
        {branches.length === 0
          ? 'Connect at least two outgoing edges to give this gateway branches.'
          : inclusive
            ? 'One outgoing edge: this gateway is a join and continues along it.'
            : 'Connect a second outgoing edge to give this gateway branches.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <span className={LABEL}>
        Branches — {inclusive ? 'every branch whose condition matches fires' : 'the first matching branch wins'}, in this order
      </span>
      {branches.map((edge, index) => {
        // An explicit else is marked on the edge; the last branch left without
        // a condition is the else branch too, but stays open for one.
        const markedElse = !edgeCondition(edge) && !!edge.label?.toLowerCase().includes('else');
        const implicitElse = !markedElse && isElseBranch(edge, index, branches);
        const problem = branchProblem(edge, index, branches);
        const target = title(edge.target);
        return (
          <div key={edge.id} className="p-2.5 bg-charcoal rounded-xl border border-hairline space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-linen truncate">→ {target}</span>
              <label className="flex items-center gap-1 text-[10px] text-sand shrink-0">
                <input
                  type="checkbox"
                  checked={markedElse}
                  onChange={(event) => onElseChange(edge.id, event.target.checked)}
                  aria-label={`Else branch to ${target}`}
                />
                else
              </label>
            </div>
            {!markedElse && (
              <input
                type="text"
                value={edge.condition ?? edgeCondition(edge) ?? ''}
                onChange={(event) => onConditionChange(edge.id, event.target.value)}
                className={FIELD}
                placeholder={'risk == "low"'}
                aria-label={`Condition to ${target}`}
              />
            )}
            {implicitElse && <p className={LABEL}>No condition: this is the else branch.</p>}
            {problem && <p className={ERROR}>{problem}</p>}
          </div>
        );
      })}
      <p className="text-[10px] text-sand leading-relaxed">
        Conditions are CEL over the process variables, e.g. <code>amount &gt; 1000</code>.
        The last branch without a condition becomes the else branch.
      </p>
    </div>
  );
};
