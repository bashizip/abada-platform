#!/usr/bin/env bash
#
# Records the Abada Studio showcase against the running dev stack and renders
# the site and README videos.
#
# Usage: ./scripts/showcase/build.sh [--publish]
#   --publish   also copy the site videos and the README assets (docs/assets) into the repo
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
WORK="${SHOWCASE_WORK:-$DIR/.work}"
PUBLISH=false
[[ "${1:-}" == "--publish" ]] && PUBLISH=true

command -v ffmpeg >/dev/null || { echo "Error: ffmpeg is required" >&2; exit 69; }
[[ -d /Applications/Google\ Chrome.app ]] || command -v google-chrome >/dev/null \
  || { echo "Error: Google Chrome is required" >&2; exit 69; }
curl -fsS -o /dev/null http://studio.localhost \
  || { echo "Error: Studio is not reachable at http://studio.localhost; start the dev stack first" >&2; exit 69; }

cd "$DIR"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
[[ -d .venv ]] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }

rm -rf "$WORK" && mkdir -p "$WORK/out"
node record.mjs "$WORK/take"
node -e '
  const fs = require("fs"); const seen = new Map();
  for (const n of ["alice", "bob"])
    for (const e of JSON.parse(fs.readFileSync(`${process.argv[1]}/${n}/timeline.json`)).events)
      if (e.kind === "caption" && !e.off && !seen.has(e.text)) seen.set(e.text, { eyebrow: e.eyebrow, text: e.text });
  fs.writeFileSync(process.argv[2], JSON.stringify([...seen.values()], null, 1));
' "$WORK/take" "$WORK/captions.json"
node cards.mjs "$WORK/cards" "$WORK/captions.json"
.venv/bin/python compose.py "$WORK/take" "$WORK/cards" "$WORK/out/abada-studio-showcase-master.mp4"

M="$WORK/out/abada-studio-showcase-master.mp4"
ffmpeg -v error -y -i "$M" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart -an \
  "$WORK/out/abada-studio-showcase.mp4"
ffmpeg -v error -y -i "$M" -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -deadline good -cpu-used 2 -an \
  "$WORK/out/abada-studio-showcase.webm"
ffmpeg -v error -y -i "$M" -vf "scale=1280:-2:flags=lanczos,fps=30" -c:v libx264 -preset slow -crf 25 \
  -pix_fmt yuv420p -movflags +faststart -an "$WORK/out/abada-studio-showcase-readme.mp4"
ffmpeg -v error -y -ss 9 -i "$M" -frames:v 1 -q:v 2 "$WORK/out/abada-studio-showcase-poster.jpg"
# GitHub only plays uploaded video inline, so the README shows an animated GIF.
ffmpeg -v error -y -i "$M" -vf "fps=8,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 "$WORK/out/abada-studio-showcase-readme.gif"

if $PUBLISH; then
  cp "$WORK/out/abada-studio-showcase."{mp4,webm} "$WORK/out/abada-studio-showcase-poster.jpg" \
    "$ROOT/abada-site/packages/web/public/videos/"
  cp "$WORK/out/abada-studio-showcase-readme.gif" "$ROOT/docs/assets/studio-showcase.gif"
  cp "$WORK/out/abada-studio-showcase-readme.mp4" "$ROOT/docs/assets/studio-showcase.mp4"
  echo "Copied site videos into abada-site/packages/web/public/videos/ and README assets into docs/assets/"
fi
ls -lh "$WORK/out"
