# Abada product documentation

This Astro 7 and Starlight 0.41 application is the curated entry point for
Abada's user, architecture and developer documentation. The detailed contracts under
`../docs/` remain authoritative; pages here explain and connect them.

Production: <https://abada-engine-docs.vercel.app>

## Local development

```bash
cd documentation
npm ci
npm run dev
```

Before submitting a documentation change:

```bash
npm audit --audit-level=low
npm run check
npm run build
```

Content lives under `src/content/docs/`. Use `.mdx` when importing Starlight
components and fenced `mermaid` blocks for diagrams. See the in-site writing
guide for source-of-truth and diagram rules.
