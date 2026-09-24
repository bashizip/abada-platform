# Abada — site design system

## Audience & job of the page
Primary: buyers and design partners in regulated and sovereignty-sensitive organisations — banks, telcos, public sector — and the architects, security and risk people who evaluate for them. Investors are secondary and read the same page.
In 30 seconds they must get: the moat (AI-driven processes that run entirely on infrastructure they control — AGPL-3.0 open source, PostgreSQL as the only database, their identity provider, the model endpoint they choose), that the engine governs the AI, that the claims are proven and rerunnable, what the release does not do yet, and how to start a pilot.

## Moat, in order
1. Sovereign and open: self-hosted, AGPL-3.0, PostgreSQL-only, telemetry off by default; say exactly what can cross the boundary.
2. Governed by the engine: agents advise, rules decide, humans approve, PostgreSQL remembers.
3. Proof: recorded release gate and the rerunnable exit demo (`scripts/test/m1-exit-demo`).

## Voice
Infrastructure-grade, declarative, no hype adjectives. Claims are bounded and verifiable ("implemented", "recorded release gate", "target use cases — not traction"). Never invent metrics or customers.

## Color
- Base `--ink: #05070A` (near-black, slight blue), section alt `#080B10`
- Surface `#0D1117` / border `rgba(255,255,255,.08)`
- Primary accent `--signal: #34D399` (Abada emerald) — used for the one claim per screen that matters
- Secondary accent `--wire: #60A5FA` (diagram/architecture lines only)
- Warn `--amber: #FBBF24` (the "chaotic swarms" / failure column only)
- Text: `#F5F7FA` primary, `#94A3B8` secondary, `#5B6675` tertiary

## Typography
- Display + body: **Geist** (400/500/600/700) — technical, neutral, not Inter
- Labels, table headers, code, metadata: **Geist Mono** uppercase, tracking-[0.18em], 11–12px
- H1 clamp(2.8rem, 6vw, 5.2rem), weight 600, tracking -0.03em, line-height 0.95
- Section H2 clamp(2rem, 3.6vw, 3.2rem), weight 600, tracking -0.02em
- Body 17px/1.65, max-width 62ch

## Layout
- Max width 1200px, 24px gutters; asymmetric 7/5 hero split
- Section rhythm: mono eyebrow → H2 → one-line thesis → evidence
- Hairline dividers instead of card borders where possible; 1px grid background in hero
- Comparison table is the visual centerpiece: 3 columns, Abada column raised with emerald edge

## Motion
One orchestrated page load: staggered fade-up (Motion library), 60ms steps, hero only. Scroll reveals are subtle opacity/translate, once. No parallax, no bouncing.

## Anti-patterns
No purple gradients, no rounded card grid, no stock photos, no emoji, no "revolutionary/game-changing".
