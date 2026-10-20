import { describe, expect, it } from 'vitest';
import { tokenizeYaml, tokenizeYamlLine } from './yamlTokens';

const kinds = (line: string) => tokenizeYamlLine(line).filter((t) => t.kind !== 'text').map((t) => `${t.kind}:${t.text}`);

describe('APL YAML highlighting', () => {
  it('keeps every line exactly as written', () => {
    const source = `version: abada.io/v1
# a comment
flow:
  nodes:
    - id: route
      type: condition
      rules:
        - if: "\${amount > 10000}"   # big ones
          then: manager
      assignees: [finance, 'ops']
      prompt: |
        Classify: the lead
        then: answer
      sla_hours: 4
`;
    expect(tokenizeYaml(source).map((line) => line.map((t) => t.text).join('')).join('\n') + '\n').toBe(source);
  });

  it('types keys, scalars, expressions and comments', () => {
    expect(kinds('version: abada.io/v1')).toEqual(['key:version', 'punct::', 'string:abada.io/v1']);
    expect(kinds('    - id: route')).toEqual(['punct:- ', 'key:id', 'punct::', 'string:route']);
    expect(kinds('  sla_hours: 4')).toEqual(['key:sla_hours', 'punct::', 'number:4']);
    expect(kinds('  required: true')).toEqual(['key:required', 'punct::', 'boolean:true']);
    expect(kinds('  next: null')).toEqual(['key:next', 'punct::', 'null:null']);
    expect(kinds('  - if: "${amount > 10000}" # big')).toEqual(
      ['punct:- ', 'key:if', 'punct::', 'string:"', 'expression:${amount > 10000}', 'string:" ', 'comment:# big']);
    expect(kinds('  assignees: [finance]')).toEqual(['key:assignees', 'punct::', 'punct:[', 'string:finance', 'punct:]']);
  });

  it('treats the lines of a block scalar as text, not keys', () => {
    const lines = tokenizeYaml('prompt: |\n  Classify: the lead\nnext: done');
    expect(lines[1].some((t) => t.kind === 'key')).toBe(false);
    expect(lines[2][0]).toEqual({ kind: 'key', text: 'next' });
  });
});
