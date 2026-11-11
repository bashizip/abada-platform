# Abada — discovery and adoption playbook

Working material for getting Abada found, installed, starred and contributed to. It is
internal: nothing here is a product contract. Every public claim made from this folder
must be backed by code, tests or the authoritative documents listed in
[`AGENTS.md`](../../AGENTS.md) ("evidence over claims").

| File | Use it for |
| --- | --- |
| [`launch-kit.md`](launch-kit.md) | Positioning, Show HN / Reddit / Product Hunt drafts, newsletter pitch, objections FAQ, talk abstract |
| [`content-calendar.md`](content-calendar.md) | Cornerstone post outlines, video scripts, social posts, calendar from 2026-11-16 |
| [`listings.md`](listings.md) | Awesome lists and directories to submit to, with ready-to-paste entries |
| [`good-first-issues.md`](good-first-issues.md) | 20 issue drafts to seed on GitHub |
| [`comparison-draft.md`](comparison-draft.md) | Draft "how Abada compares" — needs fact-checking before publishing |

## Scope and audiences (revised 2026-11-11)

This folder covers public communication only: content, channels, launches, listings.
How we find and sign design partners or pilots is a separate strategy and is not kept
here.

Two audiences, in this order:

1. **Decision-makers in regulated institutions** (Kinshasa, francophone Africa):
   LinkedIn in French on the maintainer's profile, 1–2 posts a week, Tue–Thu mornings
   Kinshasa time. Message: *l'IA propose, la règle décide, l'humain tranche — sur vos
   propres serveurs.* Say sovereignty precisely: Abada and its data run on your servers;
   the model is the one you choose.
2. **Developers** (the launch kit). The public launch week moves to the week after 1.2.0
   ships (Studio experience, task files), so first-time visitors see the new Studio. If
   1.2.0 slips past 2026-11-27, launch on 1.1.2 in the week of 2026-12-07 anyway.

Development of 1.2.0 continues on `dev` while marketing runs.

## Baseline (2026-11-11)

1 star, 2 forks, Discussions on, 16 topics (`hacktoberfest` is out of date: remove it).
Product: `1.1.2`; 1.2.0 in progress on `dev`. Launch week not held yet. Videos: the
"Abada universe" film (FR, EN) and the two CNSS videos (private).

## Baseline (2026-10-13)

1 star, 0 forks, Discussions off, 5 topics. Product: `1.1.0-rc.2`, one-line installer,
docs site, website, showcase GIF.

## Goals for week 12 (developer track, counted from the launch week)

| Metric | Target | Where to read it |
| --- | --- | --- |
| GitHub stars | 300–500 | star-history.com, repo header |
| Verified installs | 50+ | GHCR pull counts, "I installed Abada" Discussion |
| External contributors with a merged PR | 5+ | Insights → Contributors |
| Launch that reaches a front page | 1 | HN / Reddit |
| Talk proposals submitted | 2+ | CFP tracker below |

## Funnel

```
find  →  understand (README, 30 s)  →  install (1 command, 2 min)  →  first win (tutorial)  →  star  →  ask / contribute
```

Each stage has one owner artefact. Fix the weakest stage before pushing more traffic:

| Stage | Artefact | Check |
| --- | --- | --- |
| Find | posts, listings, talks | Traffic → referrers |
| Understand | README top + GIF | Bounce: views vs. clones |
| Install | `install.sh` | Run it on a fresh VM before every launch |
| First win | [Quickstart](https://docs.abadaplatform.com/user/quickstart/) + tutorials | Docs analytics: quickstart → tutorial |
| Star | README CTA | Stars / unique visitors |
| Contribute | CONTRIBUTING, labelled issues | Time to first response < 48 h |

## Weekly routine (~8 h)

| Time | Activity |
| --- | --- |
| 3 h | One piece of content (post every 2 weeks, video the other week) |
| 1 h | 3 social posts (X, LinkedIn, Bluesky) — reuse the content of the week |
| 2.5 h | Community: 20–30 min a day on issues, PRs, Discussions, Reddit/HN replies |
| 1 h | Outreach: one listing, one newsletter pitch or one CFP |
| 0.5 h | Metrics review (table above); write down the top 2 referrers |

## Phases (written 2026-10-13; dates superseded by the calendar in `content-calendar.md`)

1. **Weeks 1–2 — Make the repo convert.** Community files, README CTA (done in this
   branch). External, maintainer-only: enable Discussions, add topics, set the social
   preview, create labels and the issues from `good-first-issues.md`, publish a GitHub
   Release with the GIF. Join Hacktoberfest (add topic `hacktoberfest`) while October lasts.
2. **Weeks 3–4 — Content engine and soft launch.** Two cornerstone posts, two short videos,
   listings, small communities (r/selfhosted, r/java, r/SpringBoot, Java/Spring Discords,
   GDG and DevFest communities in Africa). Collect feedback; fix the install path.
3. **Weeks 5–6 — Launch week.** Show HN (Tue), Product Hunt (Wed), Reddit (Thu),
   newsletters (Fri). Stay in the threads all day. See `launch-kit.md`.
4. **Weeks 7–12 — Community.** Monthly office-hours livestream, contributor shout-outs,
   help-wanted epics (Python and TypeScript worker clients), talks, partnerships.

## Recommended GitHub settings (maintainer action)

- **Topics:** `workflow-engine`, `process-automation`, `bpmn`, `bpmn-engine`,
  `ai-agents`, `agentic-workflows`, `ai-governance`, `human-in-the-loop`, `llm`, `mcp`,
  `self-hosted`, `postgresql`, `spring-boot`, `java`, `camunda-alternative`, `hacktoberfest`.
- **Discussions categories:** Announcements, Q&A, Ideas, Show and tell, "I installed Abada".
- **Labels:** `good first issue`, `help wanted`, `documentation`, `examples`, `studio`,
  `engine`, `sdk`, `triage`.
- **Social preview:** 1280×640 from `brand/png/`.

## CFP tracker

| Event | Deadline | Status |
| --- | --- | --- |
| FOSDEM (Java / Declarative devrooms) | check site | to submit |
| Devoxx Morocco / Devoxx BE / FR | check site | to submit |
| Spring I/O | check site | to submit |
| DevFest (GDG chapters, incl. Africa) | rolling | to submit |
| Local Java User Groups, AI Engineer meetups | rolling | to contact |
