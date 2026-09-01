import { Project, ProjectAPI, ProjectDocument, ProjectTreeNode } from '@/api/projects';
import { aplToWorkflow, parseAPLYaml } from '@/lib/apl/parser';
import { autoLayoutWorkflow } from '@/lib/layout/autoLayout';

export const STARTER_PROJECT_SLUG = 'abada-starter';
export const STARTER_PROCESS_KEY = 'lead_triage';
const STARTER_REVIEW_LANE = 'TECHNICAL';

export const LEAD_TRIAGE_EXAMPLES = {
  HIGH: {
    lead: {
      id: 'LEAD-HIGH-001', company: 'Kivu Enterprise Services', companyEmployees: 1200,
      annualBudgetUsd: 180000, purchaseTimeframeDays: 45,
      need: 'Governed customer onboarding across sales and compliance',
    },
  },
  MEDIUM: {
    lead: {
      id: 'LEAD-MEDIUM-001', company: 'Lake Region Logistics', companyEmployees: 140,
      annualBudgetUsd: 30000, purchaseTimeframeDays: 150,
      need: 'Automate internal service requests',
    },
  },
  LOW: {
    lead: {
      id: 'LEAD-LOW-001', company: 'Community Pilot', companyEmployees: 18,
      annualBudgetUsd: 7000, purchaseTimeframeDays: 240,
      need: 'Explore workflow automation',
    },
  },
} as const;

export const LEAD_TRIAGE_APL = `version: abada.io/v1
metadata:
  key: lead_triage
  name: AI Lead Triage
  owner: sales-operations
  category: sales
flow:
  entry: receive-lead
  nodes:
    - id: receive-lead
      type: webhook
      description: Receive a new sales lead
      next: analyze-lead
    - id: analyze-lead
      type: agent
      description: Analyze the lead with Gemini
      profile: abada.agent/v1
      model: gemini-3.6-flash
      prompt: |
        You are a sales-operations classifier. Use only the supplied lead object.
        Apply these deterministic thresholds:
        - HIGH: annualBudgetUsd >= 100000 and purchaseTimeframeDays <= 90.
        - MEDIUM: annualBudgetUsd >= 25000 or companyEmployees >= 100.
        - LOW: every other lead.
        Return only one JSON object with exactly these fields:
        {"priority":"HIGH|MEDIUM|LOW","reason":"one concise sentence","_confidence":95}
        _confidence must be a number from 0 to 100. Do not add markdown fences.
      inputs:
        lead: "\${lead}"
      result_variable: triage
      output_schema:
        type: object
        required: [priority, reason, _confidence]
        properties:
          priority:
            type: string
            enum: [HIGH, MEDIUM, LOW]
          reason:
            type: string
          _confidence:
            type: number
      confidence_threshold: 70
      temperature: 0.0
      max_tokens: 2048
      timeout_ms: 60000
      max_attempts: 3
      retry_backoff_ms: 2000
      next: priority-policy
    - id: priority-policy
      type: decision-table
      description: Apply the governed lead-routing policy
      decisionKey: LEAD_PRIORITY_POLICY_V1
      hitPolicy: FIRST
      inputs:
        priority: "\${triage.priority}"
      rules:
        - when: "priority == 'HIGH'"
          then: { route: HIGH, action: SENIOR_REVIEW }
        - when: "priority == 'MEDIUM'"
          then: { route: MEDIUM, action: CRM_FOLLOW_UP }
        - otherwise: true
          then: { route: LOW, action: NURTURE }
      next: route-lead
    - id: route-lead
      type: condition
      description: Route using the deterministic policy result
      rules:
        - if: "\${route == 'HIGH'}"
          then: senior-sales-review
        - if: "\${route == 'MEDIUM'}"
          then: sync-crm
        - else: true
          then: enqueue-nurture
    - id: senior-sales-review
      type: human-input
      description: Senior sales review
      formKey: lead-triage-review
      assignees: [abada-task-user]
      next: sync-crm
    - id: sync-crm
      type: engine-task
      description: Synchronize the qualified lead
      service: demo.crm.upsert
      next: done
    - id: enqueue-nurture
      type: engine-task
      description: Enqueue the lead for nurturing
      service: demo.nurture.enqueue
      next: done
    - id: done
      type: end
      description: Lead triage completed
`;

const REVIEW_FORM = {
  title: 'Senior Lead Review',
  description: 'Confirm the governed routing decision before local CRM synchronization.',
  fields: [
    { id: 'reviewDecision', type: 'select', label: 'Decision', required: true, options: ['approve', 'reject'] },
    { id: 'reviewNotes', type: 'textarea', label: 'Review notes', required: false },
  ],
};

const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const rootFolder = (tree: ProjectTreeNode[], name: string): ProjectTreeNode | undefined =>
  tree.find((node) => node.kind === 'FOLDER' && node.name === name);

export interface StarterBootstrapResult {
  projects: Project[];
  project?: Project;
  document?: ProjectDocument;
}

/** Creates or resumes the development starter without touching unrelated projects. */
export async function ensureLeadTriageStarter(available: Project[]): Promise<StarterBootstrapResult> {
  let project = available.find((candidate) => candidate.slug === STARTER_PROJECT_SLUG);
  if (!project) {
    project = await ProjectAPI.create(
      STARTER_PROJECT_SLUG,
      'Abada Starter',
      'A local, non-sensitive workspace demonstrating governed AI lead triage.',
    );
    available = [...available, project];
  }

  if (!project.currentUserRoles.includes('REVIEWER')
      || !project.currentUserReviewLanes.includes(STARTER_REVIEW_LANE)) {
    const members = await ProjectAPI.members(project.id);
    const currentRoles = new Set(project.currentUserRoles);
    const currentReviewLanes = new Set(project.currentUserReviewLanes);
    const matchingMembers = members.filter((member) =>
      member.roles.length === currentRoles.size
      && member.roles.every((role) => currentRoles.has(role))
      && member.reviewLanes.length === currentReviewLanes.size
      && member.reviewLanes.every((lane) => currentReviewLanes.has(lane)));
    if (matchingMembers.length !== 1) {
      throw new Error('Starter project reviewer membership could not be identified safely');
    }
    const member = matchingMembers[0];
    await ProjectAPI.putMember(
      project.id,
      member.principalId,
      [...new Set([...member.roles, 'REVIEWER' as const])],
      [...new Set([...member.reviewLanes, STARTER_REVIEW_LANE])],
      member.taskGroups,
      member.version,
    );
  }

  let [tree, documents] = await Promise.all([
    ProjectAPI.tree(project.id),
    ProjectAPI.documents(project.id),
  ]);
  const formsFolder = rootFolder(tree, 'forms');
  const processesFolder = rootFolder(tree, 'processes');
  if (!formsFolder || !processesFolder) throw new Error('Starter project system folders are unavailable');

  const existingForm = formsFolder.children.find((node) =>
    node.kind === 'RESOURCE' && node.name === 'lead-triage-review.json');
  if (!existingForm) {
    await ProjectAPI.createResource(
      project.id,
      'lead-triage-review.json',
      'FORM',
      'application/json',
      toBase64(JSON.stringify(REVIEW_FORM, null, 2)),
      formsFolder.id,
    );
  }

  let document = documents.find((candidate) => candidate.processKey === STARTER_PROCESS_KEY);
  if (!document) {
    const parsed = aplToWorkflow(parseAPLYaml(LEAD_TRIAGE_APL));
    const workflow = {
      ...parsed,
      nodes: autoLayoutWorkflow(parsed.nodes, parsed.edges),
      fileName: 'lead-triage.apl.yaml',
    };
    document = await ProjectAPI.createDocument(
      project.id,
      workflow,
      'Gemini classification, deterministic routing, human review and local system adapters.',
      { folderId: processesFolder.id, fileName: 'lead-triage.apl.yaml' },
    );
  }
  if (!document.lastDeploymentId) {
    await ProjectAPI.deployDocument(project.id, ProjectAPI.workflow(document));
    documents = await ProjectAPI.documents(project.id);
    document = documents.find((candidate) => candidate.processKey === STARTER_PROCESS_KEY) || document;
  }

  const projects = await ProjectAPI.list();
  return { projects, project: projects.find((candidate) => candidate.id === project.id) || project, document };
}
