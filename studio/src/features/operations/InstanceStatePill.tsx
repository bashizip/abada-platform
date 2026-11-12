import React from 'react';
import type { ProcessInstanceDTO } from '@/api/engine';
import { StatusPill, type StatusTone } from '@/components/ui';
import { InstanceStatus, STATUS_META, statusOf } from '@/lib/run/instanceFormat';

const INSTANCE_TONE: Record<InstanceStatus, StatusTone> = {
  RUNNING: 'running',
  COMPLETED: 'success',
  FAILED: 'danger',
  SUSPENDED: 'warning',
  CANCELLED: 'neutral',
};

/**
 * The state of an instance as a pill. It pulses once when the state changes
 * (S1 `StatusPill`); a running instance breathes. `incident` overrides a
 * running state: the run is stuck until someone acts.
 */
export const InstanceStatePill: React.FC<{
  instance: ProcessInstanceDTO;
  incident?: boolean;
  className?: string;
}> = ({ instance, incident = false, className }) => {
  const status = statusOf(instance);
  if (incident && status === 'RUNNING') return <StatusPill tone="danger" label="Incident" className={className} />;
  return (
    <StatusPill tone={INSTANCE_TONE[status]} label={STATUS_META[status].label} live={status === 'RUNNING'}
      className={className} />
  );
};
