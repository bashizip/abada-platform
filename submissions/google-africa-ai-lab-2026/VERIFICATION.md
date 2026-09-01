# Local Submission Verification — August 31, 2026

## Completed locally

- The English deck contains exactly 10 slides and 10 speaker-note source blocks.
- All slides were rendered and inspected as a montage and page by page.
- The slide overflow check reports no collisions or truncation.
- The site presents one lifecycle: `Create or import → Run → Observe → Improve`.
- The visible site contains no `REC` placeholders, missing video elements,
  `2000+`, `800+`, or unverified APL-versus-XML comparison.
- The exact verified installer command remains:
  `curl -fsSL https://install.abadaplatform.com/install.sh | bash`.
- Public link checks returned HTTP 200 for the documentation and installer;
  the public GitHub repository also loaded successfully.
- Targeted PostgreSQL/Testcontainers verification passed:
  `InsightLoopIntegrationTest` and `LeadTriageHumanInputTest` — 5 tests, zero
  failures, errors, or skips.
- The recorded rc.4 release-gate source supports the `323 tests` deck claim.
- Gemini `gemini-3.6-flash` was called successfully by the real Agent Worker.
- Four completed LOW executions produced `FALLBACK_THRASH`; Insight proposal
  `#1` is LLM-generated, adds an explicit LOW rule, and remains unapproved.
- A real HIGH execution completed human review and the clearly labelled local
  CRM demo adapter.
- The captioned demo is H.264, 1920×1080, 30 fps and 84.53 seconds long.
- The native Google Slides deck contains 10 slides. Slide 6 uses the validated
  local execution capture and its notes identify the model, date and sources.
- The existing Google Slides sharing configuration was not changed.

## Intentionally pending

- Public website deployment.
- Public video hosting.
- Form prefill or transmission, terms acceptance, and final submission.

The final video is built from verified real Studio captures. A Recordly test
captured the wrong macOS screen and was deliberately excluded; no unrelated
application content appears in the delivered video.

Every pending external action requires Patrick Bashizi's explicit,
action-time authorization.
