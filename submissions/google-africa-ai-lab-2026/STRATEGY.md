# Pitch Strategy — Google Africa AI Lab 2026

**Hard deadline:** Monday, August 31, 2026
**Today:** Thursday, August 27, 2026 — **4 days left**
**Working rule:** submit on **Sunday, August 30** (evening). Keep Monday as pure buffer for emergencies. Never submit on the deadline day.

This document consolidates the full plan: deliverables, daily schedule, demo/pitch
production decisions, tooling choices, and the risk triage if time runs out.
Companion file (do not edit): [`SUBMISSION.md`](SUBMISSION.md) — form fields and copy.

> **UI narrative decision (Aug 27):** the pitch story is **one engine, one UI
> (Studio), one worker model**. Tenda/Orun stay in the repo as reference-only
> front-ends; Semaflow is excluded from the Abada platform (superseded by
> engine-native NL→APL authoring), not deleted. Repo consolidation is complete
> (see §8).

---

## 1. The One Sentence (locked)

> Abada is an open-source, AI-native workflow orchestration platform that lets teams build and run durable business processes in YAML — where Gemini-powered agents, human tasks, and system integrations are first-class citizens, compiled directly to a PostgreSQL-backed execution graph without XML.

Already final in `SUBMISSION.md`. Every slide, website section, and demo beat must
support this sentence. If something doesn't, cut it.

**Short variant** (for the website hero only):

> Open-source, self-hosted workflow orchestration where Gemini agents and human tasks are first-class citizens — durable, auditable, and yours to run.

---

## 2. Deliverables → Form Fields Map

The form needs exactly four artifacts. Everything else is optional.

| # | Deliverable | Form field | Status | Due |
|---|---|---|---|---|
| 1 | One-sentence description | "Describe what your company does" | ✅ Done (in `SUBMISSION.md`) | — |
| 2 | Pitch deck (10–12 slides) + shareable link | "Link to latest pitch deck" | ⬜ Not started | Sat Aug 29 |
| 3 | Demo video (2–3 min) + shareable link | "Link to latest product demo and/or video" | ⬜ Not started | Sun Aug 30 |
| 4 | Website live at abada.studio | "Company website" | ⬜ Needs verification/polish | Sat Aug 29 |
| 5 | HQ location + Field dropdown | — | ⬜ 2 minutes | Sun Aug 30 (submission) |

---

## 3. The Schedule

### Day 0 — Tonight (Thu Aug 27, ~2h). Decide, don't produce.

- [ ] **Freeze the product.** No new features until Monday. The demo runs on what exists today.
- [ ] **Pick the demo story:** the lead-triage APL flow (webhook → Gemini agent → condition → human review with form → CRM). It's the same story as the deck and the one-liner. One story, three artifacts.
- [ ] **Inventory assets:** Studio screenshots (modeler, Task Inbox, Admin), the 61-line lead-triage YAML, `LeadTriageHumanInputTest` as proof, test-suite numbers (323 tests), restart-recovery evidence.
- [ ] **Verify the demo environment boots:** run the release compose stack once tonight, not tomorrow. If it's broken, you want to know now.

### Day 1 — Fri Aug 28. Words before pixels.

**Morning — demo script first** (it drives the deck and website copy):

- Write the voiceover verbatim, using the beat list in `SUBMISSION.md` § Product Demo Script (7 beats: open Studio → author/deploy APL → start instance → agent node fires → routing → human form → restart recovery).
- ~2:30 target. Write for the ear: short sentences, no nested clauses. Read it aloud once.

**Afternoon — deck text + website copy:**

- Fill the 12-slide outline in `SUBMISSION.md` § Pitch Deck Outline with real copy. Keynote density: one sentence per slide, big screenshots.
- Slide 4 (61 lines YAML vs 800+ lines XML) and slide 5 (Gemini-native) carry the pitch — spend the time there.
- Draft website copy as a plain doc: hero (short one-liner) → 3 feature blocks (AI-native APL / durable runtime / self-hosted sovereignty) → embedded video → quickstart CTA.

**End of day gate:** script locked, deck text complete, website copy drafted. No design work yet.

### Day 2 — Sat Aug 29. Production day.

**Morning — deck:**

- Paste copy into Google Slides or Canva with a minimal template. Do not fight AI deck generators (see §5).
- Insert real screenshots. Export/upload, generate the shareable link, test it in an incognito window.

**Afternoon — website + recording:**

- Ship the landing page on abada.studio. Link docs; don't rebuild them.
- Record the demo in **segments — one take per beat**, never one long take. 1080p, hide the bookmarks bar, bump font sizes.
- Rehearse twice before hitting record.

**End of day gate:** deck link live, website live, all demo segments captured.

### Day 3 — Sun Aug 30. Edit, polish, SUBMIT.

- [ ] Generate TTS voiceover per beat (script was locked Friday), cut video to the audio, add captions.
- [ ] Title card: the one sentence. End card: repo URL + abada.studio.
- [ ] Upload video (Loom/YouTube unlisted/Drive), test link incognito.
- [ ] Final deck pass: rehearse once against a timer, fix typos.
- [ ] **Fill the form and submit in the evening.** Fill HQ location and Field dropdown directly in the form.
- [ ] Save a copy of the submitted answers locally.

### Mon Aug 31 — buffer only.

Nothing scheduled. If something broke Sunday, fix and submit today. Then stop.

---

## 4. Hosting Decision: Quickstart Link, Not a Public Cloud Demo

**Decision: no public hosted demo. Link the on-prem quickstart; run one private cloud instance as live-demo backup.**

Why not public cloud:

1. **Off-message.** The pitch is "self-hosted, data sovereignty." A vendor-hosted sandbox contradicts the one-liner.
2. **It's an RC.** Hardening a public engine + Keycloak in 4 days invites a security incident as a launch souvenir.
3. **Ops risk.** A demo env you operate can 500 mid-pitch. A video can't.

Why the quickstart wins:

- The audience evaluates self-hosted software by running it. A 5-minute `docker compose up` is itself the proof.
- Zero cost, zero exposure, true forever.

Action items:

- [ ] Time the release compose quickstart cold. If ~5 min, put the number on the website: *"Zero to running process in 5 minutes."* If slower, fix the script — higher leverage than any sandbox.
- [ ] Website CTA = a **copy-paste command block**, not just a GitHub link.
- [ ] One **private** cloud VM (release compose, OIDC locked to your account) as the live-demo backup behind the video. Tear down/rebuild between meetings.
- [ ] Stretch goal (Sunday buffer only): "Open in GitHub Codespaces" devcontainer that runs the quickstart. Skip it if it fights you.

---

## 5. AI Tooling Decisions

### TTS voiceover: yes.

- Re-dub in seconds when the script changes on Sunday (it will). No retakes, no room noise.
- Generate **per beat**, not one long take — Sunday edits stay surgical.
- Tools: ElevenLabs / Play.ht / OpenAI TTS — confirm the plan allows commercial use.
- Cut the video **to** the audio, not the reverse.
- Captions regardless — many watch muted.
- Optional hybrid: your own voice for the 5-second opener, TTS for the walkthrough.
- Caveat: if you're a confident speaker with a decent mic, your real voice signals "founder-built" to engineers. Otherwise TTS — bad audio kills demo videos faster than synthetic narration.

### AI deck generators: scaffolding only.

- Use AI Day 1 morning to pressure-test the outline ("what's missing, what's weak") — 30 minutes, genuinely useful.
- Do **not** generate the final deck with it: the "AI look" (gradient blobs, stock 3D icons, buzzwords) reads as low-effort to platform engineers, and you'll burn hours fighting regeneration on the two slides that matter (architecture, APL-vs-XML).
- Production = minimal template + real screenshots + one sentence per slide.

---

## 6. Risk Triage — If You're Behind Schedule

Minimum viable submission, in priority order. The form cannot be submitted without 1–3:

1. **Deck** — non-negotiable, it's a required link. If desperate: 8 slides instead of 12, screenshots + one-liners, 2 hours.
2. **Demo video** — non-negotiable. Fallback per `SUBMISSION.md`: a **code walkthrough** (APL parser, NL→APL authoring, `LeadTriageHumanInputTest` passing) is explicitly acceptable and needs no compose stack, no TTS, no editing — one clean take, raw audio.
3. **Form fields** (HQ, Field) — 2 minutes, but do them during submission, not before.
4. **Website polish** — first thing to cut. A clean single-section page with the one-liner, video, and quickstart command is enough. The form only asks for the URL.

If Sunday noon arrives with no video: switch to the code-walkthrough fallback immediately and protect the evening submission slot.

---

## 7. Master Checklist (copy into your task manager)

**Tonight:**
- [ ] Product frozen; demo env boots; assets inventoried

**Friday:**
- [ ] Voiceover script written verbatim and read aloud once
- [ ] 12 slides of copy written
- [ ] Website copy drafted

**Saturday:**
- [ ] Deck built, shareable link tested incognito
- [ ] Website live at abada.studio with quickstart command block
- [ ] Demo segments recorded (one take per beat)

**Sunday:**
- [ ] TTS generated per beat; video cut, captioned, uploaded; link tested incognito
- [ ] Deck rehearsed once against a timer
- [ ] Quickstart timing measured (for website copy)
- [ ] **Form submitted — evening deadline**

**Monday (buffer):**
- [ ] Emergencies only

---

## 8. UI Consolidation (done)

Decision (Aug 27): **Studio is the sole operator UI.** Tenda/Orun remain in the
repo as reference front-ends (per `docs/platform-overview.md`, commit `810f70b`)
but are removed from all deploy/build paths. Semaflow is **excluded** from the
Abada platform — its NL→BPMN concept is superseded by engine-native NL→APL
authoring (`AplAuthoringService`), which is also the pitch narrative. Semaflow's
local repositories are left untouched (they are not tracked by Abada git); only
Abada's references to it are removed.

**Phase 1 — Tenda/Orun out of deploy paths:**
- [x] Remove `abada-tenda`/`abada-orun` services + Traefik labels from `compose.yaml`, `compose.dev.yaml`, `compose.prod.yaml`; simplify `ABADA_ALLOWED_ORIGINS` to Studio
- [x] Drop tenda/orun env vars from `release/.env.dev.example` / `release/.env.prod.example`
- [x] Remove tenda/orun image substitution from `release/build-bundle.sh`; publish the complete image set (engine + Studio + Docs + agent-worker)
- [x] Drop tenda/orun builds from `scripts/prod/build-prod.sh` and CI publish matrix
- [x] Remove tenda/orun assertions from `scripts/test/validate-platform-deployment.sh` (incl. `orun-admin` Keycloak user checks + realm cleanup)
- [x] "Reference front-end — use Studio" banner in `tenda/README.md`, `orun/README.md`
- [x] Update root `AGENTS.md` layout table + verification rows (add `studio/`)
- [x] Remove the 4 legacy `k8s/base` Tenda/Orun manifests (K8s certification deferred to 1.1)

**Phase 2 — Exclude Semaflow:**
- [x] Remove Abada references to Semaflow; leave the local `semaflow/`/`semaflow-ui/` repositories untouched

**Phase 3 — Verify (AGENTS.md packaging contract):**
- [x] `docker compose ... config --quiet` (dev + prod), `validate-platform-deployment.sh`, Studio `npm run build`, docs build

---

*Prepared August 27, 2026. Four days is enough if the story stays single: one sentence, one demo, one deck.*
