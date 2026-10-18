import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityHistoryDTO, FlowTakenDTO } from '@/api/engine';
import type { WorkflowFile, WorkflowNode } from '@/types';
import { usePacedPlayback } from '@/hooks/usePacedPlayback';
import { trailPrefix } from '@/hooks/useInstancePlayback';
import { resetPlaybackPaceForTests } from '@/lib/run/playbackPace';
import { LiveAuditTrail, type LiveAuditTrailProps } from './LiveAuditTrail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = (id: string, type: WorkflowNode['type'], extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id, type, title: id[0].toUpperCase() + id.slice(1), description: '', x: 0, y: 0, ...extra });
const workflow: WorkflowFile = {
  id: 'p', name: 'p', category: 'custom', fileType: 'apl', version: '1', updatedAt: '2026-10-17T00:00:00Z',
  nodes: [
    node('start', 'event', { subtype: 'start' }),
    node('charge', 'engine-task'),
    node('review', 'human'),
    node('score', 'agent', { agentConfig: { model: 'gpt-4o', systemPrompt: 'SECRET SYSTEM PROMPT', confidenceThreshold: 0, temperature: 0, tools: [] } }),
    node('tier', 'dmn', { dmnConfig: { decisionKey: 'LOAN_TIER', hitPolicy: 'FIRST', inputs: [{ name: 'score' }], outputs: [],
      rules: [
        { id: 'r0', when: 'score >= 750', then: { tier: 'A' } },
        { id: 'r1', when: 'score >= 600', then: { tier: 'B', auto_approve: false } },
      ] } }),
    node('done', 'event', { subtype: 'end' }),
  ],
  edges: [],
};

let sequence = 0;
const event = (eventType: string, activityId: string | undefined, details: Record<string, unknown> = {},
  actor = 'system'): ActivityHistoryDTO => ({
  id: `h${++sequence}`, processInstanceId: 'i', processDefinitionId: 'p', activityId, eventType, actor,
  occurredAt: new Date(Date.UTC(2026, 9, 17, 10, 0, 0, sequence)).toISOString(), details,
});
const flow = (from: string, to: string): ActivityHistoryDTO => {
  const taken: FlowTakenDTO = { id: `Flow_${from}_${to}`, from, to, tokenId: 't' };
  return { ...event('FLOW_TAKEN', from, { flow: taken }), flow: taken };
};
const isStep = (fact: ActivityHistoryDTO) => fact.eventType === 'FLOW_TAKEN';

/** The view's wiring: paced playback, then the trail prefix, then the trail. */
const Played: React.FC<{ facts: ActivityHistoryDTO[] } & Partial<LiveAuditTrailProps>> = ({ facts, ...props }) => {
  const { visible, lag } = usePacedPlayback(facts, { id: (fact) => fact.id, isStep, pace: 'calm' });
  const trail = lag === 0 ? facts : trailPrefix(facts, visible.length, isStep);
  return <LiveAuditTrail history={trail} workflow={workflow} {...props} />;
};

let container: HTMLDivElement;
let root: Root;
const show = (facts: ActivityHistoryDTO[], props: Partial<LiveAuditTrailProps> = {}) =>
  act(() => { root.render(<Played facts={facts} {...props} />); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const titles = () => [...container.querySelectorAll('li[data-entry-id] > button > div:first-child > span:first-child')]
  .map((element) => element.textContent);
const scroller = () => container.querySelector<HTMLDivElement>('[data-testid="audit-trail-scroller"]')!;
const button = (text: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(text));

const scrollTo = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  resetPlaybackPaceForTests();
  window.localStorage.clear();
  sequence = 0;
  scrollTo.mockReset();
  HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('the live audit trail', () => {
  it('adds entries in event order, each when its node becomes active on the canvas', () => {
    const opening = [event('PROCESS_STARTED', 'start', {}, 'alice'), flow('start', 'charge')];
    show(opening);
    expect(titles()).toEqual(['Instance started', 'Charge · Running']);

    // The engine ran on: the trail follows the playback, one step per dwell.
    const ran = [...opening, flow('charge', 'review'), event('TASK_CREATED', 'review', { assignee: '' })];
    show(ran);
    advance(0);
    // The task created with the step that entered Review: the entry waits for a person, not one dwell later.
    expect(titles()).toEqual(['Instance started', 'Charge · Ran', 'Review · Waiting for a person']);

    const decided = [...ran,
      event('TASK_COMPLETED', 'review', { outcome: 'APPROVE', commented: true, commentLength: 12 }, 'bob'),
      flow('review', 'score'), flow('score', 'done')];
    show(decided);
    expect(titles()).toEqual(['Instance started', 'Charge · Ran', 'Review · Decided APPROVE']);
    advance(700);
    expect(titles()).toEqual(['Instance started', 'Charge · Ran', 'Review · Decided APPROVE', 'Score · Waiting for a worker']);
    advance(700);
    expect(titles()).toEqual(['Instance started', 'Charge · Ran', 'Review · Decided APPROVE', 'Score · Completed',
      'Done · Reached the end']);
  });

  it('follows new entries at the bottom, and counts them in a pill once the user scrolled up', () => {
    const opening = [event('PROCESS_STARTED', 'start'), flow('start', 'charge')];
    show(opening);
    const element = scroller();
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 200 });

    const toReview = flow('charge', 'review');
    show([...opening, toReview]);
    advance(0);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'smooth' });

    scrollTo.mockClear();
    element.scrollTop = 100;
    act(() => { element.dispatchEvent(new Event('scroll')); });
    show([...opening, toReview, flow('review', 'done')]);
    advance(700);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(button('1 new entry')).toBeTruthy();

    act(() => { button('1 new entry')!.click(); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(button('new entr')).toBeUndefined();
  });

  it('rings the node of the entry under the pointer, and filters to the node clicked on the canvas', () => {
    const onHoverNode = vi.fn();
    const onClearFilter = vi.fn();
    const facts = [event('PROCESS_STARTED', 'start'), flow('start', 'charge'), flow('charge', 'review')];
    show(facts, { onHoverNode });
    const charge = [...container.querySelectorAll('li[data-entry-id]')][1];
    act(() => { charge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(onHoverNode).toHaveBeenLastCalledWith('charge');
    act(() => { charge.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    expect(onHoverNode).toHaveBeenLastCalledWith(null);

    show(facts, { filterNodeId: 'review', onClearFilter });
    expect(titles()).toEqual(['Review · Waiting for a person']);
    act(() => { button('Review')!.click(); });
    expect(onClearFilter).toHaveBeenCalled();
  });

  it('shows only the redacted fields the history holds: the outcome and a comment length, no prompt', () => {
    const facts = [flow('start', 'review'),
      event('TASK_COMPLETED', 'review', { outcome: 'REJECT', commented: true, commentLength: 42 }, 'bob'),
      flow('review', 'score'),
      event('EXTERNAL_TASK_LOCKED', 'score', { externalTaskId: 'job', workerId: 'abada-agent' }),
      flow('score', 'done'),
      event('EXTERNAL_TASK_COMPLETED', 'score', { externalTaskId: 'job', agent: { model: 'gpt-4o', promptHash: 'a1b2c3d4e5f6' } }),
    ];
    show(facts);
    expect(container.textContent).toContain('Agent · gpt-4o · prompt #a1b2c3d4');
    act(() => { button('Review')!.click(); });
    expect(container.textContent).toContain('commented (42 characters)');
    expect(container.textContent).not.toContain('SECRET SYSTEM PROMPT');
  });

  it('shows the decision rule that matched, from the deployed table, with input names but no values', () => {
    const facts = [flow('start', 'tier'),
      event('DECISION_TABLE_APPLIED', 'tier', { decisionKey: 'LOAN_TIER', matchedRuleIndexes: [1],
        inputNames: ['score'], outputNames: ['tier', 'auto_approve'] }),
      flow('tier', 'done'),
    ];
    show(facts);
    expect(titles()).toContain('Tier · Applied rule #2');
    expect(container.textContent).toContain('when score >= 600');
    act(() => { button('Tier')!.click(); });
    const decision = container.querySelector('[aria-label="Decision"]')!;
    expect(decision.textContent).toContain('Rule 2');
    expect(decision.textContent).toContain('tier = B');
    expect(decision.textContent).toContain('auto_approve = false');
    expect(decision.textContent).toContain('input values are not recorded');
  });
});
