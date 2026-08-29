# Screen Recordings Checklist

All recordings: 1080p, 14pt font, hide bookmarks bar, no audio, `.webm` format.
Target duration: 5–8 seconds each, auto-playing muted loop.

---

## Recordings

| # | Name | Section | Description | Duration | Status | File |
|---|---|---|---|---|---|---|
| 1 | `apl-authoring.webm` | APL vs BPMN | Pasting lead-triage YAML into Studio, deploying it | ~8s | ⬜ | `recordings/apl-authoring.webm` |
| 2 | `agent-execution.webm` | Feature: AI-Native | Agent node firing, returning HIGH/MEDIUM/LOW classification | ~5s | ⬜ | `recordings/agent-execution.webm` |
| 3 | `condition-routing.webm` | Feature: AI-Native | Condition node branching to human task or CRM based on agent output | ~5s | ⬜ | `recordings/condition-routing.webm` |
| 4 | `restart-recovery.webm` | Feature: Durable Runtime | Engine restarts, process resumes from exact same state | ~5s | ⬜ | `recordings/restart-recovery.webm` |
| 5 | `quickstart-install.webm` | Feature: Self-Hosted | Terminal: `curl` command → stack boots → Studio loads | ~8s | ⬜ | `recordings/quickstart-install.webm` |

---

## Recording Setup

- **Resolution:** 1920×1080
- **Font size:** Bump to 14pt in Studio and terminal before recording
- **Bookmarks bar:** Hide in Chrome/Safari
- **Terminal:** Dark theme, full-screen, no other tabs visible
- **Studio:** Clean workspace, no extra panels, lead-triage process open
- **Format:** `.webm` (smaller than `.mp4`, auto-plays in browsers)
- **Tool:** Use built-in screen recording (Cmd+Shift+5 on Mac) or OBS

---

## Recording Steps

### 1. apl-authoring.webm
1. Open Studio with lead-triage process loaded
2. Show the YAML editor with the 61-line lead-triage definition
3. Click Deploy
4. Show deployment success indicator

### 2. agent-execution.webm
1. Start a process instance with a lead payload
2. Token reaches `analyze-lead` agent node
3. Show `lead_priority` variable populated with HIGH/MEDIUM/LOW
4. Brief pause on the result

### 3. condition-routing.webm
1. After agent returns HIGH priority
2. Show `check-priority` condition node evaluating
3. Token routes to `senior-sales-review` human task
4. Show the human task form appearing

### 4. restart-recovery.webm
1. Show a running process instance (mid-execution)
2. Stop the engine (Ctrl+C or docker stop)
3. Restart the engine
4. Show the process resumes from the exact same state
5. Token continues where it left off

### 5. quickstart-install.webm
1. Open a clean terminal
2. Type: `curl -fsSL https://install.abadaplatform.com | bash`
3. Show the script running, downloading, verifying
4. Show the stack starting (docker compose)
5. Studio loads in browser

---

## Post-Recording

- [ ] Trim each clip to target duration
- [ ] Convert to `.webm` if recorded as `.mp4` (use `ffmpeg`)
- [ ] Test autoplay muted in browser
- [ ] Upload to Google Drive / YouTube unlisted
- [ ] Get shareable links for website embed

---

*Created August 28, 2026*
