#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$ROOT_DIR/assets"
RENDERED_DIR="$ROOT_DIR/rendered"
RECORDINGS_DIR="$ROOT_DIR/recordings"
FFMPEG_BIN="${FFMPEG_BIN:-/opt/homebrew/bin/ffmpeg}"
NODE_BIN="${NODE_BIN:-/Users/pbash/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"

"$NODE_BIN" "$RECORDINGS_DIR/render-caption-frames.cjs"

"$FFMPEG_BIN" -y \
  -loop 1 -t 8  -i "$RECORDINGS_DIR/caption-frames/frame-01.png" \
  -loop 1 -t 12 -i "$RECORDINGS_DIR/caption-frames/frame-02.png" \
  -loop 1 -t 13 -i "$RECORDINGS_DIR/caption-frames/frame-03.png" \
  -loop 1 -t 12 -i "$RECORDINGS_DIR/caption-frames/frame-04.png" \
  -loop 1 -t 14 -i "$RECORDINGS_DIR/caption-frames/frame-05.png" \
  -loop 1 -t 16 -i "$RECORDINGS_DIR/caption-frames/frame-06.png" \
  -loop 1 -t 8  -i "$RECORDINGS_DIR/caption-frames/frame-07.png" \
  -loop 1 -t 5  -i "$RECORDINGS_DIR/caption-frames/frame-08.png" \
  -filter_complex "
    [0:v]format=yuv420p[v0];
    [1:v]format=yuv420p[v1];
    [2:v]format=yuv420p[v2];
    [3:v]format=yuv420p[v3];
    [4:v]format=yuv420p[v4];
    [5:v]format=yuv420p[v5];
    [6:v]format=yuv420p[v6];
    [7:v]format=yuv420p[v7];
    [v0][v1]xfade=transition=fade:duration=0.5:offset=7.5[x1];
    [x1][v2]xfade=transition=fade:duration=0.5:offset=19.0[x2];
    [x2][v3]xfade=transition=fade:duration=0.5:offset=31.5[x3];
    [x3][v4]xfade=transition=fade:duration=0.5:offset=43.0[x4];
    [x4][v5]xfade=transition=fade:duration=0.5:offset=56.5[x5];
    [x5][v6]xfade=transition=fade:duration=0.5:offset=72.0[x6];
    [x6][v7]xfade=transition=fade:duration=0.5:offset=79.5[out]
  " \
  -map "[out]" -an -r 30 -c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 -movflags +faststart \
  "$RECORDINGS_DIR/abada-process-lifecycle-demo-captioned.mp4"

cp "$RECORDINGS_DIR/abada-process-lifecycle-demo-captioned.mp4" \
  "$RECORDINGS_DIR/abada-process-lifecycle-demo.mp4"
