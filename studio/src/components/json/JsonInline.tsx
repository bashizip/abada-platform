import React from 'react';
import { REDACTION_MASK } from './jsonModel';
import { MaskedText, RedactedBadge } from './JsonValue';
import { VALUE_TONE } from './jsonLayout';

/** One value on one line, coloured by type: for label/value rows. Objects show as compact JSON. */
export const JsonValueInline: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === REDACTION_MASK) return <RedactedBadge />;
  if (value === null || value === undefined) return <span className={VALUE_TONE.null}>null</span>;
  if (typeof value === 'number') return <span className={VALUE_TONE.number}>{String(value)}</span>;
  if (typeof value === 'boolean') return <span className={VALUE_TONE.boolean}>{String(value)}</span>;
  if (typeof value === 'string') return <span className={VALUE_TONE.string}><MaskedText text={value} /></span>;
  return <span className="text-linen-muted"><MaskedText text={JSON.stringify(value)} /></span>;
};
