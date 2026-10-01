import { describe, expect, it } from 'vitest';
import { formatErrorReport, traceHeadline } from './errorReport';

const error = {
  jobId: 'job-1', processInstanceId: 'pi-1', activityId: 'analyze-lead', status: 'OPEN', retries: 1,
  errorMessage: 'No AI provider is configured for model \'claude-sonnet-5\'',
  errorDetails: 'io.abada.agent.AgentGateway$AgentConfigurationException: No AI provider\n\tat io.abada.agent.X(X.java:1)\n',
};

describe('error report', () => {
  it('puts the context before the stack trace', () => {
    const report = formatErrorReport({ activityTitle: 'Analyze-Lead', errorType: 'AgentConfigurationException', attempt: 2,
      provider: 'anthropic', model: 'claude-sonnet-5', workerId: 'w-1' }, error);
    expect(report).toContain('Activity: Analyze-Lead');
    expect(report).toContain('Error type: AgentConfigurationException');
    expect(report).toContain('Model: anthropic / claude-sonnet-5');
    expect(report).toContain('Status: OPEN (1 retries left)');
    expect(report.indexOf('Attempt: 2')).toBeLessThan(report.indexOf('\tat io.abada'));
  });

  it('works without a stack trace', () => {
    expect(formatErrorReport({ errorType: 'X' }, null)).toBe('Error type: X\n');
  });

  it('reads the exception headline', () => {
    expect(traceHeadline(error.errorDetails)).toBe('io.abada.agent.AgentGateway$AgentConfigurationException: No AI provider');
    expect(traceHeadline(null)).toBeNull();
  });
});
