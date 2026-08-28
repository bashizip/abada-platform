# Abada Installer — Cloudflare Pages

This directory contains the `curl | bash` installer for the Abada Platform.

## One-liner

```bash
curl -fsSL https://install.abadaengine.com | bash
```

## Deployment

### Wrangler CLI (current method)

```bash
cd install
npx wrangler pages deploy public --project-name abada-install
```

### Custom domain

Added via Cloudflare Dashboard → Workers & Pages → abada-install → Settings → Custom domains → `install.abadaengine.com`.

## Files

| File | Purpose |
|------|---------|
| `install.sh` | The bootstrap script (source of truth) |
| `public/install.sh` | Copy served at `/install.sh` |
| `public/index.html` | Landing page for browser visitors |
| `public/_headers` | Cloudflare Pages headers (content-type, cache) |

## Updating the version

Edit `install.sh` and update the `VERSION` variable. Redeploy.
