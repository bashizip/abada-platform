import { useState } from 'react';
import { SimulationLog } from '@/types';
import type { PathView } from '@/lib/run/instancePath';

export function useDryRunSimulation() {
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationLogs, setSimulationLogs] = useState<SimulationLog[]>([]);
  // The run log is contextual UI, not a persistent workspace panel. Starting
  // closed keeps an empty audit dialog from covering every fresh canvas.
  const [showLogPanel, setShowLogPanel] = useState<boolean>(false);
  const [showRunPanel, setShowRunPanel] = useState<boolean>(false);
  const [dryRunFingerprint, setDryRunFingerprint] = useState<string | null>(null);
  const [lastDryRunPayload, setLastDryRunPayload] = useState<Record<string, unknown>>({});
  const [activeSimulationNodeId, setActiveSimulationNodeId] = useState<string | null>(null);
  /** The path the dry run took, drawn with the instance path layers. */
  const [dryRunPath, setDryRunPath] = useState<PathView | undefined>(undefined);

  return {
    isSimulating,
    setIsSimulating,
    simulationLogs,
    setSimulationLogs,
    showLogPanel,
    setShowLogPanel,
    showRunPanel,
    setShowRunPanel,
    dryRunFingerprint,
    setDryRunFingerprint,
    lastDryRunPayload,
    setLastDryRunPayload,
    activeSimulationNodeId,
    setActiveSimulationNodeId,
    dryRunPath,
    setDryRunPath,
  };
}
