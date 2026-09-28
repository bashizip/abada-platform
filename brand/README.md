# Abada brand assets

One mark for every Abada product. The shape never changes; only its color
changes per product.

## The mark

The mark is the letter A drawn as a governed process, following the product
doctrine:

- the two terminals at the feet are where **agents advise**
- the gateway diamond between the legs is where **rules decide**
- the node at the apex is where **humans approve**

It is drawn on a 48-unit grid with round caps and joins. There are two cuts:

| Cut | Use | File |
| --- | --- | --- |
| Full | 24 px and larger | `svg/abada-mark*.svg`, `svg/abada-app-icon*.svg` |
| Small | Below 24 px: favicons, browser tabs. Heavier edges, no terminals, and the gateway bridges the legs | `svg/abada-mark-small.svg`, `svg/abada-favicon*.svg` |

## Colors

| Variant | Mark | Background | Used by |
| --- | --- | --- | --- |
| Platform | Emerald `#34D399` | Ink `#05070A` or any dark surface | Website, docs (dark), README, installer |
| Platform on light | Emerald deep `#0F7A5C` | White or light surfaces | Docs (light), print |
| Studio | Amethyst `#9D4EDD`, saffron gateway `#F4A261` | Studio charcoal `#1A1614` | Studio, Keycloak login |
| Studio app icon | Lilac `#F4EEFB`, saffron gateway | Amethyst → mocha tile (`#9D4EDD` → `#25201D`) | Studio header, sign-in, favicon |
| Mono | Ink `#05070A` or white | Anything | Single-color use, embeds, partner pages |

Only Studio uses the second (saffron) color. Every other variant is one color.

## Wordmark and lockups

The wordmark is **ABADA** in bold capitals with wide letter-spacing. The
product name (Studio, Platform, Docs) sits next to it or under it in a lighter,
smaller weight. The lockups are set in each app's own font, as HTML beside the
mark (see Studio's `Header.tsx` or the website's `nav.tsx`). There are no
wordmark SVGs, so the name never ends up in a font the app doesn't load.

## Rules

- **Clear space:** keep at least the diamond's width free on every side of the mark.
- **Minimum size:** 24 px for the full cut, 16 px for the small cut.
- **Don't** recolor parts of the mark outside the table above, add effects to
  the mark itself, rotate or stretch it, or put the platform emerald on
  Studio's purple tile.

## Files

| File | What it is |
| --- | --- |
| `svg/abada-mark.svg` | Platform mark, emerald |
| `svg/abada-mark-deep.svg` | Platform mark for light surfaces |
| `svg/abada-mark-studio.svg` | Studio mark, amethyst with saffron gateway |
| `svg/abada-mark-mono-dark.svg`, `svg/abada-mark-mono-light.svg` | One-color ink / white |
| `svg/abada-mark-small.svg` | Small cut, emerald |
| `svg/abada-app-icon.svg`, `svg/abada-app-icon-studio.svg` | Mark on its product tile |
| `svg/abada-favicon.svg`, `svg/abada-favicon-studio.svg` | Small cut on its product tile |
| `svg/abada-store-icon.svg`, `svg/abada-adaptive-foreground.svg` | Mobile store icon and Android adaptive-icon foreground |
| `png/` | Raster exports: `favicon.ico` (16/32/48), apple-touch icon, 512 and 1024 icons, mobile splash |

## Regenerating

Every file here is generated from the geometry in `export.mjs`. Change the
mark there, never by editing an SVG by hand, then run:

```bash
NODE_PATH=$(npm root -g) node brand/export.mjs
```

The script writes `svg/` and `png/` and copies each product's variant to the
path the app serves it from (Studio `public/`, the website `public/`, the docs
`public/` and `src/assets/`, and the mobile `assets/`). It needs Playwright; set
`PLAYWRIGHT_CHROMIUM` to a Chromium binary if Playwright has no bundled
browser. Use `--svg-only` to skip the rasters.

The website's link-preview image draws the mark inline in
`abada-site/packages/web/tools/og-image.mjs`. After changing the mark, update it
there as well and run `bun run og:image`.
