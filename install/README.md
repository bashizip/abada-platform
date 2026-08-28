# Abada Installer — Cloudflare Pages

This directory contains the `curl | bash` installer for the Abada Platform.

## One-liner

```bash
curl -fsSL https://install.abadaengine.com | bash
```

## Deployment

### Option A: Cloudflare Dashboard (recommended)

1. Push this repository to GitHub (or a separate `abada-install` repo)
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages
3. Create a new project → Connect to Git repository
4. Set **Build output directory** to `install/public`
5. Add custom domain `install.abadaengine.com` in the Pages project settings

### Option B: Wrangler CLI

```bash
cd install
npx wrangler pages deploy public --project-name abada-install
```

Then add the custom domain in the Cloudflare dashboard.

## Files

| File | Purpose |
|------|---------|
| `install.sh` | The bootstrap script (source of truth) |
| `public/index.sh` | Copy served at `/install.sh` |
| `public/index.html` | Landing page for browser visitors |
| `public/_headers` | Cloudflare Pages headers (content-type, cache) |
| `wrangler.toml` | Wrangler config (optional, dashboard deploy is simpler) |

## Updating the version

Edit `install.sh` and update the `VERSION` variable. Redeploy.
