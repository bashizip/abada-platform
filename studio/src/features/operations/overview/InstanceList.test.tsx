import React, { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessInstanceDTO } from '@/api/engine';
import { MotionProvider } from '@/components/ui';
import { render } from '@/test/render';
import { InstanceList } from './InstanceList';
import type { RowAction } from './InstanceRow';

const instances = (count: number): ProcessInstanceDTO[] => Array.from({ length: count }, (_, index) => ({
  id: `instance-${index}`, processDefinitionId: 'lead_triage', status: index % 7 === 0 ? 'COMPLETED' : 'RUNNING',
  startDate: new Date(Date.now() - index * 60_000).toISOString(), currentActivityId: 'classify_lead',
  variables: { leadId: `L-${index}` },
} as ProcessInstanceDTO));

const press = (key: string, target: EventTarget = window) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

const Harness: React.FC<{ rows: ProcessInstanceDTO[]; onAction: (action: RowAction, instance: ProcessInstanceDTO) => void;
  onLoadMore?: () => void; canOperate?: boolean }> = ({ rows, onAction, onLoadMore = () => undefined, canOperate = false }) => {
  const [cursor, setCursor] = useState(0);
  return (
    <MotionProvider>
      <input aria-label="search" />
      <InstanceList rows={rows} loading={false} loadingMore={false} hasMore={false} onLoadMore={onLoadMore}
        emptyProject={false} filtered={false} cursor={cursor} onCursorChange={setCursor}
        processOf={() => ({ name: 'Lead triage', version: 'v3' })} incidentInstanceIds={new Set(['instance-2'])}
        canOperate={canOperate} onAction={onAction} onSearch={() => undefined} />
    </MotionProvider>
  );
};

afterEach(() => { document.body.innerHTML = ''; });

describe('instance list', () => {
  it('renders 1 000 instances with a bounded number of rows, quickly', () => {
    const started = performance.now();
    const container = render(<Harness rows={instances(1000)} onAction={() => undefined} />);
    const elapsed = performance.now() - started;
    const rendered = container.querySelectorAll('[role="listitem"]');
    expect(rendered.length).toBeGreaterThan(5);
    expect(rendered.length).toBeLessThan(40);
    expect(elapsed).toBeLessThan(1000);
    expect(container.textContent).toContain('L-0');
    expect(container.textContent).not.toContain('L-999');
  });

  it('moves the cursor with j and k and opens the row under it with Enter', () => {
    const onAction = vi.fn();
    const container = render(<Harness rows={instances(20)} onAction={onAction} />);
    const current = () => container.querySelector('[aria-current="true"]')?.textContent ?? '';
    expect(current()).toContain('L-0');
    press('j');
    press('j');
    expect(current()).toContain('L-2');
    press('k');
    expect(current()).toContain('L-1');
    press('Enter');
    expect(onAction).toHaveBeenCalledWith('open', expect.objectContaining({ id: 'instance-1' }), 1);
  });

  it('ignores the shortcuts while the user types', () => {
    const onAction = vi.fn();
    const container = render(<Harness rows={instances(5)} onAction={onAction} />);
    const input = container.querySelector('input') as HTMLInputElement;
    press('j', input);
    press('Enter', input);
    expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('L-0');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('marks an instance with an open incident and offers state actions to operators only', () => {
    const viewer = render(<Harness rows={instances(3)} onAction={() => undefined} />);
    expect(viewer.textContent).toContain('Incident');
    expect(viewer.querySelector('[aria-label="Cancel"]')).toBeNull();
    document.body.innerHTML = '';
    const onAction = vi.fn();
    const operator = render(<Harness rows={instances(3)} onAction={onAction} canOperate />);
    act(() => { (operator.querySelector('[aria-label="Cancel"]') as HTMLButtonElement).click(); });
    expect(onAction).toHaveBeenCalledWith('cancel', expect.objectContaining({ id: 'instance-1' }), 1);
  });

  it('asks for the next page as the end comes into view', () => {
    const onLoadMore = vi.fn();
    render(
      <MotionProvider>
        <InstanceList rows={instances(10)} loading={false} loadingMore={false} hasMore onLoadMore={onLoadMore}
          emptyProject={false} filtered={false} cursor={0} onCursorChange={() => undefined}
          processOf={() => ({ name: 'Lead triage', version: '' })} incidentInstanceIds={new Set()}
          canOperate={false} onAction={() => undefined} onSearch={() => undefined} />
      </MotionProvider>,
    );
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('shows the empty project with its next step', () => {
    const container = render(
      <MotionProvider>
        <InstanceList rows={[]} loading={false} loadingMore={false} hasMore={false} onLoadMore={() => undefined}
          emptyProject filtered={false} cursor={0} onCursorChange={() => undefined}
          processOf={() => ({ name: '', version: '' })} incidentInstanceIds={new Set()} canOperate={false}
          onAction={() => undefined} onSearch={() => undefined} emptyAction={<button type="button">Open the designer</button>} />
      </MotionProvider>,
    );
    expect(container.textContent).toContain('No process has run in this project yet');
    expect(container.textContent).toContain('Open the designer');
  });
});
