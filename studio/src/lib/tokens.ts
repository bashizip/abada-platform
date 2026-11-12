/**
 * The Studio colour tokens as literal values, for code that cannot read a CSS
 * variable: SVG presentation attributes, React Flow props and colours that get
 * an alpha suffix appended (`${palette.saffron}66`). The source of truth is the
 * `@theme` block in `src/index.css`; `tokens.test.ts` keeps the two identical.
 * In class names use the Tailwind utilities instead (`bg-charcoal`, `text-sand`).
 */
export const palette = {
  charcoalInk: '#14100D',
  charcoalVeil: '#141110',
  charcoalDeep: '#14110D',
  charcoalWell: '#151210',
  charcoal: '#1A1614',
  mochaDeep: '#201B18',
  mochaStrip: '#211C19',
  mocha: '#25201D',
  mochaHover: '#2F2926',
  hairline: '#3A322E',
  hairlineStrong: '#4A403A',
  linen: '#EAE3D9',
  linenMuted: '#C9BFAF',
  sand: '#A89F91',
  sandDim: '#8A7F74',
  moss: '#737D69',
  stone: '#5A524A',
  saffron: '#F4A261',
  saffronBright: '#F5AD73',
  amethyst: '#9D4EDD',
  amethystLight: '#B06EE6',
  amethystBright: '#B56EF2',
  desertRose: '#E76F51',
  desertRoseBright: '#F0896F',
  mineralTeal: '#2A9D8F',
  mineralTealBright: '#34BDAE',
  sageGreen: '#90A955',
} as const;

export type PaletteToken = keyof typeof palette;
