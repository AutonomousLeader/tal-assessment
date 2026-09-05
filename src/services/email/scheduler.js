// The scheduler — sends due emails from the email_jobs queue. This is the
// replacement for Kit's automation delays. It follows the same shape as the
// existing kit-retry loop: a setInterval that wakes, finds work, does it.
//
// It also exposes processDueJobs() so a route can trigger an immediate pass
// right after enqueuing (so results emails go out in seconds, not on the next
// tick) without duplicating any send logic.

const { getEmailMeta } = require("./manifest");
const { renderEmail } = require("./renderer");
const { sendEmail, isEnabled } = require("./mailer");

const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH = 25;

let running = false; // guards against overlapping passes

async function processOneJob(repo, job) {
  // Gate: quick-to-deep upsell is skipped if they've since taken the deep one.
  if (job.condition === "skip_if_deep" && repo.hasDeepAssessmentForEmail(job.email)) {
    repo.markEmailJobSkipped(job.id, "already_took_deep");
    return "skipped";
  }

  const meta = getEmailMeta(job.template_key);
  if (!meta) {
    repo.markEmailJobFailed(job.id, `unknown template: ${job.template_key}`, MAX_ATTEMPTS);
    return "failed";
  }

  let context;
  try {
    context = JSON.parse(job.context || "{}");
  } catch {
    context = { subscriber: {} };
  }

  const { body, subject, preview } = await renderEmail(meta, context);
  const result = await sendEmail({
    to: job.email,
    subject,
    previewText: preview,
    html: body,
  });

  if (result.sent) {
    repo.markEmailJobSent(job.id, result.id || null);
    console.log(`[Email] Sent "${subject}" to ${job.email} (job ${job.id})`);
    return "sent";
  }

  repo.markEmailJobFailed(job.id, result.error || result.reason || "unknown", MAX_ATTEMPTS);
  console.warn(`[Email] Failed job ${job.id} (${job.template_key}) → ${result.error || result.reason}`);
  return "failed";
}

// One pass over all currently-due jobs. Returns a small summary.
async function processDueJobs(repo, batchSize = DEFAULT_BATCH) {
  if (!isEnabled()) return { skipped: true, reason: "no_api_key" };
  if (running) return { skipped: true, reason: "already_running" };

  running = true;
  const summary = { sent: 0, skipped: 0, failed: 0 };
  try {
    const jobs = repo.getDueEmailJobs(batchSize);
    for (const job of jobs) {
      const outcome = await processOneJob(repo, job);
      summary[outcome] = (summary[outcome] || 0) + 1;
    }
  } finally {
    running = false;
  }
  return summary;
}

function startEmailScheduler(repo, intervalMs) {
  if (!isEnabled()) {
    console.log("[Email] RESEND_API_KEY not set — email scheduler disabled (Kit still handles sends).");
    return { trigger: () => {} };
  }

  console.log(`[Email] Scheduler started — checking the queue every ${Math.round(intervalMs / 1000)}s.`);
  const timer = setInterval(() => {
    processDueJobs(repo).catch(err => console.error("[Email] Scheduler pass error:", err.message));
  }, intervalMs);
  if (timer.unref) timer.unref();

  // Fire-and-forget trigger for an immediate pass after enqueue.
  const trigger = () => {
    processDueJobs(repo).catch(err => console.error("[Email] Immediate pass error:", err.message));
  };
  return { trigger };
}

module.exports = { startEmailScheduler, processDueJobs, MAX_ATTEMPTS };
