# Abada Website — Cloudflare Pages

Landing page for `abadaplatform.com`.

## Deployment

```bash
cd website
npx wrangler pages deploy public --project-name abada-website
```

### Custom domain

Add via Cloudflare Dashboard → Workers & Pages → abada-website → Settings → Custom domains → `abadaplatform.com`.

## Files

| File | Purpose |
|------|---------|
| `public/index.html` | Landing page |
| `public/_headers` | Cloudflare Pages headers |
