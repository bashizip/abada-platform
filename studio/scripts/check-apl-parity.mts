/**
 * APL Parity Guard
 *
 * Ensures the canonical node types in the engine's AplParser.SUPPORTED_TYPES
 * stay in sync with the studio's APLNodeType union. This prevents the drift
 * that led to the human-input / approval-gate mismatch.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ENGINE_PARSER = resolve(import.meta.dirname, '../../engine/src/main/java/com/abada/engine/parser/AplParser.java');
const STUDIO_TYPES = resolve(import.meta.dirname, '../src/lib/apl/types.ts');

function extractSupportedTypes(javaSource: string): Set<string> {
  const match = javaSource.match(/SUPPORTED_TYPES\s*=\s*Set\.of\(\s*([^)]+)\)/s);
  if (!match) {
    throw new Error('Could not find SUPPORTED_TYPES in AplParser.java');
  }
  const types = match[1]
    .split(',')
    .map((t) => t.trim().replace(/^"/, '').replace(/"$/, ''))
    .filter(Boolean);
  return new Set(types);
}

function extractNodeTypeUnion(tsSource: string): Set<string> {
  const match = tsSource.match(/export type APLNodeType\s*=([^;]+);/s);
  if (!match) {
    throw new Error('Could not find APLNodeType in types.ts');
  }
  const types = match[1]
    .split('|')
    .map((t) => t.trim().replace(/^'/, '').replace(/'$/, ''))
    .filter(Boolean);
  return new Set(types);
}

const engineTypes = extractSupportedTypes(readFileSync(ENGINE_PARSER, 'utf-8'));
const studioTypes = extractNodeTypeUnion(readFileSync(STUDIO_TYPES, 'utf-8'));

const onlyInEngine = [...engineTypes].filter((t) => !studioTypes.has(t));
const onlyInStudio = [...studioTypes].filter((t) => !engineTypes.has(t));

if (onlyInEngine.length > 0 || onlyInStudio.length > 0) {
  console.error('APL parity check failed!');
  if (onlyInEngine.length > 0) {
    console.error(`  Only in engine SUPPORTED_TYPES: ${onlyInEngine.join(', ')}`);
  }
  if (onlyInStudio.length > 0) {
    console.error(`  Only in studio APLNodeType: ${onlyInStudio.join(', ')}`);
  }
  process.exit(1);
}

console.log(`APL parity OK — ${engineTypes.size} types in sync.`);
