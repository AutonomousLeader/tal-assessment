# Leave Kit, Keep the Funnel — Migration Spec

**Goal:** Drop Kit's ~$39/mo Creator plan without breaking the assessment + lead-magnet email funnel.
**Prepared:** September 4, 2026 · The Autonomous Leader

---

## 1. The core problem (read this first)

Your app sends **zero email**. Confirmed in the code: `tal-assessment-api` has no email library installed (only `express`, `cors`, `better-sqlite3`), and `tal-site/lib/kit.ts` only upserts subscribers and adds them to Kit sequences.

Everything that actually emails a human lives **inside Kit**:

- The **email copy** — every results email, welcome email, nurture email — is written and stored in Kit's sequences.
- The **timing** — the 2-day nurture delay, the 7-day upsell wait, the 90-day retake — is Kit's automation delays.
- The **trigger logic** — "if tagged `tal-level-4` and `tal-type-deep`, send the Level 4 email" — is Kit's visual automations.

Your app's only job today is: **create the subscriber, write custom fields, apply the right tag.** Kit does the rest.

So "keep the funnel" means owning three things Kit does today: **the email bodies, the timing/scheduler, and the trigger logic.**

**Important update:** the email bodies are NOT trapped in Kit. All 16 funnel emails are already written and saved in the repo at `_BUILD/kit-emails/` — in markdown AND HTML, plus a `v2` HTML set, a `KIT_SETUP_GUIDE.md`, and an extra 5-email `breakaway-draft/`. Both lead-magnet PDFs are in `tal-site/public/downloads/`. So the hardest, most fragile part of a migration — recovering the copy — is **already done.** What's left is purely mechanical: wire a sender + a scheduler to content you already have.

---

## 2. What's live in Kit right now (must be replaced)

**12 active Visual Automations**, all tag-triggered:

| Automation | Trigger tag(s) | What it does |
|---|---|---|
| TAL Deep Results — Level 1–7 | `tal-level-N` + `tal-type-deep` | Sends that level's results email (7 automations) |
| TAL Quick Results | `tal-type-quick` | Sends quick-assessment results email |
| TAL Quick-to-Deep Upsell | `tal-type-quick` → wait 7 days | Upsell to the deep assessment |
| TAL Nurture | `tal-assessment-completed` + `tal-type-deep` → wait 2 days | 5-email / 28-day nurture |
| TAL 90-Day Retake | `tal-assessment-completed` → wait 90 days | Retake reminder |
| TAL Outreach Follow-up | `tal-outreach-requested` → wait 1 hour | Follow-up after outreach request |

**Lead-magnet sequences** (fired by `tal-site`):

| Sequence | Delivers |
|---|---|
| TAL — 6 Traps Welcome | The 6 Traps PDF download email |
| TAL — 9P Playbook Welcome | The 9P Playbook PDF download email |

**Also noted:** immediate results emails (Deep L1–7, Quick) send instantly; everything else has a delay. The delayed ones are what force a scheduler — you can't do them with fire-and-forget sends.

---

## 3. Target architecture (after migration)

```
Assessment finishes / lead-magnet opt-in
        │
        ▼
 tal-assessment-api  (Railway)
   ├─ writes assessment to SQLite               (already exists)
   ├─ sends INSTANT emails via Resend/Postmark  (NEW — results, PDF delivery)
   └─ queues DELAYED emails in a jobs table      (NEW — nurture, upsell, retake)
        │
        ▼
 Scheduler / worker  (Railway cron or setInterval)   (NEW)
   └─ every few minutes: find due jobs → send via Resend → mark sent
        │
        ▼
 Transactional email provider  (Resend or Postmark)   (NEW)
   └─ actually delivers the mail
```

You already have the SQLite database and a working retry-loop pattern (`kit-retry.js` runs a `setInterval` every 5 min) — the scheduler is the **same pattern** pointed at a new `email_jobs` table instead of Kit.

---

## 4. Component-by-component build

### A. Transactional email provider
- **Recommend Resend** (cleanest API, React email templates) or **Postmark** (best deliverability reputation).
- At ~22 subscribers your volume is tiny — **Resend's free tier (3,000 emails/mo, 100/day) covers you at $0.**
- One-time setup: verify your sending domain (SPF/DKIM DNS records on `theautonomousleader.com`). ~30 min + DNS propagation.

### B. Email templates — ALREADY DONE (this was the hard part)
- The copy already exists in `_BUILD/kit-emails/` (md + HTML + v2 HTML) covering all 16 funnel emails.
- Remaining work is small: move the HTML into the app (e.g. `tal-assessment-api/emails/*.html`), swap Kit's merge fields for your own placeholders (`{{first_name}}`, `{{level}}`, `{{result_link}}`), and confirm each renders. A few hours, not a rewrite.
- **One gap to verify:** the two lead-magnet *welcome* email bodies (the short "here's your download" note for 6 Traps / 9P Playbook) may live only in Kit's two welcome sequences — the PDFs are in the repo but that one-line delivery email might not be. Trivial to rewrite if so; I can also pull the exact copy from Kit if you'd rather keep it verbatim.

### C. Instant sends (results + PDF delivery)
- In `routes/assessment.js`, where it currently calls `syncToKit`, add a call to send the correct results email immediately (pick template by `levelResult` + `assessmentType`).
- In `tal-site`, replace `addToSequence` with a direct send of the lead-magnet PDF link.
- Lowest-risk first step — this alone fixes the "opt-in gets nothing" break.

### D. Delayed sends (scheduler)
- New `email_jobs` table: `id, email, template_key, payload_json, send_at, sent_at, status`.
- When an assessment completes, insert the delayed jobs (nurture +2d, retake +90d, upsell +7d) with their `send_at`.
- New worker (clone `startRetryLoop`): every 5 min, `SELECT * FROM email_jobs WHERE sent_at IS NULL AND send_at <= now()`, send each, mark sent.
- Handles the nurture drip, 90-day retake, and 7-day upsell. Your existing `/api/reminder` route + `reminders` table already does half of this — extend that pattern.

### E. Keep or drop tags?
- Tags become **optional** once you own the trigger logic — your app already knows the level/type. You can keep writing tags to a lightweight list tool later, or drop them entirely.
- **Custom fields / Kit-as-backup:** `kit-import.js` currently rebuilds your DB from Kit if the local DB is lost. After migration, replace that safety net with a **daily SQLite backup** (Railway volume snapshot or a nightly dump to Drive/S3). Don't skip this — it's your only copy of assessment history once Kit is gone.

---

## 5. Migration order (do it in this sequence — no downtime)

1. ~~Export every email body from Kit~~ **Already done** — copy is in `_BUILD/kit-emails/`. Only verify the 2 lead-magnet welcome bodies (§4B).
2. Set up Resend + verify domain.
3. Build instant sends (results emails + lead-magnet PDF delivery). Deploy. Test with a real assessment.
4. Build the `email_jobs` scheduler for delayed emails. Deploy. Test.
5. Set up daily SQLite backup to replace Kit-as-backup.
6. Run **both systems in parallel for ~1–2 weeks** — Kit still on, new system live — and confirm every email fires correctly from the new path.
7. Turn off Kit automations, watch for a few days, then **downgrade Kit to free** (keep it as a plain broadcast list) or cancel entirely.

Never downgrade before step 6 passes.

---

## 6. Effort & cost

| | Estimate |
|---|---|
| Build time (developer) | ~6–12 hours: provider setup, wiring existing templates, instant + delayed sends, backup, testing |
| Content recovery | **~0 — copy already in the repo.** Maybe 30 min to verify 2 lead-magnet welcome bodies. |
| New monthly cost | **~$0** (Resend free tier covers your volume) vs. **$39/mo Kit** |
| Annual saving | **~$468/yr** |
| Payback | If a dev bills the build, it pays for itself in a few months; if you build it with me, near-immediate. |

---

## 7. Honest recommendation

The saving is real (~$468/yr) and your volume makes the new hosting essentially free. But you're trading a **$39/mo managed system that works today** for a **self-hosted system you now own and must maintain** (deliverability, bounces, the scheduler staying up on Railway). At 22 subscribers, that's a fine trade if you enjoy owning the stack or expect to keep scaling the assessment. If the assessment is still finding its audience, the lower-risk move is to **stay on Kit until volume justifies the rebuild**, and revisit when you're past a few hundred subscribers.

Because the email copy is already in the repo, the migration is lower-risk than a from-scratch build — it's plumbing (sender + scheduler), not writing. If you want to proceed, the first real step is standing up Resend and wiring the instant results/PDF emails; that single step ends the "opt-in gets nothing" break, and the delayed nurture/upsell/retake scheduler can follow. I can start on that whenever you're ready.
