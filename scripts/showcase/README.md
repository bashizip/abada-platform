# Studio showcase video

Records the Abada Studio walkthrough shown on abadaplatform.com and renders it
as a polished 1080p60 video. The capture is scripted, so the video can be
re-cut whenever the Studio changes.

```bash
./scripts/showcase/build.sh            # render into scripts/showcase/.work/out
./scripts/showcase/build.sh --publish  # also refresh the website videos and docs/assets
```

## Storyboard

1. **Design** (alice): select the Lead Triage agent node, zoom to its confidence threshold.
2. **APL**: switch to the YAML view of the same process.
3. **Run**: Deploy & Start; the live instance runs the agent and opens a human task; show the audit trail.
4. **Approve** (bob): claim the review task, approve it and add a note.
5. **Audit** (alice): Operations shows the completed instance; open its audit trail.

Intro and outro cards bracket the walkthrough. Captions and card copy live in
`record.mjs` and `cards.mjs`; keep them to claims the product proves.

## Requirements

- The dev stack running at `http://studio.localhost` with the agent worker, the
  Lead Triage starter and the realm's `alice`/`bob` test users
  (`./scripts/dev/up.sh`). `ABADA_AGENT_LOCAL_ACK_TOPICS` must include the
  starter topics (`demo.crm.upsert,demo.nurture.enqueue`, the default in
  `release/.env.dev.example`) or the instance never completes.
- A configured model endpoint: the agent step makes one real model call per run.
- Google Chrome, Node.js, Python 3 and ffmpeg. `build.sh` installs
  `playwright-core` and the Python packages locally on first run.

The recording mutates the dev database: it deploys the starter, starts one
instance and completes any open Lead Triage review tasks first so the inbox
shows a single task.

## How it works

| Step | File | Output |
| --- | --- | --- |
| Capture | `record.mjs`, `recorder.mjs` | Headless Chrome at 2x (3200x1800) drives the Studio; CDP screencast frames plus a timeline of cursor moves, clicks, camera targets, captions and speed ramps. |
| Layers | `cards.mjs` | Background, intro/outro cards and caption overlays rendered from HTML in the site's type and colours. |
| Compose | `compose.py` | Camera moves, cursor, click ripples, captions and cross-dissolves rendered at 60 fps from the timeline, then encoded with ffmpeg. |

Camera and cursor are synthesised after capture, so they stay smooth whatever
the capture frame rate.

## Outputs

| File | Use |
| --- | --- |
| `abada-studio-showcase.mp4` / `.webm` | Website (`abada-site/packages/web/public/videos`) |
| `abada-studio-showcase-poster.jpg` | Website poster frame |
| `abada-studio-showcase-readme.gif` | Animated preview shown in the repository README (`docs/assets/studio-showcase.gif`) |
| `abada-studio-showcase-readme.mp4` | 720p30 cut linked from the README (`docs/assets/studio-showcase.mp4`) |
| `abada-studio-showcase-master.mp4` | High-quality master for further editing |
