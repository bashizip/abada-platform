import { useState } from 'react';
import { SimulationLog } from '@/types';

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
  };
}
