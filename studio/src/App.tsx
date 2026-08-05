import React, { useState } from 'react';
import { INITIAL_WORKFLOWS } from '@/data/sampleWorkflows';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { Canvas } from '@/features/designer/Canvas';
import { PropertiesInspector } from '@/components/PropertiesInspector';
import { NLInputBar } from '@/components/NLInputBar';
import { SimulationPanel } from '@/components/SimulationPanel';
import { NewWorkflowModal } from '@/components/NewWorkflowModal';
import { TaskInbox } from '@/features/inbox/TaskInbox';
import { ProcessOperations } from '@/features/operations/ProcessOperations';
import { EngineAPI } from '@/api/engine';
import { SemaflowAPI } from '@/api/semaflow';
import { transpileBPMNToAPL } from '@/lib/bpmn/transpiler';
import { aplToWorkflow } from '@/lib/apl/parser';
import { WorkflowFile, WorkflowNode, WorkflowEdge, NodeType, SimulationLog, AgentConfig } from '@/types';

type StudioView = 'designer' | 'inbox' | 'operations';

export default function App() {
  const [workflows, setWorkflows] = useState<WorkflowFile[]>(INITIAL_WORKFLOWS);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(INITIAL_WORKFLOWS[0].id);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('agent-fraud');
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<StudioView>('designer');
  
  // Simulation & Audit logs state
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [activeSimulationNodeId, setActiveSimulationNodeId] = useState<string | null>(null);
  const [simulationLogs, setSimulationLogs] = useState<SimulationLog[]>([]);
  const [showLogPanel, setShowLogPanel] = useState<boolean>(true);

  // Workflow Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);

  // Get active workflow object
  const currentWorkflow = workflows.find((w) => w.id === activeWorkflowId) || workflows[0];
  const selectedNode = currentWorkflow.nodes.find((n) => n.id === selectedNodeId) || null;

  // Helper to update active workflow nodes/edges
  const updateActiveWorkflow = (updater: (wf: WorkflowFile) => WorkflowFile) => {
    setWorkflows((prev) =>
      prev.map((wf) => (wf.id === activeWorkflowId ? updater(wf) : wf))
    );
  };

  // Node Actions
  const handleNodeMove = (id: string, x: number, y: number) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    }));
  };

  const handleUpdateNode = (updatedNode: WorkflowNode) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === updatedNode.id) ? updatedNode : n),
    }));
  };

  const handleDeleteNode = (id: string) => {
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: wf.nodes.filter((n) => n.id !== id),
      edges: wf.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const handleDuplicateNode = (id: string) => {
    const target = currentWorkflow.nodes.find((n) => n.id === id);
    if (!target) return;
    const newNode: WorkflowNode = {
      ...target,
      id: `${target.type}-${Date.now()}`,
      title: `${target.title} (Copy)`,
      x: target.x + 40,
      y: target.y + 40,
    };
    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
    }));
    setSelectedNodeId(newNode.id);
  };

  const handleAddNode = (type: NodeType) => {
    const id = `${type}-${Date.now()}`;
    const defaultTitles: Record<NodeType, string> = {
      agent: 'AI Validation Agent',
      human: 'Executive Review Task',
      dmn: 'Risk Matrix Policy',
      gateway: 'Branching Gateway',
      event: 'Trigger Event',
    };

    const newNode: WorkflowNode = {
      id,
      type,
      title: defaultTitles[type],
      description: `Newly instantiated ${type} node`,
      x: 380 + Math.random() * 80,
      y: 200 + Math.random() * 60,
      agentConfig: type === 'agent' ? {
        model: 'gemini-3.6-flash',
        systemPrompt: 'Evaluate incoming data and perform risk verification.',
        confidenceThreshold: 85,
        temperature: 0.2,
        tools: ['Database Query'],
      } : undefined,
      dmnConfig: type === 'dmn' ? {
        decisionKey: `DMN_POLICY_${Date.now().toString().slice(-4)}`,
        hitPolicy: 'FIRST',
        inputs: [{ name: 'PayloadValue', type: 'NUMBER' }],
        outputs: [{ name: 'AllowPass', type: 'BOOLEAN' }],
        rules: [{ id: 'r1', condition: 'PayloadValue > 100', outcome: 'AllowPass = TRUE' }],
      } : undefined,
      humanConfig: type === 'human' ? {
        assigneeRole: 'Operations Analyst',
        slaHours: 24,
        formFields: ['Review Notes', 'Approval Signature'],
      } : undefined,
    };

    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
    }));
    setSelectedNodeId(id);
  };

  const handleConnectNodes = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const exists = currentWorkflow.edges.some((e) => e.source === sourceId && e.target === targetId);
    if (exists) return;

    const newEdge: WorkflowEdge = {
      id: `e-${Date.now()}`,
      source: sourceId,
      target: targetId,
      label: 'Flow Connection',
    };

    updateActiveWorkflow((wf) => ({
      ...wf,
      edges: [...wf.edges, newEdge],
    }));
  };

  const handleAddDownstreamNode = (sourceId: string, type: NodeType) => {
    const sourceNode = currentWorkflow.nodes.find((n) => n.id === sourceId);
    if (!sourceNode) return;

    const newId = `${type}-${Date.now()}`;
    const newNode: WorkflowNode = {
      id: newId,
      type,
      title: type === 'agent' ? 'Secondary AI Agent' : 'Subsequent Task',
      description: 'Downstream node added from toolbar',
      x: sourceNode.x + 240,
      y: sourceNode.y,
      agentConfig: type === 'agent' ? {
        model: 'gemini-3.6-flash',
        systemPrompt: 'Downstream agent handling post-processing.',
        confidenceThreshold: 90,
        temperature: 0.1,
        tools: ['API Webhook'],
      } : undefined,
    };

    const newEdge: WorkflowEdge = {
      id: `e-${Date.now()}`,
      source: sourceId,
      target: newId,
      label: 'Next Step',
    };

    updateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
      edges: [...wf.edges, newEdge],
    }));
    setSelectedNodeId(newId);
  };

  // Run Workflow Simulation
  const handleRunSimulation = async () => {
    if (isSimulating || currentWorkflow.nodes.length === 0) return;
    setIsSimulating(true);
    setShowLogPanel(true);
    setSimulationLogs([]);

    const timestamp = () => new Date().toLocaleTimeString();

    // Step 1: Start event log
    const startNode = currentWorkflow.nodes.find((n) => n.subtype === 'start') || currentWorkflow.nodes[0];
    setActiveSimulationNodeId(startNode.id);
    setSimulationLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-1`,
        timestamp: timestamp(),
        nodeId: startNode.id,
        nodeTitle: startNode.title,
        nodeType: startNode.type,
        status: 'info',
        message: `Process initiated: Payload received at start trigger node [${startNode.title}]`,
      },
    ]);

    await new Promise((r) => setTimeout(r, 1200));

    // Step 2: Traverse remaining nodes
    for (let i = 0; i < currentWorkflow.nodes.length; i++) {
      const node = currentWorkflow.nodes[i];
      if (node.id === startNode.id) continue;

      setActiveSimulationNodeId(node.id);

      if (node.type === 'agent') {
        const conf = node.agentConfig?.confidenceThreshold || 91;
        setSimulationLogs((prev) => [
          ...prev,
          {
            id: `log-${Date.now()}-${i}`,
            timestamp: timestamp(),
            nodeId: node.id,
            nodeTitle: node.title,
            nodeType: node.type,
            status: 'success',
            confidence: Math.min(99, conf + Math.floor(Math.random() * 6)),
            message: `AI Agent executed successfully. Evaluated system prompt against Gemini 3.6 Flash. Output generated safely.`,
          },
        ]);
      } else if (node.type === 'dmn') {
        setSimulationLogs((prev) => [
          ...prev,
          {
            id: `log-${Date.now()}-${i}`,
            timestamp: timestamp(),
            nodeId: node.id,
            nodeTitle: node.title,
            nodeType: node.type,
            status: 'success',
            message: `DMN Policy evaluated. Applied rule matching FIRST hit policy for key [${node.dmnConfig?.decisionKey || 'DMN_KEY'}].`,
          },
        ]);
      } else if (node.type === 'human') {
        setSimulationLogs((prev) => [
          ...prev,
          {
            id: `log-${Date.now()}-${i}`,
            timestamp: timestamp(),
            nodeId: node.id,
            nodeTitle: node.title,
            nodeType: node.type,
            status: 'warning',
            message: `Escalation Flagged: Human approval task dispatched to [${node.humanConfig?.assigneeRole || 'Reviewer'}]. SLA window set to ${node.humanConfig?.slaHours || 24}h.`,
          },
        ]);
      } else {
        setSimulationLogs((prev) => [
          ...prev,
          {
            id: `log-${Date.now()}-${i}`,
            timestamp: timestamp(),
            nodeId: node.id,
            nodeTitle: node.title,
            nodeType: node.type,
            status: 'info',
            message: `Step [${node.title}] executed successfully. Flow routed to next connector.`,
          },
        ]);
      }

      await new Promise((r) => setTimeout(r, 1400));
    }

    // Wrap up simulation
    setActiveSimulationNodeId(null);
    setIsSimulating(false);
    setSimulationLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-done`,
        timestamp: timestamp(),
        nodeId: 'end',
        nodeTitle: 'Simulation Concluded',
        nodeType: 'event',
        status: 'success',
        message: 'Full process workflow simulation concluded with 100% path coverage.',
      },
    ]);
  };

  // Deploy to Abada Engine
  const handleDeploy = async () => {
    if (isDeploying) return;
    setIsDeploying(true);
    setShowLogPanel(true);
    const timestamp = () => new Date().toLocaleTimeString();
    
    setSimulationLogs(prev => [
      ...prev,
      {
        id: `deploy-${Date.now()}-1`,
        timestamp: timestamp(),
        nodeId: 'system',
        nodeTitle: 'Deployment Compiler',
        nodeType: 'event',
        status: 'info',
        message: 'Compiling APL YAML to BPMN 2.0 XML for deployment...',
      }
    ]);

    try {
      const response = await EngineAPI.deployWorkflow(currentWorkflow);
      
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `deploy-${Date.now()}-2`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Abada Engine',
          nodeType: 'event',
          status: 'success',
          message: `Deployment successful! Process Key: [${response.processKey}], Version: ${response.version}, Deployment ID: ${response.deploymentId}`,
        }
      ]);
    } catch (err: any) {
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `deploy-${Date.now()}-err`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Deployment Error',
          nodeType: 'event',
          status: 'error',
          message: `Failed to deploy: ${err.message}`,
        }
      ]);
    } finally {
      setIsDeploying(false);
    }
  };

  // Generate Workflow from NL Prompt
  const handleGenerateWorkflow = async (promptText: string, mode: 'new' | 'refine' = 'new') => {
    setIsGenerating(true);
    const timestamp = () => new Date().toLocaleTimeString();

    let finalPrompt = promptText;
    if (mode === 'refine' && currentWorkflow) {
      finalPrompt = `Refine this process by following the request: "${promptText}". Base process name: ${currentWorkflow.name}. (Ensure the generated process includes the requested changes).`;
    }

    setSimulationLogs(prev => [
      ...prev,
      {
        id: `gen-${Date.now()}-1`,
        timestamp: timestamp(),
        nodeId: 'system',
        nodeTitle: 'Semaflow Agent',
        nodeType: 'agent',
        status: 'info',
        message: `Analyzing prompt: "${finalPrompt}"`,
      }
    ]);

    try {
      // 1. Call Semaflow AI
      const bpmnXml = await SemaflowAPI.generateBPMN(finalPrompt);

      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-2`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Semaflow Agent',
          nodeType: 'agent',
          status: 'info',
          message: 'Received BPMN XML from VertexAI. Transpiling to APL...',
        }
      ]);

      // 2. Transpile generated BPMN into modern APL YAML
      const aplDoc = transpileBPMNToAPL(bpmnXml);
      
      // Ensure it has a unique name
      aplDoc.metadata.name = `ai_generated_${Date.now()}`;
      
      // 3. Convert APL YAML into React Flow visual graph
      const newWf: WorkflowFile = aplToWorkflow(aplDoc);
      newWf.id = `wf-gen-${Date.now()}`;
      newWf.category = 'custom';
      newWf.fileType = 'bpmn';

      setWorkflows(prev => [...prev, newWf]);
      setActiveWorkflowId(newWf.id);
      if (newWf.nodes.length > 0) setSelectedNodeId(newWf.nodes[0].id);

      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-3`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Studio Compiler',
          nodeType: 'event',
          status: 'success',
          message: 'Successfully generated and loaded visual canvas.',
        }
      ]);

    } catch (err: any) {
      console.error(err);
      setSimulationLogs(prev => [
        ...prev,
        {
          id: `gen-${Date.now()}-err`,
          timestamp: timestamp(),
          nodeId: 'system',
          nodeTitle: 'Generation Error',
          nodeType: 'event',
          status: 'error',
          message: `Failed to generate workflow: ${err.message}`,
        }
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Test AI Agent Execution
  const handleRunAgentTest = async (agentConfig: AgentConfig, testInput: string) => {
    // Simulated Agent Execution (since backend /api/test-agent doesn't exist yet)
    await new Promise(r => setTimeout(r, 1500));
    
    return {
      success: true,
      confidence: Math.random() * 0.4 + 0.6, // random confidence between 60% and 100%
      result: `Processed input based on prompt: "${agentConfig.systemPrompt}". Determined next step based on reasoning parameters.`,
      flaggedForHuman: false,
    };
  };

  // Export JSON Schema
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentWorkflow, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentWorkflow.name}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Create Custom Workflow File
  const handleCreateNewWorkflow = (name: string, category: any) => {
    const newWf: WorkflowFile = {
      id: `wf-custom-${Date.now()}`,
      name,
      category,
      fileType: 'bpmn',
      version: '1.0.0',
      updatedAt: 'Just now',
      nodes: [
        {
          id: 'start-1',
          type: 'event',
          subtype: 'start',
          title: 'Start Process',
          description: 'Trigger payload received',
          x: 100,
          y: 200,
        },
        {
          id: 'agent-1',
          type: 'agent',
          title: 'Initial AI Agent',
          description: 'Primary AI decision step',
          x: 340,
          y: 180,
          agentConfig: {
            model: 'gemini-3.6-flash',
            systemPrompt: 'Process payload and analyze risk.',
            confidenceThreshold: 85,
            temperature: 0.2,
            tools: ['Database Query'],
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'agent-1', label: 'Payload' },
      ],
    };

    setWorkflows((prev) => [newWf, ...prev]);
    setActiveWorkflowId(newWf.id);
    setSelectedNodeId('agent-1');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1A1614] text-[#EAE3D9] overflow-hidden">
      {/* Top Header */}
      <Header
        currentWorkflow={currentWorkflow}
        onRunSimulation={handleRunSimulation}
        isSimulating={isSimulating}
        onNewWorkflow={() => setIsNewModalOpen(true)}
        onExportJSON={handleExportJSON}
        onDeploy={handleDeploy}
        isDeploying={isDeploying}
        onToggleLogPanel={() => setShowLogPanel(!showLogPanel)}
        showLogPanel={showLogPanel}
        nodeCount={currentWorkflow.nodes.length}
        currentView={currentView}
        onViewChange={setCurrentView}
      />

      {/* Main Studio Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar — only visible in Designer view */}
        {currentView === 'designer' && (
          <Sidebar
            workflows={workflows}
            activeWorkflowId={activeWorkflowId}
            onSelectWorkflow={(id) => {
              setActiveWorkflowId(id);
              const wf = workflows.find((w) => w.id === id);
              if (wf && wf.nodes.length > 0) setSelectedNodeId(wf.nodes[0].id);
            }}
            onAddNode={handleAddNode}
            onNewWorkflowModal={() => setIsNewModalOpen(true)}
          />
        )}

        {/* View: Designer Canvas */}
        {currentView === 'designer' && (
          <>
            <Canvas
              nodes={currentWorkflow.nodes}
              edges={currentWorkflow.edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => setSelectedNodeId(id)}
              onNodeMove={handleNodeMove}
              onConnectNodes={handleConnectNodes}
              isSimulating={isSimulating}
              activeSimulationNodeId={activeSimulationNodeId}
            />

            <PropertiesInspector
              selectedNode={selectedNode}
              onUpdateNode={handleUpdateNode}
              onRunAgentTest={handleRunAgentTest}
              nodeCount={currentWorkflow.nodes.length}
            />

            <NLInputBar
              onGenerateWorkflow={handleGenerateWorkflow}
              isGenerating={isGenerating}
              hasActiveWorkflow={workflows.length > 0}
            />

            <SimulationPanel
              logs={simulationLogs}
              isOpen={showLogPanel}
              onClose={() => setShowLogPanel(false)}
              onClearLogs={() => setSimulationLogs([])}
              isSimulating={isSimulating}
            />
          </>
        )}

        {/* View: Task Inbox (Human-in-the-Loop) */}
        {currentView === 'inbox' && <TaskInbox />}

        {/* View: Process Operations */}
        {currentView === 'operations' && <ProcessOperations />}
      </div>

      {/* New Process Canvas Modal */}
      <NewWorkflowModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreateWorkflow={handleCreateNewWorkflow}
      />
    </div>
  );
}
