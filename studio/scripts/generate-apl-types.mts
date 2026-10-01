/**
 * Generates `src/lib/apl/types.generated.ts` from the engine-owned APL JSON
 * Schema (engine/src/main/resources/apl/apl-v1.schema.json), the single APL
 * contract. Run `npm run generate:apl-types` after changing the schema;
 * `npm run verify:apl-types` (part of `npm run build`) fails when the
 * committed file is stale.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const SCHEMA = resolve(import.meta.dirname, '../../engine/src/main/resources/apl/apl-v1.schema.json');
const OUTPUT = resolve(import.meta.dirname, '../src/lib/apl/types.generated.ts');
const check = process.argv.includes('--check');

const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8')) as JSONSchema;
const generated = await compile(schema, 'APLDocument', {
  additionalProperties: false,
  bannerComment: [
    '/* eslint-disable */',
    '/**',
    ' * GENERATED from engine/src/main/resources/apl/apl-v1.schema.json — do not edit.',
    ' * Regenerate with `npm run generate:apl-types`.',
    ' */',
  ].join('\n'),
  declareExternallyReferenced: true,
  format: true,
  ignoreMinAndMaxItems: true,
  style: { singleQuote: true, semi: true, printWidth: 120 },
  unreachableDefinitions: true,
});

if (check) {
  const committed = readFileSync(OUTPUT, 'utf-8');
  if (committed !== generated) {
    console.error('APL types are stale: run `npm run generate:apl-types` and commit src/lib/apl/types.generated.ts.');
    process.exit(1);
  }
  console.log('APL types match the engine schema.');
} else {
  writeFileSync(OUTPUT, generated);
  console.log(`Wrote ${OUTPUT}`);
}
