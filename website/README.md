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
| `public/assets/` | Optimized, real Studio product captures used by the landing page |
| `public/_headers` | Cloudflare Pages headers |

The landing page embeds the public, read-only product demonstration from
Google Drive. Keep screenshots and demo claims tied to verified executions;
do not add placeholder recordings or unmeasured BPMN/APL comparisons.
