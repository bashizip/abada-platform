import { describe, expect, it } from 'vitest';
import visibilitySource from '../../../../engine/src/test/resources/forms/visibility-conformance.json?raw';
import submissionSource from '../../../../engine/src/test/resources/forms/submission-conformance.json?raw';
import supplierSource from '../../../../engine/src/test/resources/apl/forms/supplier-onboarding.json?raw';
import { checkSubmission, formProblems, FormSchema } from './formSchema';
import { parseVisibility } from './visibility';

/**
 * The Studio side of the shared form fixtures; the engine runs the same files
 * (FormConformanceTest), so the browser and the engine agree on every value.
 */
interface VisibilityFixture {
  cases: { expr: string; values: Record<string, unknown>; expected: boolean }[];
  invalid: string[];
}
interface SubmissionFixture {
  current: Record<string, unknown>;
  valid: Record<string, unknown>;
  cases: { name: string; set?: Record<string, unknown>; unset?: string[]; violations: [string, string][]; discarded: string[] }[];
}

const visibility = JSON.parse(visibilitySource) as VisibilityFixture;
const submission = JSON.parse(submissionSource) as SubmissionFixture;
const supplier = JSON.parse(supplierSource) as FormSchema;

describe('visible_when conformance', () => {
  it.each(visibility.cases)('$expr over $values is $expected', ({ expr, values, expected }) => {
    expect(parseVisibility(expr).test(values)).toBe(expected);
  });

  it.each(visibility.invalid)('refuses %j', (expr) => {
    expect(() => parseVisibility(expr)).toThrow();
  });
});

describe('submission conformance', () => {
  it('the supplier form is one the engine deploys', () => {
    expect(formProblems(supplier)).toEqual([]);
  });

  it.each(submission.cases)('$name', ({ set = {}, unset = [], violations, discarded }) => {
    const submitted: Record<string, unknown> = { ...submission.valid, ...set };
    unset.forEach((name) => delete submitted[name]);
    const result = checkSubmission(supplier, submitted, submission.current);
    expect(result.violations.map((violation) => [violation.field, violation.rule])).toEqual(violations);
    if (violations.length === 0) {
      expect(result.hidden.filter((id) => Object.prototype.hasOwnProperty.call(submitted, id))).toEqual(discarded);
    }
  });
});
