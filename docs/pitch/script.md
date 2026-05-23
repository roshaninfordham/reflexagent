# Reflex — 3-Minute Demo Script

> Use this as the spoken voiceover. Slides are backdrop. Demo carries the credibility.
> Total: ~180 seconds. Practice once cold.

---

## 0:00 — 0:15 · Hook (slide 1)

> "Drug recalls in the United States still run on faxes. Forty-five thousand to ninety-eight thousand Americans die every year from preventable medication errors. When the FDA issues a recall, it takes a hospital pharmacy days — sometimes weeks — to verify it, find affected patients, and notify clinicians. During that window, patients keep taking the recalled drug."

## 0:15 — 0:30 · The Mass General Brigham failure (slide 2)

> "Mass General Brigham tried to automate this in 2024. They abandoned deployment because false-positive notifications caused unacceptable patient anxiety. So **verification — not detection — is the unsolved problem**. That is the problem Reflex solves."

## 0:30 — 0:45 · What Reflex is (slide 3, switch to /ops)

> "Reflex is an always-on agent swarm. It watches the open web continuously. When a novel drug recall hits the wire, an eleven-agent swarm verifies it across primary sources, runs an *adversarial counter-evidence pass*, identifies affected patients in our cohort, drafts clinician communications, **and** suggests therapeutic alternatives — using actual protein-target similarity from NVIDIA BioNeMo."

## 0:45 — 1:30 · Live demo (Ops page, full screen)

> "Top: the autonomous monitor — polling OpenFDA every sixty seconds, unprompted. I'll force a metformin recall to fire the swarm right now."
>
> *(click "Inject demo signal" on landing if needed, or open `/ops` with the active workflow showing)*
>
> "Watch the canvas: eleven agents lighting up. **Scout** fans out three parallel queries to NimbleWay — FDA, EMA, PubMed. **Verify-plus-Counter** runs an adversarial pass — and **flags a conflict** in red — Apotex's investor-relations statement contradicts the FDA's NDMA finding. The system holds the recall for human review instead of silently broadcasting it."
>
> "Meanwhile **Cohort** runs SQL against ClickHouse — eighteen patients are on this drug, ten high-risk. And **Substitute** — this is new — calls NVIDIA BioNeMo's ESM2 protein embedding model. It ranks Sitagliptin as the top alternative with a target-protein cosine similarity of zero-point-nine-three."

## 1:30 — 2:00 · The voice agent does the work (Ops page, voice panel)

> *(click "Start conversation")*
>
> Presenter: "Take next steps for me. Send the memo, alert the doctors, notify the patients."
>
> *(agent chains three tool calls visibly — toasts appear, activity feed updates)*
>
> "The voice agent executed three real actions: sent the pharmacist memo to one recipient, alerted two clinicians, sent letters to five patients. Every action is audit-logged in ClickHouse and visible in the live activity feed on the right."

## 2:00 — 2:20 · The brief and the payment (open /brief/<id>)

> "The verified brief is published to cited dot M D — agent-discoverable open web. Real two-D chemical structure from PubChem, real three-D protein cartoon of the AMPK target from RCSB, three ranked therapeutic alternatives — each with its own structure preview."
>
> *(click Premium)*
>
> "Premium sub-briefs are paywalled via x402. Real on-chain settlement on Base Sepolia through Coinbase CDP — zero real money, real blockchain receipts. The agent itself pays from the burner wallet so this is agent-to-agent commerce."

## 2:20 — 2:40 · Architecture + sponsor stack (slide 6)

> "Seven sponsor tools, every one doing real work: NimbleWay for web search, Senso for publishing, ClickHouse for state and observability, NVIDIA NIM Llama three-point-three seventy-billion for reasoning, NVIDIA BioNeMo for protein embeddings, Datadog LLM Observability auto-instrumented via ddtrace, and x402 plus Coinbase CDP for payments. All seven called live during this demo."

## 2:40 — 3:00 · Market + close (slide 7)

> "The pharmacovigilance market is thirteen-point-seven billion dollars, growing sixteen percent a year. Forty-four thousand to ninety-eight thousand Americans die every year from preventable medication errors. Reflex is the autonomous verification layer that closes that gap."
>
> "Reflex. FDA's missing nervous system. Repository link is on screen. Thank you."

---

## Stage choreography

- **Screen 1**: `localhost:3000/ops` full screen.
- **Screen 2 (or browser tab)**: `app.datadoghq.com/llm/applications?query=ml_app%3Areflex` open behind the demo for "see, every call is traced."
- **Backup**: Have a 90-sec pre-recorded video on a tab ready to play if anything misbehaves.

## Failsafes
- If NIM is rate-limited: every agent has a deterministic fallback. The story doesn't break.
- If autonomous monitor is quiet: click "Inject demo signal" on landing — fires the swarm on the next 60-second tick.
- If Senso publish 400's (destination not enabled): git mirror always publishes a GitHub URL.
- If on-chain payment can't settle (no ETH): "Pay $0.50 (signed x402)" button uses HS256 JWT — same protocol, instant.
