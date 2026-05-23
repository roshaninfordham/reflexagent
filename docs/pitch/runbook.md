# 3-Minute Demo Runbook

> Cheat sheet for the live demo. Print this. Have it next to the laptop.

## T-minus 30 seconds (before the timer starts)

1. **Two browser windows ready:**
   - Window A — full-screen: `http://localhost:3000/ops`
   - Window B — small (or second monitor): `https://app.datadoghq.com/llm/applications?query=ml_app%3Areflex`
2. **Three terminals running:**
   - `ddtrace-run uvicorn apps.api.main:app --port 8000`
   - `cd apps/web && npm run dev`
   - `tail -f logs/api.log` (so you can see NIM responses scroll if needed)
3. **Pre-warm the swarm** so the Ops page shows an active workflow:
   ```bash
   curl -s -X POST http://127.0.0.1:8000/api/v1/trigger \
     -H 'Content-Type: application/json' \
     -d '{"drug_name":"Metformin HCl","manufacturer":"Apotex Corp.","ndc":"60505-2657-0","lot_numbers":["APX5523","APX5524"],"recall_class":"II","reason":"NDMA detected above interim limit.","source":"manual","confidence":0.95}'
   ```
4. **Open Ops** in Window A. Refresh until the active workflow shows up.
5. **Grant mic permission** for Chrome on localhost (it'll prompt on Start conversation — better to do it now).

## During the demo (3:00 total)

| Time | What you say | What you click |
|---|---|---|
| 0:00 | Hook — "Drug recalls still run on faxes…" | Window A on screen (Ops page already showing) |
| 0:15 | Mass General Brigham failure | Same |
| 0:30 | "Reflex is an always-on agent swarm…" | Same |
| 0:45 | "Watch the canvas — eleven agents…" | Point at canvas; emphasize the red Verify·Counter when it flashes |
| 1:00 | Walk through Triage / Verify+Counter / Cohort / Substitute | Stay on Ops; use cursor to highlight panels |
| 1:30 | "Take next steps for me…" | Click **Start conversation** in Voice Agent → speak the line |
| 1:45 | Three actions execute live | Toasts pop, Activity feed flashes |
| 2:00 | "The verified brief is published to cited.md" | Click "brief →" link in active-workflow header |
| 2:10 | 2D / 3D molecule preview, BioNeMo substitutes | Scroll once to show therapeutic alternatives |
| 2:20 | "Premium sub-briefs via x402" | Click Premium link |
| 2:25 | "Pay 0.50 — signed x402" | Click **Pay $0.50 (signed x402)** button |
| 2:30 | Sub-brief generates | Wait ~5s, point at the answer |
| 2:35 | Switch to Datadog tab (Window B) | "Every NIM call captured automatically" |
| 2:40 | Sponsor stack callout | Verbally enumerate the 7 |
| 2:50 | Market + close | Back to Ops page |
| 2:58 | "Reflex. FDA's missing nervous system." | End on the canvas |

## If something fails

- **Voice not picking up**: Type the question in the Premium page instead (or just narrate "you'd ask…")
- **NIM rate-limited**: Every agent has a deterministic fallback that still produces a real brief
- **Canvas frozen**: Refresh the page — workflow data is in memory
- **WiFi dies**: Play the pre-recorded video from the backup tab and narrate over it
