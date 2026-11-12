import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buttons, byLabel, click, render, type } from '@/test/render';
import type { AdminAuditEvent } from '@/api/admin';
import { actionLabel, dayBound } from '@/lib/adminAudit';
import { AdminAuditTrail } from './AdminAuditTrail';

const api = vi.hoisted(() => ({ list: vi.fn(), catalog: vi.fn(), exportCsv: vi.fn() }));
vi.mock('@/api/admin', () => ({ AdminAuditAPI: api }));

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function event(id: number, overrides: Partial<AdminAuditEvent> = {}): AdminAuditEvent {
  return {
    id, occurredAt: '2026-11-12T10:00:00Z', actor: 'root', actorPrincipalId: 'p-1',
    actorRoles: ['ROLE_ABADA_ADMIN'], action: 'project.update', targetType: 'project', targetId: `proj-${id}`,
    projectId: `proj-${id}`, outcome: 'SUCCESS', traceId: 'a1b2c3', clientIp: '10.0.0.4',
    details: { name: { before: 'Payroll', after: 'Payroll declarations' } }, ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('administration audit trail', () => {
  it('lists events and opens the before/after details of one', async () => {
    api.catalog.mockResolvedValue({ actions: ['project.update', 'ai-provider.save'], outcomes: ['SUCCESS', 'DENIED'] });
    api.list.mockResolvedValue({ items: [event(2), event(1, { outcome: 'DENIED', actor: 'bob', details: { reason: 'NOT_A_MEMBER' } })], nextCursor: null });
    const container = render(<AdminAuditTrail pollMs={0} />);
    await settle();

    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Project update');
    expect(rows[1].textContent).toContain('Denied');

    await act(async () => { click(rows[0]); });
    const drawer = document.querySelector('[role="dialog"][aria-label="Audit event details"]');
    expect(drawer?.textContent).toContain('ROLE_ABADA_ADMIN');
    expect(drawer?.textContent).toContain('a1b2c3');
    expect(drawer?.textContent).toContain('Payroll declarations');

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('[aria-label="Audit event details"]')).toBeNull();
  });

  it('sends the filters to the server and loads older pages with the cursor', async () => {
    api.catalog.mockResolvedValue({ actions: ['project.update'], outcomes: ['SUCCESS', 'DENIED'] });
    api.list.mockResolvedValue({ items: [event(9)], nextCursor: 9 });
    const container = render(<AdminAuditTrail pollMs={0} />);
    await settle();

    type(byLabel<HTMLInputElement>(container, 'Actor')!, 'bob');
    type(byLabel<HTMLSelectElement>(container, 'Outcome')!, 'DENIED');
    type(byLabel<HTMLInputElement>(container, 'From')!, '2026-11-01');
    await act(async () => { click(buttons(container).find((item) => item.textContent === 'Apply')!); });
    await settle();
    expect(api.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: 'bob', outcome: 'DENIED', from: '2026-11-01T00:00:00.000Z' }), { limit: 50 });

    api.list.mockResolvedValue({ items: [event(4)], nextCursor: null });
    await act(async () => { click(buttons(container).find((item) => item.textContent === 'Load older events')!); });
    await settle();
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'bob' }), { cursor: 9, limit: 50 });
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('adds newer events at the top while the first page is shown', async () => {
    vi.useFakeTimers();
    api.catalog.mockResolvedValue({ actions: [], outcomes: ['SUCCESS', 'DENIED'] });
    api.list.mockResolvedValueOnce({ items: [event(5)], nextCursor: null });
    const container = render(<AdminAuditTrail pollMs={1000} />);
    await settle();

    api.list.mockResolvedValueOnce({ items: [event(6, { action: 'ai-provider.save' })], nextCursor: null });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await settle();
    expect(api.list).toHaveBeenLastCalledWith(expect.any(Object), { after: 5, limit: 50 });
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-event-id')).toBe('6');
  });

  it('says why the trail is empty', async () => {
    api.catalog.mockResolvedValue({ actions: [], outcomes: [] });
    api.list.mockResolvedValue({ items: [], nextCursor: null });
    const container = render(<AdminAuditTrail pollMs={0} />);
    await settle();
    expect(container.textContent).toContain('No administrative action recorded yet');
  });

  it('shows a refused read as an error', async () => {
    api.catalog.mockRejectedValue(new Error('forbidden'));
    api.list.mockRejectedValue(new Error('The authenticated identity does not have permission for this operation'));
    const container = render(<AdminAuditTrail pollMs={0} />);
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not have permission');
  });
});

describe('audit helpers', () => {
  it('turns date inputs into UTC day bounds and actions into labels', () => {
    expect(dayBound('2026-11-12', false)).toBe('2026-11-12T00:00:00.000Z');
    expect(dayBound('2026-11-12', true)).toBe('2026-11-13T00:00:00.000Z');
    expect(dayBound('12/11/2026', false)).toBeUndefined();
    expect(actionLabel('project.member.put')).toBe('Project member put');
    expect(actionLabel('ai-provider.save')).toBe('Ai provider save');
  });
});
