# Three-minute video: lead triage, from install to a governed change

Plan for Video 1 in the [content calendar](../../marketing/content-calendar.md).
It extends the scripted Studio showcase (`scripts/showcase/`, today 67 s, five
scenes on the Lead Triage starter) into a 3:00 cut. It follows one process from
start to finish. Status: **plan, not recorded.**

Audience: AI engineers and architects (HN launch week, LinkedIn). One idea to
leave with: *the agent advises, but it never gets the last word, and the process
gets better only when a person approves the change.*

Rules carried over from the 1.1.0 script (`m4-demo-script.md`): a real stack,
no mock-ups, every spoken claim on the
[claims register](../../../abada-site/claims.json), captions are the
narration, a `.srt` ships with it, no music under speech, no customer names.

## Storyboard

About 250 spoken words, under the 420 that 3:00 can hold, so every beat
has room to breathe. *Source* says whether the shot exists in `record.mjs`
today or is new work.

| Time | Screen | Narration | Claim | Source |
| --- | --- | --- | --- | --- |
| 0:00–0:10 | Cold open: the Lead Triage canvas live, a lead arriving. Title. | "This is a sales lead triage process. An AI agent reads every lead. It never gets the last word." | — | new (intro card) |
| 0:10–0:25 | Terminal: the one-line installer, sped up; Studio opens on Abada Starter. | "One command installs the platform with Docker. Studio opens with this process ready to run." | `installer-report-disclosed` (show the notice line, don't hide it) | new (terminal capture) |
| 0:25–0:45 | Agent node selected; zoom to output schema and *Confidence Threshold 70*. | "The agent advises. Its answer must fit this contract: a priority, a reason, a confidence. Below seventy, or malformed, it goes to a person." | `engine-enforces-contract` | scene 01, longer hold on the schema |
| 0:45–0:55 | APL YAML view, scrolled to the agent block. | "The whole process is plain YAML you can review in a pull request." | — | scene 02 |
| 0:55–1:15 | Deploy & Start with the HIGH example lead; the agent runs; `priority-policy` decision table lights up. | "We send a large lead. The model runs outside the transaction; its answer enters the process only through the engine. A decision table, not the model, picks the route." | `model-outside-transaction`, `deterministic-rules` | scene 03 + new zoom on the decision table |
| 1:15–1:30 | Second start with a vague lead; the agent answers with confidence 55; the token goes straight to *Senior Sales Review*. | "A vague lead comes back unsure. The engine doesn't guess. It opens a review task." | `engine-enforces-contract` | **new** |
| 1:30–1:50 | bob claims the task, reclassifies, writes a note, submits. | "A different person decides, with a note. Not the model, not the author of the process." | — | scene 04 (outcome becomes an override) |
| 1:50–2:05 | Operations → the instance → Audit Trail: model, tokens, cost, actor, times. | "Every step is on record in PostgreSQL: the model, tokens, cost, who decided and when." | `evidence-per-decision`, `postgres-only` | scene 05 |
| 2:05–2:20 | Insight: an override-rate finding on `analyze-lead` / `senior-sales-review`, with the seeded rate and sample size. | "After forty leads, reviewers have overruled the agent on [rate] of them. Insight names the agent and the review step." | `override-signals` | **new** |
| 2:20–2:35 | The proposal: a small prompt diff. | "It proposes a small change. Nothing applies by itself." | `patch-authoring` | **new** |
| 2:35–2:47 | Approve refused by policy → replay on 20 recorded leads → summary of the cases that would change. | "Policy says replay first. Twenty recorded leads, rerun on the proposal: here is what would change, and where. Evidence for the reviewer, not a verdict." | `replay-before-approval` | **new** |
| 2:47–2:57 | Approve from the diff; new version; then *Roll back* with a reason. | "A person approves. If it was wrong, one click brings back the previous version." | `one-click-rollback` | **new** |
| 2:57–3:00 | End card. | "Agents advise. Rules decide. Humans approve. PostgreSQL remembers." | — | outro card |

`[rate]` is read off the seeded corpus on the day; never round it up.

The 1.1.0 script stops an engine replica mid-replay. That beat is left out here:
it needs a two-replica stack and 15 s this cut doesn't have. It fits better in
Video 3 (crash mid-call).

## What has to exist before recording

1. **The starter must feed Insight.** Today `senior-sales-review` declares no
   `outcomes` and `analyze-lead` no `reviewed_by`, so a reviewer's decision is
   never counted as an override and the Insight half of the video cannot happen
   on this process. Add `outcomes: [approve, reclassify]` to the review node and
   `reviewed_by: { node: senior-sales-review, accept: approve }` to the agent,
   in both `studio/src/lib/starter/leadTriage.ts` and the review form. That is
   an APL fixture change: update `leadTriage.test.ts`, the engine
   deployment test, and run the Studio parity build.
2. **A deterministic model.** The recorder makes one real Gemini call today. The
   low-confidence beat and the replay need repeatable answers. Use the stub
   OpenAI-compatible model from the docs-screenshot setup: confidence 95 for the
   HIGH lead, 55 for the vague one, and answers on the corpus that reviewers
   disagree with on about a third of cases. Say on screen, in small type, that a
   test model stands in for the provider.
3. **A seeded corpus.** At least 40 finished instances, of which 20 or more
   reviewed (`abada.insight.min-review-samples` is 20) and at least 25 %
   overridden (`override-rate-threshold`). Seed through the API as alice/bob,
   not by writing to the database.
4. **Insight switched on for the recording stack:** `abada.insight.enabled=true`
   (default false), a short `interval-ms` and the proposal model pointed at the
   stub. Add a replay-required policy on the project.
5. **A vague example lead** in `LEAD_TRIAGE_EXAMPLES` (or the recorder only)
   whose stub answer is below 70.
6. **Recorder scenes 06–08** in `record.mjs` (Insight finding, proposal and
   replay, approve and rollback), plus an intro scene for the terminal capture,
   and new captions and cards in `cards.mjs`.

## Recording and delivery

- Record with `./scripts/showcase/build.sh` on the seeded stack; the terminal
  install is captured separately (real run, sped up 4–6×, with the speed shown)
  and dropped in at compose time.
- Narration: record voice over the finished picture, then fit the captions to
  it. The `.srt` is generated from the same caption list.
- Deliverables: 1080p master, web cut, `.srt`, poster frame, and three clips
  of 30–60 s for X, LinkedIn and Shorts:
  - *The engine doesn't guess* (0:25–1:30)
  - *A person decides, and it's on record* (1:30–2:05)
  - *The process improves, with permission* (2:05–2:57)
- Before publishing: every narration line checked against `claims.json`;
  re-record any screen that no longer matches the released Studio.

## Open questions

- Does this replace the support-ticket storyboard in `m4-demo-script.md`, or
  do both ship (lead triage for the launch, support tickets for `/investors`)?
- Voice: the maintainer's own voice, or captions only with no voice-over?
- Is reclassification the right override for sales, or should the reviewer
  reject with a reason? It changes the starter's outcomes.
