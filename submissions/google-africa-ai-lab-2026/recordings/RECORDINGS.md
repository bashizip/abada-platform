# Product Demo Recording Plan

Produce one truthful, caption-first walkthrough of Abada's complete process
lifecycle.

## Deliverable

| File | Format | Resolution | Target duration | Status |
|---|---|---:|---:|---|
| `abada-process-lifecycle-demo-captioned.mp4` | MP4, H.264, captions burned in | 1920×1080 | 84.5 seconds | Ready locally |
| `abada-process-lifecycle-demo.mp4` | MP4, H.264 | 1920×1080 | 84.5 seconds | Ready locally |
| `demo-captions.srt` | English subtitles | — | 84.5 seconds | Ready locally |

## Storyboard

| Time | Shot | Proof shown |
|---:|---|---|
| 00:00–00:07.5 | Studio **New Process** dialog | Empty process, supported BPMN import and Paste APL are alternative entry points. |
| 00:07.5–00:19 | Lead-triage visual canvas | Gemini, deterministic routing, human review and local adapters in one process. |
| 00:19–00:31.5 | Gemini node inspector | Model, prompt, JSON contract, confidence, timeout and retries are governed. |
| 00:31.5–00:43 | Operations | Five real completed runs, an online Agent Worker and no failed execution. |
| 00:43–00:56.5 | HIGH instance variables | Real HIGH result, 100% confidence, human approval and local CRM acknowledgement. |
| 00:56.5–01:12 | Insight graph diff | Four LOW runs, FALLBACK_THRASH and an LLM proposal with Approve/Reject. |
| 01:12–01:19.5 | Insight APL diff | Explicit LOW rule is proposed but remains unapproved. |
| 01:19.5–01:24.5 | Closing card | Create or import → Run → Observe → Improve. |

All runtime proof in the final cut is real: Gemini 3.6 Flash produced the HIGH
and LOW classifications, PostgreSQL persisted the runs, and the Insight Engine
generated proposal #1. The proposal was not approved.

## Recording Rules

- 1920×1080, 16:9, clean Studio captures only.
- Use only the local development account and non-sensitive sample data.
- English captions must remain readable with audio muted.
- Never reveal API keys, tokens, authorization headers, local paths or unrelated tabs.
- Record short segments and assemble them in storyboard order.
- Verify duration, complete playback, captions and every frame before upload.
