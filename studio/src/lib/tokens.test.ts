import { describe, expect, it } from 'vitest';
import css from '../index.css?raw';
import { palette } from './tokens';

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The `--color-*` declarations of the `@theme` block in index.css. */
function themeColours(): Record<string, string> {
  const theme = css.match(/@theme\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  return Object.fromEntries([...theme.matchAll(/--color-([a-z-]+):\s*(#[0-9A-Fa-f]{6});/g)]
    .map(([, name, value]) => [name, value.toUpperCase()]));
}

describe('design tokens', () => {
  it('keeps the TypeScript palette identical to the CSS theme', () => {
    const fromCss = themeColours();
    const fromTs = Object.fromEntries(Object.entries(palette).map(([name, value]) => [kebab(name), value.toUpperCase()]));
    expect(Object.keys(fromCss).length).toBeGreaterThan(10);
    expect(fromTs).toEqual(fromCss);
  });

  it('gives every colour one name', () => {
    const values = Object.values(palette).map((value) => value.toUpperCase());
    expect(new Set(values).size).toBe(values.length);
  });
});
