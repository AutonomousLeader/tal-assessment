# Resend Migration — Setup & Deploy Guide

The code is built and tested. This is the checklist to take it live. Your part is
the three things I can't do for you: create the Resend account, add DNS records,
and set env vars. Everything else is already in the repo.

**Cost after cutover:** ~$0/mo (Resend free tier covers your volume) vs ~$39/mo Kit.

---

## What was built (already in your repo)

**`tal-assessment-api/`**
- `src/emails/` — all 16 funnel emails (copied from `_BUILD/kit-emails v2`).
- `src/services/email/` — the new engine:
  - `manifest.js` — subject + preview + file for each email (verbatim from Kit).
  - `renderer.js` — renders the templates with LiquidJS (same `{{ }}` / `{% if %}` Kit used).
  - `mailer.js` — sends via Resend; no-op until `RESEND_API_KEY` is set.
  - `plan.js` — the send plan (which email, what delay) — replaces the 12 Kit automations.
  - `send-pipeline.js` — enqueues jobs on submit / flag.
  - `scheduler.js` — sends due jobs every 60s (clone of your `kit-retry` pattern).
- `src/db/schema.js` — new `email_jobs` queue table.
- `src/db/repository.js` — queue read/write methods.
- `src/routes/assessment.js` — `/submit` and `/flag` now enqueue emails (Kit still runs too).
- `src/server.js` — starts the email scheduler.
- `scripts/backup-db.js` — daily SQLite backup (replaces Kit-as-backup).
- `package.json` — added `liquidjs`.

**`tal-site/`**
- `lib/email.ts` — sends the two lead-magnet welcome emails via Resend.
- `app/api/lead-magnet/route.ts` — delivers the PDF via Resend (Kit still runs too).

Both apps are safe to deploy **right now**: with `RESEND_API_KEY` unset, all the
new code is a no-op and Kit keeps doing exactly what it does today.

### The send plan (what replaced the 12 Kit automations)

| Trigger | Email(s) | Timing |
|---|---|---|
| Deep assessment done | Deep Results L1–7 | immediately |
| Deep assessment done | Nurture (5 emails) | +2, +5, +9, +14, +30 days |
| Any assessment done | 90-Day Retake | +90 days |
| Quick assessment done | Quick Results | immediately |
| Quick assessment done | Quick-to-Deep Upsell | +7 days (skipped if they've since gone deep) |
| "Request outreach" clicked | Outreach Follow-up | +1 hour |
| 6 Traps / 9P opt-in | Welcome + PDF | immediately |

> **⚠️ One thing to confirm:** your **live** Kit "TAL Nurture" automation was gated
> to *deep-takers only* (it had a "Has tal-type-deep" condition). The written setup
> guide didn't have that gate. I matched the **live** behavior — quick-only takers
> get Quick Results + Upsell + Retake, but **not** the 5-email nurture. If you want
> quick takers nurtured too, tell me and I'll move one block in `plan.js`.

---

## Your steps

### 1. Create a Resend account
Go to resend.com, sign up, and create an API key (Dashboard → API Keys → Create).
Copy it — it looks like `re_xxxxxxxx`. (I can't create accounts or handle keys for you.)

### 2. Verify a sending subdomain (this is the deliverability step)
In Resend → Domains → Add Domain, enter **`mail.theautonomousleader.com`**
(a dedicated subdomain keeps this stream's reputation clean and separate).
Resend will show you 3–4 DNS records (SPF/MX, DKIM, and a DMARC suggestion).
Add them wherever `theautonomousleader.com`'s DNS lives (Cloudflare, your registrar, etc.).
Verification usually completes within an hour. **Don't send anything until it shows Verified.**

### 3. Set env vars in Railway
On **both** Railway services (the assessment API and TAL-Site), add:

```
RESEND_API_KEY = re_xxxxxxxx        (your key from step 1)
RESEND_FROM    = The Autonomous Leader <jonathan@mail.theautonomousleader.com>
RESEND_REPLY_TO=                     (optional — a monitored inbox)
```

On the assessment API service, also (optional, for backups):
```
BACKUP_DIR  = /data/backups
BACKUP_KEEP = 30
```
(`/data` = your Railway volume mount, same as `DATA_DIR`.)

**Leave `KIT_API_SECRET` / `KIT_API_KEY` in place** — we run both in parallel first.

### 4. Deploy both services
Railway will `npm install` (picking up `liquidjs`) and redeploy. Your usual deploy
command/flow — nothing special. On boot the API logs `[Server] Email: Resend enabled`.

### 5. Test before trusting it (parallel run — both systems on)
- Take the **quick** assessment with a real inbox → confirm the Quick Results email arrives.
- Take the **deep** assessment → confirm the correct Level email arrives.
- Opt into **6 Traps** and **9P** on the site → confirm the PDF welcome arrives.
- Click **request outreach** on a result → confirm the follow-up arrives ~1 hour later.
- Check the inbox placement (Primary tab, not spam). At your volume it should be clean.
- You'll get the email **twice** during this phase (once from Resend, once from Kit) —
  that's expected and it's how you confirm Resend is working before cutting Kit.

Delayed emails (nurture/upsell/retake) you can spot-check by querying the queue:
`SELECT template_key, send_at, status FROM email_jobs ORDER BY id DESC LIMIT 20;`

### 6. Cut over (turn Kit off)
Once you've confirmed Resend delivers everything for ~1–2 weeks:
1. In Kit, turn **off** the 12 automations (or just downgrade Kit to free — automations stop either way).
2. Watch for a few days.
3. Downgrade Kit to the free plan (keep it as a plain broadcast list) or cancel it.
4. Optional cleanup: delete the Kit calls from `assessment.js` and `lead-magnet/route.ts`
   (they're clearly marked "old path"). Not required — they no-op without a Kit key.

### 7. Set up the daily backup (replaces Kit-as-backup)
In Railway, add a **Cron** service on the same volume, schedule `0 7 * * *`, start command:
```
node scripts/backup-db.js
```
This is now your safety net for assessment history (Kit used to be that).

---

## Rollback
If anything looks wrong, unset `RESEND_API_KEY` on both services and redeploy — the
new code goes dormant and Kit is still running underneath. Zero data loss.
