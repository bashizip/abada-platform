import { describe, it, expect } from 'vitest';
import { compileAPLToBPMN } from './compiler';
import { APLDocument } from '../apl/types';

describe('compileAPLToBPMN', () => {
  it('compiles human-input node into BPMN user task with camunda:formKey', () => {
    const apl: APLDocument = {
      version: 'abada.io/v1',
      metadata: {
        key: 'test',
        name: 'Test Process',
      },
      flow: {
        entry: 'start',
        nodes: [
          { id: 'start', type: 'webhook', next: 'review' },
          {
            id: 'review',
            type: 'human-input',
            description: 'Review application',
            assignees: ['managers'],
            formId: 'onboarding-form-v2',
            next: 'end',
          },
          { id: 'end', type: 'end' },
        ],
      },
    };

    const bpmn = compileAPLToBPMN(apl);
    expect(bpmn).toContain('userTask');
    expect(bpmn).toContain('id="review"');
    expect(bpmn).toContain('onboarding-form-v2');
    expect(bpmn).toContain('candidateGroups="managers"');
  });

  it('compiles deprecated approval-gate alias identically', () => {
    const apl: APLDocument = {
      version: 'abada.io/v1',
      metadata: {
        key: 'test',
        name: 'Test',
      },
      flow: {
        entry: 'gate',
        nodes: [
          {
            id: 'gate',
            type: 'approval-gate',
            assignees: ['reviewers'],
            next: 'end',
          },
          { id: 'end', type: 'end' },
        ],
      },
    };

    const bpmn = compileAPLToBPMN(apl);
    expect(bpmn).toContain('userTask');
    expect(bpmn).toContain('candidateGroups="reviewers"');
  });
});
