import React, { useMemo } from 'react';
import { tokenizeYaml, type YamlTokenKind } from '@/lib/apl/yamlTokens';
import { VALUE_TONE } from '@/components/json/jsonLayout';

const TONE: Record<YamlTokenKind, string> = {
  key: 'text-amethyst-light',
  punct: 'text-sand-dim',
  string: VALUE_TONE.string,
  number: VALUE_TONE.number,
  boolean: VALUE_TONE.boolean,
  null: VALUE_TONE.null,
  expression: 'text-mineral-teal-bright',
  comment: 'italic text-moss',
  text: '',
};

/** Read-only APL YAML with line numbers and highlighting (the AI draft's YAML view). */
export const AplSourceView: React.FC<{ source: string; label?: string; className?: string }> = ({
  source, label = 'APL source', className = '',
}) => {
  const lines = useMemo(() => tokenizeYaml(source), [source]);
  return (
    <pre aria-label={label} className={`overflow-auto bg-charcoal-ink py-3 font-mono text-[11.5px] leading-relaxed text-linen-muted ${className}`}>
      <code>
        {lines.map((tokens, index) => (
          // The line number is drawn by CSS, so it is not part of the text (copy, find, tests).
          <span key={index} data-line={index + 1}
            className="flex before:sticky before:left-0 before:w-10 before:shrink-0 before:select-none before:bg-charcoal-ink before:pr-3 before:text-right before:tabular-nums before:text-sand-dim/70 before:content-[attr(data-line)]">
            <span className="whitespace-pre pr-4">
              {tokens.map((token, i) => (
                token.kind === 'text' ? token.text : <span key={i} className={TONE[token.kind]}>{token.text}</span>
              ))}
              {'\n'}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
};
