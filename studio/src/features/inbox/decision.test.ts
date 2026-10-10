import { describe, expect, it } from 'vitest';
import { decisionError, decisionPayload, MAX_COMMENT_LENGTH } from './decision';

const approve = { name: 'approve', commentRequired: false };
const reject = { name: 'reject', commentRequired: true };

describe('review decisions', () => {
  it('requires a comment only where the outcome does', () => {
    expect(decisionError(reject, '   ')).toBe('A comment is required to reject.');
    expect(decisionError(reject, 'Wrong customer')).toBeNull();
    expect(decisionError(approve, '')).toBeNull();
    expect(decisionError(approve, 'x'.repeat(MAX_COMMENT_LENGTH + 1))).toContain('limited');
  });

  it('sends the trimmed comment and only the form fields, never the seeded process variables', () => {
    expect(decisionPayload(reject, '  Add the warranty  ', { priority: 'high', review_outcome: 'x', draft: 'y' },
      ['priority'])).toEqual({ outcome: 'reject', comment: 'Add the warranty', variables: { priority: 'high' } });
    expect(decisionPayload(approve, '')).toEqual({ outcome: 'approve' });
  });

  it('decides a tool approval with the comment alone: no form, no variables', () => {
    expect(decisionError(reject, '')).toBe('A comment is required to reject.');
    expect(decisionPayload(reject, ' Already refunded ', {}, [])).toEqual({ outcome: 'reject',
      comment: 'Already refunded' });
  });
});
